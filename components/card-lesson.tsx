"use client";

import "./card-lesson.css";
import "./lesson-common.css";
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LEARNING_CHAT_ENDPOINT, learningChatLimits } from "@/lib/learning-chat-contract";
import { characterCount, historyFor, markTurn, startThread, threadLimit, updateArtifact, activeThread, type WorkspaceTurn } from "@/lib/learning-thread";
import type { LessonCheckRequest } from "@/lib/lesson-contract";
import { readLessonChatResponse, type LessonChatRequest } from "@/lib/lesson-chat-contract";
import type { BrowserImportItem } from "@/lib/learner-record-contract";
import {
  acceptLessonCard, acceptLessonReply, acceptLessonReveal, beginLessonTurn, buildLessonCardRequest, buildLessonCheckRequest, buildLessonRevealRequest, createLessonState, lessonAccess,
  openedCardOf, projectLessonArtifacts, recordLessonActionFailure, recoverLessonServerReply, registerLessonArtifact, retryLessonTurn, selectLessonQuestion, submitLessonAttempt,
  type LessonArtifact, type LessonEvent, type LessonState,
} from "@/lib/lesson-workspace-state";
import { splitBlanks } from "@/lib/fill-blank";
import { attemptName, cardAttemptsForRequest, cardStage, explainRequestMessage, joinInputs, madeAfterReveal, placeLabel, sameInputs, setCardInput, setCardMessageDraft, type CardLessonView } from "@/lib/card-lesson";
import { documentAnchorId } from "@/lib/document-workspace-state";
import { minutesLabel } from "@/lib/study-content";
import { Icon, WorkspaceFrame, useWorkspaceShell, type OutlineItem } from "@/components/workspace-shell";
import { SaveWarning, useTurnRequests } from "@/components/workspace-session";
import { useReadingHold } from "@/components/use-reading-hold";
import { EventLine, JudgementItem, JudgementLine, JudgementStatus, OldVersionNotice, postLessonCheck, useLessonChecks, useLessonRecord } from "@/components/lesson-common";
import { AssistantReply, QuestionComposer, RequestStatus, UserRequest } from "@/components/workspace-chat";
import { NoteBlock, NoteTools, NotesBanner, NotesButton, NotesFact, NotesProvider, usePenNotes } from "@/components/pen-notes";
import { PersonalRecordSyncBar, usePersonalRecordSync } from "@/components/personal-record-sync";
import { cardBasisRuns, cardBlocks, cardKey, cardSentenceRuns, isClosedCardBlock } from "@/lib/note-blocks";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The cards lesson (`/prep/<작품>/unit-<n>/`): one section per card in the document. The blank inputs sit inside the card's own
 * sentence, and the judgement, the revisions and the answer ('답 보기') stay in that card. The chat is for the AI conversation and
 * keeps one summary line per answer. The record is lesson v4 under this lesson's own key. The shell, record store
 * and request lifecycle are the shared ones; this module only knows cards.
 * The server compares the answer with the canonical one. The browser never holds `drill.answers`.
 * A card is closed until its first answer: before it the page holds only the meaning, the Korean hint, the blank sentence and its source
 * line, and names no expression. The first judgement response carries the card (`OpenedCard`: expression, count, sense, example, basis),
 * which is kept in the record and opens the card, whether the answer was right or wrong.
 */
export function CardLesson({ view }: { view: CardLessonView }) {
  const { lesson } = view, cards = lesson.cards;
  const { keys, store } = useLessonRecord(lesson, "읽지 못한 이 수업의 임시 기록을 화면의 내용으로 바꾸어 저장합니까? 이 수업의 기록만 바뀝니다.");
  const { record, recordRef, update, hydrated } = store;
  const turns = useTurnRequests(store);
  const judge = useLessonChecks(store);
  const { busy, active } = turns;
  /** A notice of the conversation (a refused question, a new conversation). */
  const [notice, setNotice] = useState("");
  /** A notice of one card's own actions (a missing answer, a failed reveal). It is shown in that card. */
  const [cardNote, setCardNote] = useState<{ questionId: string; text: string } | null>(null);
  /** Answer requests in flight, by artifact. They are not part of the record. */
  const [revealing, setRevealing] = useState<Record<string, string>>({});
  /** Card-opening requests in flight, by artifact (old records only). Not part of the record. */
  const [opening, setOpening] = useState<Record<string, string>>({});
  const alive = useRef(true);
  const openedOf = (questionId: string) => { const saved = record.artifacts.find(item => item.question.questionId === questionId); return saved ? openedCardOf(saved) : null; };
  const openedKey = cards.map(card => openedOf(card.questionId) ? "1" : "0").join("");
  const noteBlocks = useMemo(() => cardBlocks(lesson, openedOf), [lesson, openedKey]);
  // A card opens when its judgement arrives, wherever the learner is reading. The opened text lands in that card, so a card above the
  // viewport must not push the page: the piece of a card at the top of the viewport is put back where it was when a card opens.
  useReadingHold(openedKey, hydrated, ".lw-document-flow section.cl-card > :not(.lw-sr-only)");
  const notes = usePenNotes({ lessonId: lesson.lessonId, blocks: noteBlocks, hidden: block => isClosedCardBlock(lesson, block, openedOf), hiddenWords: { tag: " · 닫힌 카드의 노트", why: "첫 답을 낸 뒤 카드가 열리면 이동할 수 있습니다." } });
  const hasLocalWork = record.events.length > 0 || record.artifacts.some(a => a.choice !== null || a.inputs.some(i => Boolean(i.trim())) || Boolean(a.messageDraft.trim()) || a.attempts.length > 0 || a.threads.some(t => t.turns.length > 0 || Boolean(t.draft?.trim())));
  const sync = usePersonalRecordSync<LessonState>({
    scope: lesson.lessonId,
    contentVersion: lesson.contentVersion,
    localState: record,
    localReady: hydrated,
    hasMeaningfulLocalWork: hasLocalWork,
    collectBrowserImportItems: (): BrowserImportItem[] => {
      try {
        const raw = localStorage.getItem(keys.record);
        return raw ? [{ scope: lesson.lessonId, storageKey: keys.record, legacyVersion: 4, contentVersion: lesson.contentVersion, rawJson: raw }] : [];
      } catch {
        return [];
      }
    },
    createFreshState: () => createLessonState(lesson),
    applyServerState: next => { turns.cancel(); store.unblock(); judge.clear(); setRevealing({}); setOpening({}); setCardNote(null); update(() => next); },
  });
  const shell = useWorkspaceShell({ storageKeys: { document: keys.document, layout: keys.layout }, documentMode: "plain", hydrated, lastEventId: record.events.at(-1)?.id || null, defaultAnchor: cards[0].questionId, getLastEventId: () => recordRef.current.events.at(-1)?.id || null });
  const { goToEnd, moveToChat, jumpToOutline } = shell;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const numberOf = (questionId: string) => cards.findIndex(card => card.questionId === questionId) + 1;
  /** "카드 3" while the card is closed; the card's expression is named only after its first answer opened it. */
  const labelOf = (artifact: LessonArtifact) => { const opened = openedCardOf(artifact); return `카드 ${numberOf(artifact.question.questionId)}${opened ? ` · ${opened.expression}` : ""}`; };
  const artifacts = projectLessonArtifacts(record, lesson);
  const byQuestion = new Map(artifacts.map(artifact => [artifact.question.questionId, artifact]));
  /** The card the learner handled last in the document. Selecting is not an event, and no card is selected until one is handled. */
  const selectedId = record.selectedQuestionId && byQuestion.has(record.selectedQuestionId) ? record.selectedQuestionId : null;
  const selected = selectedId ? byQuestion.get(selectedId)! : null, selectedCard = selectedId ? cards.find(card => card.questionId === selectedId)! : null;
  const selectedStage = selected ? cardStage(selected, lesson) : null, selectedLive = !!selected && lessonAccess(record, lesson, selected) === "open";
  const selectedThread = selected ? activeThread(selected) : null, limit = selectedThread ? threadLimit(selectedThread) : null, unresolved = !!selectedThread?.turns.some(turn => turn.status === "failed");
  const outdated = artifacts.filter(artifact => artifact.contentVersion !== lesson.contentVersion);
  const answered = artifacts.filter(artifact => artifact.attempts.length > 0).length;

  /** Applies a change to the newest record at once, so a handler can build on it. A change the record refuses is shown as a notice in `questionId`'s card. */
  function commit(change: (previous: LessonState) => LessonState, questionId?: string): boolean {
    try { const next = change(recordRef.current); recordRef.current = next; update(() => next); return true; }
    catch (cause) { const text = cause instanceof Error ? cause.message : "기록을 바꾸지 못했습니다."; if (questionId) setCardNote({ questionId, text }); else setNotice(text); return false; }
  }
  /** Choosing the card the conversation is about. It is not an event and sends nothing. */
  function handle(questionId: string) { update(previous => selectLessonQuestion(previous, lesson, questionId)); }
  function choose(questionId: string, input = false) {
    handle(questionId); setNotice("");
    if (input) requestAnimationFrame(() => moveToChat(true));
  }
  // An old address `#<카드 id>` keeps going to that card. Following it selects the card, which is not an event.
  useEffect(() => {
    if (!hydrated || !shell.layoutReady) return;
    const follow = () => { const id = decodeURIComponent(location.hash.slice(1)); if (cards.some(card => card.questionId === id)) { update(previous => selectLessonQuestion(previous, lesson, id)); jumpToOutline(id); } };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [hydrated, shell.layoutReady]);

  function runCheck(artifact: LessonArtifact) {
    try { void judge.send(buildLessonCheckRequest(recordRef.current, lesson, artifact.artifactId, crypto.randomUUID())); }
    catch (cause) { setCardNote({ questionId: artifact.question.questionId, text: cause instanceof Error ? cause.message : "판정을 보낼 수 없습니다." }); }
  }
  async function runReveal(artifact: LessonArtifact) {
    const { artifactId } = artifact, questionId = artifact.question.questionId;
    let request: LessonCheckRequest;
    try { request = buildLessonRevealRequest(recordRef.current, lesson, artifactId, crypto.randomUUID()); }
    catch (cause) { setCardNote({ questionId, text: cause instanceof Error ? cause.message : "답을 볼 수 없습니다." }); return; }
    handle(questionId);
    setRevealing(previous => ({ ...previous, [artifactId]: request.requestId }));
    setCardNote(null);
    const outcome = await postLessonCheck(request);
    if (!alive.current) return;
    if (outcome.ok) { update(previous => acceptLessonReveal(previous, request, outcome.response)); goToEnd(); }
    else {
      update(previous => recordLessonActionFailure(previous, request, outcome.message || "답을 가져오지 못했습니다."));
      setCardNote({ questionId, text: `답을 가져오지 못했습니다. 첫 답은 남아 있습니다.${outcome.message ? ` ${outcome.message}` : ""} 다시 눌러 주십시오.` });
    }
    setRevealing(previous => { if (previous[artifactId] !== request.requestId) return previous; const { [artifactId]: _removed, ...rest } = previous; return rest; });
  }
  /** For a record written before cards opened with the first answer: the same first answer is judged again (free) and only the card is taken from the response. */
  async function runOpen(artifact: LessonArtifact) {
    const { artifactId } = artifact, questionId = artifact.question.questionId;
    let request: LessonCheckRequest;
    try { request = buildLessonCardRequest(recordRef.current, lesson, artifactId, crypto.randomUUID()); }
    catch (cause) { setCardNote({ questionId, text: cause instanceof Error ? cause.message : "카드 내용을 열 수 없습니다." }); return; }
    handle(questionId);
    setOpening(previous => ({ ...previous, [artifactId]: request.requestId }));
    setCardNote(null);
    const outcome = await postLessonCheck(request);
    if (!alive.current) return;
    if (outcome.ok && acceptLessonCard(recordRef.current, request, outcome.response) !== recordRef.current) update(previous => acceptLessonCard(previous, request, outcome.response));
    else setCardNote({ questionId, text: `카드 내용을 가져오지 못했습니다. 첫 답은 남아 있습니다.${outcome.ok ? " 요청 대상과 맞는 응답을 읽지 못했습니다." : outcome.message ? ` ${outcome.message}` : ""} 다시 눌러 주십시오.` });
    setOpening(previous => { if (previous[artifactId] !== request.requestId) return previous; const { [artifactId]: _removed, ...rest } = previous; return rest; });
  }
  /** The first answer or a revision becomes a new attempt, then the server judges it. The earlier attempts are never replaced. */
  function submitAttempt(event: FormEvent<HTMLFormElement>, artifact: LessonArtifact) {
    event.preventDefault();
    const questionId = artifact.question.questionId;
    if (artifact.contentVersion !== lesson.contentVersion || judge.checks[artifact.artifactId]?.pending) return;
    if (!artifact.inputs.some(input => input.trim())) { const field = event.currentTarget.querySelector<HTMLInputElement>("input"); field?.setCustomValidity("빈칸 하나 이상에 적어 주십시오."); field?.reportValidity(); return; }
    if (!commit(previous => selectLessonQuestion(submitLessonAttempt(registerLessonArtifact(previous, lesson, questionId), lesson, artifact.artifactId, { kind: "fill", inputs: [...artifact.inputs] }), lesson, questionId), questionId)) return;
    setCardNote(null); goToEnd();
    runCheck(artifact);
  }
  async function sendMessage(artifactId: string, message: string, retry?: { threadId: string; turnId: string }) {
    const artifact = projectLessonArtifacts(recordRef.current, lesson).find(item => item.artifactId === artifactId);
    if (!artifact) return;
    const thread = retry ? artifact.threads.find(item => item.id === retry.threadId) : activeThread(artifact), content = message.trim();
    if (!thread || !content || characterCount(content) > learningChatLimits.message || active.current) return;
    if (artifact.contentVersion !== lesson.contentVersion) { setNotice("이 카드의 기록은 이전 자료 판입니다. 읽기만 하고 AI 전송을 막았습니다."); return; }
    const exhausted = threadLimit(thread); if (exhausted) { setNotice(exhausted); return; }
    if (!retry && thread.turns.some(turn => turn.status === "failed" || turn.status === "pending")) { setNotice("이 카드의 실패한 요청을 다시 보내거나 접은 뒤 질문합니다."); return; }
    const questionId = artifact.question.questionId, { initialAttempt, revisions } = cardAttemptsForRequest(artifact);
    await turns.send({
      artifactId, threadId: thread.id, turnId: retry?.turnId, endpoint: LEARNING_CHAT_ENDPOINT,
      body: (requestId): LessonChatRequest => ({ lessonId: lesson.lessonId, questionId, contentVersion: artifact.contentVersion, artifactId, requestId, initialAttempt, revisions, messages: historyFor(thread), message: content }),
      onStart: () => { setNotice(""); goToEnd(); },
      begin: (previous, { requestId, turnId }) => {
        const registered = registerLessonArtifact(previous, lesson, questionId);
        if (retry) return retryLessonTurn(registered, lesson, artifactId, thread.id, turnId, requestId);
        const begun = beginLessonTurn(registered, lesson, artifactId, { id: turnId, requestId, user: content, origin: "question", status: "pending" });
        return message === artifact.messageDraft ? updateArtifact(begun, artifactId, item => ({ ...item, messageDraft: "" })) : begun;
      },
      read: (result, requestId) => readLessonChatResponse(result, { requestId, lessonId: lesson.lessonId, artifactId, questionId, contentVersion: artifact.contentVersion }),
      accept: (previous, reply) => acceptLessonReply(previous, reply),
    });
  }
  function newConversation() {
    const artifact = selected;
    if (!artifact || !selectedLive || !confirm(`${labelOf(artifact)}의 새 대화를 엽니다. 이 카드의 이전 대화와 미전송 초안, 모든 카드의 답은 남아 있습니다. 계속합니까?`)) return;
    if (active.current?.artifactId === artifact.artifactId) turns.cancel();
    if (commit(previous => startThread(registerLessonArtifact(previous, lesson, artifact.question.questionId), artifact.artifactId))) { setNotice("이 카드의 새 대화를 열었습니다. 이전 대화는 위 흐름에 남아 있습니다."); goToEnd(); }
  }
  /** Only this lesson's record key is cleared. Other lessons and the reading position are untouched. */
  function restartFromNewVersion() {
    turns.cancel(); store.unblock();
    if (sync.isServerConnected) {
      judge.clear(); setRevealing({}); setOpening({}); setCardNote(null);
      void sync.archiveAndStartNewRun("new-version");
      return;
    }
    try { localStorage.removeItem(keys.record); } catch { /* The new empty record is saved right after. */ }
    judge.clear(); setRevealing({}); setOpening({}); setCardNote(null);
    if (commit(() => selectedId ? selectLessonQuestion(createLessonState(lesson), lesson, selectedId) : createLessonState(lesson))) setNotice("이전 판의 기록을 지우고 새 판으로 시작했습니다.");
  }

  const saveWarning = <SaveWarning store={store} />;
  const byArtifact = (artifactId: string) => artifacts.find(item => item.artifactId === artifactId);
  // A closed card is listed by its number and meaning; its expression joins the outline when the first answer opens the card.
  const outline: OutlineItem[] = cards.map((card, index) => ({ id: card.questionId, title: openedOf(card.questionId)?.expression ?? card.meaning, label: `카드 ${index + 1}` }));

  /** The sentence of the conversation's target: numbered gaps, no inputs. */
  function blanksView(sentence: string) {
    return splitBlanks(sentence).map((piece, index, all) => <Fragment key={index}>{piece}{index < all.length - 1 && <span className="cl-gap"><span aria-hidden="true">{index + 1}</span></span>}</Fragment>);
  }
  function pending(artifact: LessonArtifact) { return !!judge.checks[artifact.artifactId]?.pending; }
  function judgeStatus(artifact: LessonArtifact) {
    const last = artifact.attempts.at(-1);
    if (!last || last.check || artifact.contentVersion !== lesson.contentVersion) return null;
    return <JudgementStatus state={pending(artifact) ? "pending" : "failed"} label={labelOf(artifact)} message={judge.checks[artifact.artifactId]?.message} onRetry={() => runCheck(artifact)} />;
  }
  function attemptView(artifact: LessonArtifact, index: number) {
    const attempt = artifact.attempts[index]?.attempt;
    if (!attempt || attempt.kind !== "fill") return null;
    const after = madeAfterReveal(artifact, index);
    return <div className="lw-user-performance cl-attempt" data-attempt-index={index}><div className="lw-message-meta">나 · {labelOf(artifact)} · {attemptName(index)}{after && <span className="cl-after-reveal">답을 본 뒤</span>}</div><ol className="cl-attempt-inputs">{attempt.inputs.map((input, at) => <li key={at}><span>빈칸 {at + 1}</span> <span className="en">{input || "(비움)"}</span></li>)}</ol>{index > 0 && <p className="lw-performance-note">첫 답은 그대로 두고 새 시도로 따로 남긴 답입니다.</p>}{index === artifact.attempts.length - 1 && judgeStatus(artifact)}</div>;
  }
  function judgementView(artifact: LessonArtifact, index: number) {
    const check = artifact.attempts[index]?.check;
    if (!check || check.kind !== "fill") return null;
    return <JudgementItem className="cl-judgement" attempt={index} ariaLabel={`${labelOf(artifact)} ${attemptName(index)} 서버 판정`} tone={check.allMatch ? "same" : "differs"}
      head={<>{labelOf(artifact)} · {attemptName(index)}{madeAfterReveal(artifact, index) && <span className="cl-after-reveal">답을 본 뒤</span>}</>}>
      <JudgementLine same={check.allMatch} />
      <ul className="cl-blank-results">{check.matches.map((match, at) => <li key={at} data-match={match}>빈칸 {at + 1} · {match ? "같음" : "다름"}</li>)}</ul>
      <p className="lw-performance-note">서버가 정본과 대조한 결과입니다. 정본에 없는 자연스러운 답은 다르다고 나올 수 있습니다. AI의 말은 이 판정을 바꾸지 않습니다.</p>
    </JudgementItem>;
  }
  function revealView(artifact: LessonArtifact) {
    const reveal = artifact.reveal;
    if (!reveal) return null;
    return <JudgementItem className="cl-judgement cl-reveal" ariaLabel={`${labelOf(artifact)} 정본 답`} mark="정본 답" tone="reveal" head={<>{labelOf(artifact)} · 답 보기</>}>
      <ul className="cl-blank-results">{reveal.response.answers.map((answer, at) => <li key={at}>빈칸 {at + 1} · <span className="en">{answer}</span></li>)}</ul>
      <p className="lw-performance-note">첫 답을 낸 뒤에 연 정본 답입니다. 이 뒤의 시도에는 &ldquo;답을 본 뒤&rdquo;를 표시합니다.</p>
    </JudgementItem>;
  }
  /** What happened in this card, in the order it happened: the answers, their judgements and the revealed answer. */
  function trail(artifact: LessonArtifact) {
    const saved = record.artifacts.find(item => item.artifactId === artifact.artifactId);
    if (!saved) return null;
    const events = record.events.filter(event => "artifactId" in event && event.artifactId === saved.artifactId && ["initial", "revision", "check", "reveal"].includes(event.kind));
    if (!events.length) return null;
    return <div className="cl-trail" aria-label={`${labelOf(artifact)}의 답과 판정`} role="group">{events.map(event => {
      const item = event.kind === "initial" ? attemptView(saved, 0) : event.kind === "revision" ? attemptView(saved, event.index) : event.kind === "check" ? judgementView(saved, event.index) : event.kind === "reveal" ? revealView(saved) : null;
      return item ? <div className="cl-trail-item" data-event-kind={event.kind} key={event.id}>{item}</div> : null;
    })}</div>;
  }

  function summaryOf(event: LessonEvent, artifact: LessonArtifact): ReactNode {
    const id = artifact.question.questionId, label = labelOf(artifact);
    const inputsOf = (index: number) => { const attempt = artifact.attempts[index]?.attempt; return attempt?.kind === "fill" ? joinInputs(attempt.inputs) : ""; };
    const after = (index: number) => madeAfterReveal(artifact, index) ? " · 답을 본 뒤" : "";
    if (event.kind === "initial") return <EventLine questionId={id} text={`${label} · 첫 답 ${inputsOf(0)}`} />;
    if (event.kind === "revision") return <EventLine questionId={id} text={`${label} · ${attemptName(event.index)} ${inputsOf(event.index)}${after(event.index)}`} />;
    if (event.kind === "check") {
      const check = artifact.attempts[event.index]?.check;
      if (check?.kind !== "fill") return null;
      return <EventLine questionId={id} text={`${label} · ${attemptName(event.index)} · 정본 답과 ${check.allMatch ? "같습니다" : "다릅니다"} (${check.matches.map((match, at) => `빈칸 ${at + 1} ${match ? "같음" : "다름"}`).join(" · ")})${after(event.index)}`} jumpLabel="카드에서 보기" onJump={() => jumpToOutline(id)} />;
    }
    if (event.kind === "reveal") return <EventLine questionId={id} text={`${label} · 답 보기 · 정본 답을 열었습니다`} jumpLabel="카드에서 보기" onJump={() => jumpToOutline(id)} />;
    return null;
  }
  function timelineEvent(event: LessonEvent): ReactNode {
    if (!("artifactId" in event)) return null;
    const artifact = projectLessonArtifacts(record, lesson).find(item => item.artifactId === event.artifactId);
    if (!artifact) return null;
    if (event.kind === "initial" || event.kind === "revision" || event.kind === "check" || event.kind === "reveal") return summaryOf(event, artifact);
    if (!("threadId" in event)) return null;
    const thread = artifact.threads.find(item => item.id === event.threadId);
    if (!thread) return null;
    if (event.kind === "thread") return <div className="lw-thread-divider"><h2>{labelOf(artifact)} · 새 대화</h2><p>이전 대화와 답은 남아 있습니다.</p></div>;
    if (!("turnId" in event)) return null;
    const turn = thread.turns.find(item => item.id === event.turnId);
    if (!turn) return null;
    const status = () => <RequestStatus label={labelOf(artifact)} turn={turn} requestId={event.requestId} current={thread.id === artifact.activeThreadId} waiting="내 답과 판정을 살펴보고 있습니다…" busy={busy} locked={artifact.contentVersion !== lesson.contentVersion}
      onRetry={() => void sendMessage(artifact.artifactId, turn.user, { threadId: thread.id, turnId: turn.id })}
      onDismiss={() => update(previous => markTurn(previous, artifact.artifactId, thread.id, turn.id, event.requestId, "cancelled", "실패한 요청을 접었습니다. 원래 질문은 그대로 남깁니다."))}
      onCheckServerResult={sync.isServerConnected && (turn.status === "cancelled" || turn.status === "failed") ? () => {
        void sync.lookupExecutionResult(turn.requestId).then(exec => {
          const reply = exec?.status === "succeeded" ? readLessonChatResponse(exec.responsePayload, { requestId: turn.requestId, lessonId: lesson.lessonId, artifactId: artifact.artifactId, questionId: artifact.question.questionId, contentVersion: artifact.contentVersion }) : null;
          if (reply) {
            update(previous => recoverLessonServerReply(previous, reply));
            setNotice("서버에 보관된 응답을 확인해 연결했습니다.");
          } else {
            setNotice(exec?.errorMessage || "서버에 보관된 응답을 찾지 못했습니다. 다시 보낼 수 있습니다.");
          }
        });
      } : undefined} />;
    if (event.kind === "reply") return <AssistantReply label={labelOf(artifact)} turn={turn} />;
    if (event.kind === "retry") return <div className="lw-retry-event"><p>{labelOf(artifact)}의 같은 질문을 다시 보냈습니다.</p>{status()}</div>;
    return <div className="lw-turn"><UserRequest label={labelOf(artifact)} turn={turn} />{status()}</div>;
  }

  /** The card's blank sentence with the inputs inside it, the buttons of its stage, and the card's own notice. */
  function drillForm(card: (typeof cards)[number], artifact: LessonArtifact, number: number) {
    const stage = cardStage(artifact, lesson), last = artifact.attempts.at(-1);
    const editable = stage === "first" || stage === "revise", revising = stage === "revise";
    const unchanged = revising && !!last && last.attempt.kind === "fill" && sameInputs(last.attempt.inputs, artifact.inputs);
    const lastCheck = revising && last?.check?.kind === "fill" ? last.check : null;
    const note = cardNote?.questionId === card.questionId ? cardNote.text : "";
    const reveal = artifact.reveal ? null : <><button type="button" className="lw-text-button cl-reveal-button" disabled={!hydrated || stage === "old" || !artifact.attempts.length || !!revealing[artifact.artifactId]} aria-describedby={`cl-reveal-note-${card.questionId}`} onClick={() => void runReveal(artifact)}>{revealing[artifact.artifactId] ? "답을 가져오는 중…" : "답 보기"}</button><span id={`cl-reveal-note-${card.questionId}`} className="cl-reveal-note">{artifact.attempts.length ? "정본 답을 엽니다. 첫 답은 그대로 남습니다." : "답 보기는 첫 답을 낸 뒤에 열립니다."}</span></>;
    return <form className="cl-drill cl-card-form" aria-label={`카드 ${number} ${stage === "first" ? "첫 답" : revising ? "수정" : "빈칸"}`} data-artifact-id={artifact.artifactId} data-stage={stage} onSubmit={event => submitAttempt(event, artifact)}>
      <p className="cl-drill-label">빈칸 문장 · 한국어 힌트: {card.drill.hint}</p>
      <NoteBlock as="p" className="en cl-drill-sentence" block={cardKey(card.questionId, "sentence")} runs={cardSentenceRuns(card.drill.sentence)} disabled={stage === "old"} gaps={splitBlanks(card.drill.sentence).slice(0, -1).map((_, index) => <span className="cl-blank" key={index}>
        <input className="en cl-blank-input" aria-label={`빈칸 ${index + 1}`} placeholder={String(index + 1)} value={artifact.inputs[index] ?? ""} maxLength={100} readOnly={!editable} disabled={!hydrated} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} onFocus={() => { if (selectedId !== card.questionId) handle(card.questionId); }} onChange={event => { event.target.setCustomValidity(""); update(previous => selectLessonQuestion(setCardInput(previous, lesson, card.questionId, index, event.target.value), lesson, card.questionId)); }} />
        {lastCheck && <span className="cl-prev-result" data-match={lastCheck.matches[index]}>직전 판정 · {lastCheck.matches[index] ? "같음" : "다름"}</span>}</span>)} />
      <p className="cl-source">{placeLabel(lesson.work, card.drill)}</p>
      {editable && <p className="lw-form-note">{revising ? "직전 답은 그대로 남기고 이 답을 새 시도로 판정합니다." : "첫 답을 남기면 서버가 정본과 대조하고 카드가 열립니다. AI는 부르지 않습니다."}{revising && last ? ` 수정 ${artifact.attempts.length}/${learningChatLimits.revisions}회 사용.` : ""}</p>}
      {stage === "old" && <p className="lw-form-note">이 카드는 이전 자료 판의 기록입니다. 답과 판정을 읽기만 하고 새 답은 받지 않습니다.</p>}
      {stage === "waiting" && <p className="lw-form-note">{pending(artifact) ? "판정을 기다리고 있습니다. 답은 남아 있습니다." : "판정을 받지 못한 답이 있습니다. 아래에서 다시 판정할 수 있습니다."}</p>}
      {stage === "match" && <p className="lw-form-note">가장 최근 답이 정본 답과 같다고 판정됐습니다. 이 카드에 관한 질문은 계속할 수 있습니다.</p>}
      {stage === "limit" && <p className="lw-form-note">수정 {learningChatLimits.revisions}회 한도에 닿았습니다. 남은 답과 판정은 그대로 두고 질문은 계속할 수 있습니다.</p>}
      <div className="lw-form-actions">
        {editable && <button className="lw-button lw-primary" type="submit" disabled={!hydrated || pending(artifact) || unchanged}>{revising ? "수정해서 다시 판정" : "첫 답 남기기"} <span aria-hidden="true">→</span></button>}
        {stage !== "old" && reveal}
      </div>
      {unchanged && <p className="lw-form-note">직전 답과 같은 내용은 새 시도로 남기지 않습니다.</p>}
      {note && <p className="lw-form-note cl-card-note" role="status">{note}</p>}
      {editable && saveWarning}
    </form>;
  }

  return <NotesProvider value={notes}><WorkspaceFrame shell={shell} lessonWord={<>{lesson.work.title} <span className="cl-unit-word">유닛 {lesson.unit.n}</span></>} save={{ text: store.saveText + (notes.saveState === "failed" ? " · 노트 저장 실패" : ""), failed: store.saveState === "failed" || notes.saveState === "failed" }} serverConnected={sync.isServerConnected} syncBar={<PersonalRecordSyncBar sync={sync} />} outline={outline}
    currentList={{ href: view.listHref, title: "이 작품의 유닛 목록" }}
    toolbarActions={<><NotesButton /><button type="button" onClick={newConversation} disabled={!selectedLive}>이 카드 새 대화</button></>}
    toc={{ title: <>{lesson.work.title}{" "}<br />유닛 {lesson.unit.n}</>, lead: `${lesson.unit.when}에 익힐 표현을 카드마다 뜻과 힌트로 떠올려 빈칸을 채웁니다. 첫 답을 내면 카드가 열립니다.`, summary: <><p>카드 {cards.length}개{answered > 0 ? ` · 첫 답을 남긴 카드 ${answered}개` : ""}</p><NotesFact /><p>문서 전체의 목차입니다. 읽기와 풀이는 원하는 순서로 합니다.</p></> }}
    referenceStack={null}
    documentHeading={<><p>사전 훈련 · {lesson.work.kind === "book" ? "책" : "영화"}</p><h2>{lesson.unit.when}에 익힐 표현 {cards.length}개</h2><div><span><i>{lesson.work.title}</i> · 유닛 {lesson.unit.n}</span><span>{lesson.unit.summary}</span></div></>}
    document={<><NotesBanner />{view.pairs.map(story => <p className="pair-note" key={story.id}>이 유닛의 표현으로 쓴 짝 이야기 · <a href={`/reading/${story.id}/`}>{story.title ? <span className="en">{story.title}</span> : "짝 이야기 읽기"} ({minutesLabel(story.limitSeconds)} · {story.words}낱말 · 문제 {story.questions}개) <span aria-hidden="true">→</span></a></p>)}{cards.map((card, index) => {
      const artifact = byQuestion.get(card.questionId)!, old = artifact.contentVersion !== lesson.contentVersion, opened = openedCardOf(artifact);
      const first = artifact.attempts[0], awaitingJudgement = !!first && !first.check;
      return <section className={`cl-card ${selectedId === card.questionId ? "cl-card-selected" : ""}`} data-outline-id={card.questionId} data-question-id={card.questionId} data-card-open={opened ? "true" : "false"} id={documentAnchorId(card.questionId)} tabIndex={-1} aria-labelledby={`${documentAnchorId(card.questionId)}-h`} key={card.questionId}>
        <div className="lw-document-section-label">{pad(index + 1)} / 표현 카드</div>
        <h2 id={card.questionId} className="cl-expression">{opened
          ? <><span id={`${documentAnchorId(card.questionId)}-h`} className="en">{opened.expression}</span><span className="cl-count">{view.countLabel} {opened.count}번{opened.countInPart !== undefined ? ` · ${lesson.unit.n}부 ${opened.countInPart}번` : ""}</span></>
          : <span id={`${documentAnchorId(card.questionId)}-h`}>카드 {index + 1}</span>}</h2>
        <dl className="cl-kv"><dt>뜻</dt><NoteBlock as="dd" block={cardKey(card.questionId, "meaning")} runs={[{ text: card.meaning }]} disabled={old} /></dl>
        {drillForm(card, artifact, index + 1)}
        {trail(artifact)}
        {opened ? <div className="cl-opened">
          <dl className="cl-kv"><dt>감각</dt><NoteBlock as="dd" block={cardKey(card.questionId, "sense")} runs={[{ text: opened.sense }]} disabled={old} /></dl>
          <figure className="cl-example"><NoteBlock as="blockquote" className="en" block={cardKey(card.questionId, "example")} runs={[{ text: opened.example.text }]} disabled={old} /><figcaption>{placeLabel(lesson.work, opened.example)}</figcaption></figure>
          <NoteBlock as="p" className="cl-basis" block={cardKey(card.questionId, "basis")} runs={cardBasisRuns(opened.basis)} disabled={old} />
        </div> : <div className="cl-closed">
          <p className="cl-closed-note">{awaitingJudgement ? "판정을 받으면 카드의 표현·감각·예문이 열립니다." : first ? "이 기록은 카드가 처음부터 열려 있던 때의 것이라 닫혀 있습니다. 첫 답으로 다시 판정해 카드 내용만 받아 옵니다. AI는 부르지 않습니다." : "카드의 표현·감각·예문은 첫 답을 낸 뒤에 열립니다. 맞든 틀리든 열립니다."}</p>
          {first && !awaitingJudgement && !old && <button type="button" className="lw-text-button cl-open-button" disabled={!hydrated || !!opening[artifact.artifactId]} onClick={() => void runOpen(artifact)}>{opening[artifact.artifactId] ? "카드 내용을 가져오는 중…" : "카드 내용 열기"}</button>}
        </div>}
        <p className="lw-sr-only" role="status">{opened ? `${labelOf(artifact)}의 표현·감각·예문이 열렸습니다.` : ""}</p>
        <footer className="cl-card-foot"><button type="button" aria-pressed={selectedId === card.questionId} aria-label={`${labelOf(artifact)} 질문하기`} onClick={() => choose(card.questionId, true)}>이 카드에 질문하기</button>{artifact.attempts.length > 0 && <span className="cl-card-fact">첫 답을 남겼습니다{artifact.attempts.length > 1 ? ` · 수정 ${artifact.attempts.length - 1}회` : ""}{artifact.reveal ? " · 답을 봤습니다" : ""}</span>}{old && <span className="cl-card-fact">이전 자료 판의 기록이 있어 읽기만 합니다.</span>}</footer>
      </section>;
    })}</>}
    documentEnd={<>
      {view.pairs.length > 0 && <section className="cl-pairs" aria-labelledby="pair-read-h"><h2 id="pair-read-h">이 표현으로 읽기</h2><div className="links">{view.pairs.map(story => <a className="link-card" key={story.id} href={`/reading/${story.id}/`}><span className="t">이 표현으로 읽기: {story.title ? <span className="en">{story.title}</span> : "짝 이야기"} ({minutesLabel(story.limitSeconds)}) {story.draft && <span className="tag draft-tag">초안</span>}</span><span className="s">카드 표현으로 쓴 새 이야기 · {story.words}낱말 · 문제 {story.questions}개</span></a>)}</div></section>}
      <nav className="cl-pager" aria-label="다른 유닛">
        {view.prev ? <a href={view.prev.href}><span className="k">이전</span>유닛 {view.prev.n} · {view.prev.when}</a> : <a href={view.listHref}><span className="k">목록</span>{lesson.work.title} 유닛</a>}
        {view.next ? <a className="next" href={view.next.href}><span className="k">다음</span>유닛 {view.next.n} · {view.next.when}</a> : <a className="next" href="/prep/"><span className="k">목록</span>다른 작품</a>}
      </nav>
      <p className="lw-document-end">{lesson.work.title} 유닛 {lesson.unit.n} 문서 끝 · 카드 {cards.length}개 가운데 원하는 카드를 골라 풀 수 있습니다.</p>
    </>}
    chat={{
      context: <>
        <p className="lw-reading-context">입력 대상: <strong>{selected ? labelOf(selected) : "아직 없음"}</strong>{selected && <span>{selected.attempts.length ? `첫 답 있음${selected.attempts.length > 1 ? ` · 수정 ${selected.attempts.length - 1}회` : ""}` : "첫 답 전"} · 문서에서 마지막으로 다룬 카드</span>}</p>
        {selectedCard ? <><p className="lw-target-question en">{blanksView(selectedCard.drill.sentence)}</p><p className="lw-target-hint">한국어 힌트: {selectedCard.drill.hint}</p></> : <p className="lw-target-question">문서에서 빈칸을 채우거나 ‘이 카드에 질문하기’를 누르면 대화 대상이 정해집니다.</p>}
        <p className="lw-input-stage" role="status">{!selectedStage ? "카드를 다루면 이곳에서 질문할 수 있습니다" : selectedStage === "old" ? "이전 자료 판의 기록은 읽기만 합니다" : selectedStage === "first" ? "답은 카드에서 남깁니다 · 여기서는 질문합니다" : selectedStage === "waiting" ? "판정을 기다리는 답이 있습니다" : "이 카드에 관해 질문합니다"}</p>
        {outdated.length > 0 && <OldVersionNotice className="cl-old-banner" role="status" confirmMessage="이전 자료 판으로 남은 이 수업의 기록(모든 카드의 답·판정·대화)을 지우고 새 판으로 시작합니다. 되돌릴 수 없습니다. 지웁니까?" onRestart={restartFromNewVersion}>이전 자료 판으로 남은 기록이 {outdated.length}개 카드에 있습니다. 읽기만 하고 판정과 AI 전송을 막았습니다.</OldVersionNotice>}
      </>,
      timeline: <>{record.events.length === 0 && <p className="lw-muted">카드의 빈칸에 답하면 답과 판정, 수정, 질문이 일어난 순서대로 여기에 한 줄씩 쌓입니다. 판정은 그 카드 안에 있습니다.</p>}{record.events.map(event => <div className="lw-timeline-event" data-event-kind={event.kind} data-artifact-id={"artifactId" in event ? event.artifactId : undefined} key={event.id}>{timelineEvent(event)}</div>)}</>,
      input: null,
      composer: selected ? <>
        {(limit || notice) && <div className="lw-chat-notice" role="status"><p>{limit || notice}</p>{limit && <button type="button" onClick={newConversation}>답을 유지하고 이 카드 새 대화</button>}</div>}
        <div className="lw-composer-tools"><span>{selected.attempts.length ? `카드 ${numberOf(selected.question.questionId)}에서 이어 가는 대화` : "답을 낸 뒤 AI에게 설명을 요청할 수 있습니다"}</span><button type="button" className="cl-explain" disabled={!hydrated || !selected.attempts.length || busy || !selectedLive || !!limit || unresolved} onClick={() => void sendMessage(selected.artifactId, explainRequestMessage)}>AI에게 설명 요청</button>{busy && <button type="button" className="lw-send lw-stop" onClick={turns.cancel}><Icon kind="stop" size={15} /><span>{active.current ? numberOf(byArtifact(active.current.artifactId)?.question.questionId || "") : ""}번 카드 응답 중단</span></button>}</div>
        <QuestionComposer artifactId={selected.artifactId} label="이 카드에 대해 질문하기" value={selected.messageDraft} placeholder={selected.attempts.length ? `카드 ${numberOf(selected.question.questionId)}에서 막힌 부분을 물어보십시오…` : "풀기 전에 궁금한 점을 물어보십시오…"} hydrated={hydrated} busy={busy} blocked={!selectedLive || !!limit || unresolved}
          onChange={value => update(previous => setCardMessageDraft(previous, lesson, selected.question.questionId, value))} onSend={() => void sendMessage(selected.artifactId, selected.messageDraft)} />
        <p className="lw-ai-note">{selected.attempts.length ? "AI는 사용자가 보낼 때만 부릅니다. AI의 답은 틀릴 수 있고 서버 판정을 바꾸지 않습니다." : "답 제출 전에는 AI 대신 무료 준비 안내를 제공합니다."}</p>
        {saveWarning}
      </> : <>
        {notice && <div className="lw-chat-notice" role="status"><p>{notice}</p></div>}
        <p className="lw-locked-note">문서에서 카드의 빈칸을 채우거나 ‘이 카드에 질문하기’를 누르면 질문 칸이 열립니다.</p>
        {saveWarning}
      </>,
    }}
    dialog={null} layer={<NoteTools />} /></NotesProvider>;
}

function dismissTurn(previous: LessonState, artifactId: string, threadId: string, turnId: string, requestId: string) {
  return markTurn(previous, artifactId, threadId, turnId, requestId, "cancelled", "실패한 요청을 접었습니다. 원래 질문은 그대로 남깁니다.");
}
export default CardLesson;
