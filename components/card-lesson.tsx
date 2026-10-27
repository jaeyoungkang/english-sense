"use client";

import "./card-lesson.css";
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LEARNING_CHAT_ENDPOINT, learningChatLimits } from "@/lib/learning-chat-contract";
import { characterCount, historyFor, markTurn, startThread, threadLimit, updateArtifact, activeThread, type WorkspaceTurn } from "@/lib/learning-thread";
import { LESSON_CHECK_ENDPOINT, isLessonCheckResponse, type LessonCheckRequest } from "@/lib/lesson-contract";
import { isLessonChatResponse, type LessonChatRequest } from "@/lib/lesson-chat-contract";
import {
  acceptLessonCheck, acceptLessonReply, acceptLessonReveal, beginLessonTurn, buildLessonCheckRequest, buildLessonRevealRequest, createLessonState, lessonAccess,
  lessonStorageKeys, loadLessonRecord, projectLessonArtifacts, registerLessonArtifact, retryLessonTurn, selectLessonQuestion, submitLessonAttempt,
  type LessonArtifact, type LessonEvent, type LessonState,
} from "@/lib/lesson-workspace-state";
import { splitBlanks } from "@/lib/fill-blank";
import { attemptName, cardAttemptsForRequest, cardStage, explainRequestMessage, madeAfterReveal, placeLabel, sameInputs, setCardInput, setCardMessageDraft, type CardLessonView } from "@/lib/card-lesson";
import { documentAnchorId } from "@/lib/document-workspace-state";
import { Icon, WorkspaceFrame, useWorkspaceShell, type OutlineItem } from "@/components/workspace-shell";
import { SaveWarning, useRecordStore, useTurnRequests } from "@/components/workspace-session";
import { AssistantReply, QuestionComposer, RequestStatus, UserRequest } from "@/components/workspace-chat";

const minutes = (seconds: number) => seconds % 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds / 60}분`;
const pad = (n: number) => String(n).padStart(2, "0");
const errorDetail = (body: unknown) => body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : "";

/**
 * The cards lesson (`/prep/<작품>/unit-<n>/`): one section per card in the document, the blank inputs, the judgement
 * and the AI conversation in the chat. The record is lesson v4 under this lesson's own key. The shell, record store
 * and request lifecycle are the shared ones; this module only knows cards.
 * The server compares the answer with the canonical one. The browser never holds `drill.answers`.
 */
export function CardLesson({ view }: { view: CardLessonView }) {
  const { lesson } = view, cards = lesson.cards, keys = lessonStorageKeys(lesson.lessonId);
  const store = useRecordStore<LessonState>({
    key: keys.record,
    initial: () => createLessonState(lesson),
    load: () => { const loaded = loadLessonRecord(key => localStorage.getItem(key), lesson, Date.now()); if (!loaded.ok) throw new Error(loaded.message); return loaded.state; },
    overwritePrompt: "읽지 못한 이 수업의 임시 기록을 화면의 내용으로 바꾸어 저장합니까? 이 수업의 기록만 바뀝니다.",
  });
  const { record, recordRef, update, hydrated } = store;
  const turns = useTurnRequests(store);
  const { busy, active } = turns;
  const [notice, setNotice] = useState("");
  /** Judgement and answer requests in flight, by artifact. They are not part of the record. */
  const [judging, setJudging] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const alive = useRef(true);
  const shell = useWorkspaceShell({ storageKeys: { document: keys.document, layout: keys.layout }, documentMode: "plain", hydrated, lastEventId: record.events.at(-1)?.id || null, defaultAnchor: cards[0].questionId, getLastEventId: () => recordRef.current.events.at(-1)?.id || null });
  const { documentState, goToEnd, moveToChat, jumpToOutline } = shell;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const numberOf = (questionId: string) => cards.findIndex(card => card.questionId === questionId) + 1;
  const labelOf = (artifact: LessonArtifact) => `카드 ${numberOf(artifact.question.questionId)} · ${"expression" in artifact.question ? artifact.question.expression : ""}`;
  const artifacts = projectLessonArtifacts(record, lesson);
  const byQuestion = new Map(artifacts.map(artifact => [artifact.question.questionId, artifact]));
  const selectedId = record.selectedQuestionId && byQuestion.has(record.selectedQuestionId) ? record.selectedQuestionId : cards[0].questionId;
  const selected = byQuestion.get(selectedId)!, selectedCard = cards.find(card => card.questionId === selectedId)!;
  const selectedStage = cardStage(selected, lesson), selectedLive = lessonAccess(record, lesson, selected) === "open";
  const selectedThread = activeThread(selected), limit = threadLimit(selectedThread), unresolved = selectedThread.turns.some(turn => turn.status === "failed");
  const outdated = artifacts.filter(artifact => artifact.contentVersion !== lesson.contentVersion);
  const answered = artifacts.filter(artifact => artifact.attempts.length > 0).length;

  /** Applies a change to the newest record at once, so a handler can build on it. A change the record refuses is shown as a notice. */
  function commit(change: (previous: LessonState) => LessonState): boolean {
    try { const next = change(recordRef.current); recordRef.current = next; update(() => next); return true; }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "기록을 바꾸지 못했습니다."); return false; }
  }
  function choose(questionId: string, input = false) {
    update(previous => selectLessonQuestion(previous, lesson, questionId)); setNotice("");
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

  async function runCheck(artifactId: string) {
    let request: LessonCheckRequest;
    try { request = buildLessonCheckRequest(recordRef.current, lesson, artifactId, crypto.randomUUID()); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "판정을 보낼 수 없습니다."); return; }
    setJudging(previous => ({ ...previous, [artifactId]: request.requestId }));
    setFailures(previous => { const { [artifactId]: _removed, ...rest } = previous; return rest; });
    try {
      const response = await fetch(LESSON_CHECK_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isLessonCheckResponse(body)) throw new Error(errorDetail(body));
      if (alive.current) update(previous => acceptLessonCheck(previous, request, body));
    } catch (cause) {
      if (alive.current) setFailures(previous => ({ ...previous, [artifactId]: cause instanceof TypeError ? "" : cause instanceof Error ? cause.message : "" }));
    } finally {
      if (alive.current) setJudging(previous => { if (previous[artifactId] !== request.requestId) return previous; const { [artifactId]: _removed, ...rest } = previous; return rest; });
    }
  }
  async function runReveal(artifactId: string) {
    let request: LessonCheckRequest;
    try { request = buildLessonRevealRequest(recordRef.current, lesson, artifactId, crypto.randomUUID()); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "답을 볼 수 없습니다."); return; }
    setRevealing(previous => ({ ...previous, [artifactId]: request.requestId }));
    setNotice("");
    try {
      const response = await fetch(LESSON_CHECK_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isLessonCheckResponse(body)) throw new Error(errorDetail(body));
      if (alive.current) { update(previous => acceptLessonReveal(previous, request, body)); goToEnd(); }
    } catch (cause) {
      if (alive.current) setNotice(`답을 가져오지 못했습니다. 첫 답은 남아 있습니다.${cause instanceof Error && cause.message ? ` ${cause.message}` : ""} 다시 눌러 주십시오.`);
    } finally {
      if (alive.current) setRevealing(previous => { if (previous[artifactId] !== request.requestId) return previous; const { [artifactId]: _removed, ...rest } = previous; return rest; });
    }
  }
  /** The first answer or a revision becomes a new attempt, then the server judges it. The earlier attempts are never replaced. */
  function submitAttempt(event: FormEvent<HTMLFormElement>, artifact: LessonArtifact) {
    event.preventDefault();
    if (artifact.contentVersion !== lesson.contentVersion || judging[artifact.artifactId]) return;
    if (!artifact.inputs.some(input => input.trim())) { const field = event.currentTarget.querySelector<HTMLInputElement>("input"); field?.setCustomValidity("빈칸 하나 이상에 적어 주십시오."); field?.reportValidity(); return; }
    if (!commit(previous => submitLessonAttempt(registerLessonArtifact(previous, lesson, artifact.question.questionId), lesson, artifact.artifactId, { kind: "fill", inputs: [...artifact.inputs] }))) return;
    setNotice(""); goToEnd();
    void runCheck(artifact.artifactId);
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
      read: (result, requestId) => isLessonChatResponse(result) && result.requestId === requestId && result.lessonId === lesson.lessonId && result.artifactId === artifactId && result.questionId === questionId && result.contentVersion === artifact.contentVersion ? result : null,
      accept: (previous, reply) => acceptLessonReply(previous, reply),
    });
  }
  function newConversation() {
    const artifact = selected;
    if (!selectedLive || !confirm(`${labelOf(artifact)}의 새 대화를 엽니다. 이 카드의 이전 대화와 미전송 초안, 모든 카드의 답은 남아 있습니다. 계속합니까?`)) return;
    if (active.current?.artifactId === artifact.artifactId) turns.cancel();
    if (commit(previous => startThread(registerLessonArtifact(previous, lesson, artifact.question.questionId), artifact.artifactId))) { setNotice("이 카드의 새 대화를 열었습니다. 이전 대화는 위 흐름에 남아 있습니다."); goToEnd(); }
  }
  /** Only this lesson's record key is cleared. Other lessons and the reading position are untouched. */
  function restartFromNewVersion() {
    if (!confirm("이전 자료 판으로 남은 이 수업의 기록(모든 카드의 답·판정·대화)을 지우고 새 판으로 시작합니다. 되돌릴 수 없습니다. 지웁니까?")) return;
    turns.cancel(); store.unblock();
    try { localStorage.removeItem(keys.record); } catch { /* The new empty record is saved right after. */ }
    setJudging({}); setRevealing({}); setFailures({});
    if (commit(() => selectLessonQuestion(createLessonState(lesson), lesson, selectedId))) setNotice("이전 판의 기록을 지우고 새 판으로 시작했습니다.");
  }

  const saveWarning = <SaveWarning store={store} />;
  const outline: OutlineItem[] = cards.map((card, index) => ({ id: card.questionId, title: card.expression, label: `카드 ${index + 1}` }));

  function blanksView(sentence: string, markers = true) {
    return splitBlanks(sentence).map((piece, index, all) => <Fragment key={index}>{piece}{index < all.length - 1 && <span className="cl-gap">{markers && <span className="lw-sr-only">(빈칸 {index + 1})</span>}<span aria-hidden="true">{index + 1}</span></span>}</Fragment>);
  }
  function pending(artifact: LessonArtifact) { return !!judging[artifact.artifactId]; }
  function judgeStatus(artifact: LessonArtifact) {
    const last = artifact.attempts.at(-1);
    if (!last || last.check || artifact.contentVersion !== lesson.contentVersion) return null;
    if (pending(artifact)) return <div className="cl-judge-status" role="status"><span className="lw-pulse" />서버가 정본과 대조하고 있습니다…</div>;
    return <div className="cl-judge-status cl-judge-failed" role="alert"><p>판정을 받지 못했습니다. 답은 남아 있습니다.{failures[artifact.artifactId] ? ` ${failures[artifact.artifactId]}` : ""}</p><button type="button" onClick={() => void runCheck(artifact.artifactId)}>다시 판정</button></div>;
  }
  function attemptView(artifact: LessonArtifact, index: number) {
    const attempt = artifact.attempts[index]?.attempt;
    if (!attempt || attempt.kind !== "fill") return null;
    const after = madeAfterReveal(artifact, index);
    return <div className="lw-user-performance cl-attempt" data-attempt-index={index}><div className="lw-message-meta">나 · {labelOf(artifact)} · {attemptName(index)}{after && <span className="cl-after-reveal">답을 본 뒤</span>}</div><ol className="cl-attempt-inputs">{attempt.inputs.map((input, at) => <li key={at}><span>빈칸 {at + 1}</span> <span className="en">{input || "(비움)"}</span></li>)}</ol>{index > 0 && <p className="lw-performance-note">첫 답은 그대로 두고 새 시도로 따로 남긴 답입니다.</p>}{judgeStatus(artifact) && index === artifact.attempts.length - 1 && judgeStatus(artifact)}</div>;
  }
  function judgementView(artifact: LessonArtifact, index: number) {
    const check = artifact.attempts[index]?.check;
    if (!check || check.kind !== "fill") return null;
    return <div className="cl-judgement" data-judgement={check.allMatch ? "match" : "differ"} data-attempt-index={index}><div className="lw-message-meta"><span className="cl-judge-mark">판정</span> · {labelOf(artifact)} · {attemptName(index)}{madeAfterReveal(artifact, index) && <span className="cl-after-reveal">답을 본 뒤</span>}</div><p className="cl-judge-line">{check.allMatch ? "정본 답과 같습니다." : "정본 답과 다릅니다."}</p><ul className="cl-blank-results">{check.matches.map((match, at) => <li key={at} data-match={match}>빈칸 {at + 1} · {match ? "같음" : "다름"}</li>)}</ul><p className="lw-performance-note">서버가 정본과 대조한 결과입니다. 정본에 없는 자연스러운 답은 다르다고 나올 수 있습니다. AI의 말은 이 판정을 바꾸지 않습니다.</p></div>;
  }
  function revealView(artifact: LessonArtifact) {
    const reveal = artifact.reveal;
    if (!reveal) return null;
    return <div className="cl-judgement cl-reveal"><div className="lw-message-meta"><span className="cl-judge-mark">정본 답</span> · {labelOf(artifact)} · 답 보기</div><ul className="cl-blank-results">{reveal.response.answers.map((answer, at) => <li key={at}>빈칸 {at + 1} · <span className="en">{answer}</span></li>)}</ul><p className="lw-performance-note">첫 답을 낸 뒤에 연 정본 답입니다. 이 뒤의 시도에는 &ldquo;답을 본 뒤&rdquo;를 표시합니다.</p></div>;
  }

  function timelineEvent(event: LessonEvent): ReactNode {
    if (!("artifactId" in event)) return null;
    const artifact = record.artifacts.find(item => item.artifactId === event.artifactId);
    if (!artifact) return null;
    if (event.kind === "initial") return attemptView(artifact, 0);
    if (event.kind === "revision") return attemptView(artifact, event.index);
    if (event.kind === "check") return judgementView(artifact, event.index);
    if (event.kind === "reveal") return revealView(artifact);
    if (!("threadId" in event)) return null;
    const thread = artifact.threads.find(item => item.id === event.threadId);
    if (!thread) return null;
    if (event.kind === "thread") return <div className="lw-thread-divider"><h2>{labelOf(artifact)} · 새 대화</h2><p>이전 대화와 답은 남아 있습니다.</p></div>;
    if (!("turnId" in event)) return null;
    const turn = thread.turns.find(item => item.id === event.turnId);
    if (!turn) return null;
    const status = () => <RequestStatus label={labelOf(artifact)} turn={turn} requestId={event.requestId} current={thread.id === artifact.activeThreadId} waiting="내 답과 판정을 살펴보고 있습니다…" busy={busy} locked={artifact.contentVersion !== lesson.contentVersion}
      onRetry={() => void sendMessage(artifact.artifactId, turn.user, { threadId: thread.id, turnId: turn.id })}
      onDismiss={() => update(previous => dismissTurn(previous, artifact.artifactId, thread.id, turn.id, event.requestId))} />;
    if (event.kind === "reply") return <AssistantReply label={labelOf(artifact)} turn={turn} />;
    if (event.kind === "retry") return <div className="lw-retry-event"><p>{labelOf(artifact)}의 같은 질문을 다시 보냈습니다.</p>{status()}</div>;
    return <div className="lw-turn"><UserRequest label={labelOf(artifact)} turn={turn} />{status()}</div>;
  }

  function inputArea(): ReactNode {
    const artifact = selected, number = numberOf(selectedId), stage = selectedStage, last = artifact.attempts.at(-1);
    const reveal = artifact.reveal ? null : <><button type="button" className="lw-text-button cl-reveal-button" disabled={!hydrated || stage === "old" || !artifact.attempts.length || !!revealing[artifact.artifactId]} aria-describedby="cl-reveal-note" onClick={() => void runReveal(artifact.artifactId)}>{revealing[artifact.artifactId] ? "답을 가져오는 중…" : "답 보기"}</button><span id="cl-reveal-note" className="cl-reveal-note">{artifact.attempts.length ? "정본 답을 엽니다. 첫 답은 그대로 남습니다." : "답 보기는 첫 답을 낸 뒤에 열립니다."}</span></>;
    if (stage === "old") return <div className="lw-attempt-form cl-form-note" data-stage="old"><p>이 카드는 이전 자료 판의 기록입니다. 답과 판정, 대화를 읽기만 하고 새 답은 받지 않습니다.</p></div>;
    if (stage === "first" || stage === "revise") {
      const revising = stage === "revise", unchanged = revising && !!last && last.attempt.kind === "fill" && sameInputs(last.attempt.inputs, artifact.inputs);
      const lastCheck = last?.check?.kind === "fill" ? last.check : null;
      return <form key={`${artifact.artifactId}-${stage}`} className="lw-attempt-form lw-initial-input cl-fill-form" aria-label={`카드 ${number} ${revising ? "수정" : "첫 답"}`} data-artifact-id={artifact.artifactId} data-stage={stage} onSubmit={event => submitAttempt(event, artifact)}>
        <fieldset className="cl-blanks"><legend>{revising ? "수정한 답을 새 시도로 남깁니다" : "빈칸을 채웁니다"}</legend>
          {artifact.inputs.map((value, index) => <label className="cl-blank-row" key={index}><span className="cl-blank-name" aria-hidden="true">빈칸 {index + 1}</span><input aria-label={`빈칸 ${index + 1}`} className="en" value={value} maxLength={100} disabled={!hydrated} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={event => { event.target.setCustomValidity(""); update(previous => setCardInput(previous, lesson, selectedId, index, event.target.value)); }} />{revising && lastCheck && <span className="cl-prev-result" data-match={lastCheck.matches[index]}>직전 판정 · {lastCheck.matches[index] ? "같음" : "다름"}</span>}</label>)}
        </fieldset>
        <p className="lw-form-note">{revising ? "직전 답은 그대로 남기고 이 답을 새 시도로 판정합니다." : "첫 답을 남기면 서버가 정본과 대조합니다. AI는 부르지 않습니다."}{revising && last ? ` 수정 ${artifact.attempts.length}/${learningChatLimits.revisions}회 사용.` : ""}</p>
        <div className="lw-form-actions"><button className="lw-button lw-primary" type="submit" disabled={!hydrated || !!judging[artifact.artifactId] || unchanged}>{revising ? "수정해서 다시 판정" : "첫 답 남기기"} <span aria-hidden="true">→</span></button>{reveal}</div>
        {unchanged && <p className="lw-form-note">직전 답과 같은 내용은 새 시도로 남기지 않습니다.</p>}
        {saveWarning}
      </form>;
    }
    return <div className="lw-attempt-form cl-form-note" data-stage={stage}>
      {stage === "waiting" && (pending(artifact) ? <p>판정을 기다리고 있습니다. 답은 남아 있습니다.</p> : <p>판정을 받지 못한 답이 있습니다. 다시 판정할 수 있습니다.</p>)}
      {stage === "match" && <p>가장 최근 답이 정본 답과 같다고 판정됐습니다. 이 카드에 관한 질문은 계속할 수 있습니다.</p>}
      {stage === "limit" && <p>수정 {learningChatLimits.revisions}회 한도에 닿았습니다. 남은 답과 판정은 그대로 두고 질문은 계속할 수 있습니다.</p>}
      <div className="lw-form-actions">{stage === "waiting" && !pending(artifact) && <button type="button" className="lw-button" onClick={() => void runCheck(artifact.artifactId)}>다시 판정</button>}{reveal}</div>
      {saveWarning}
    </div>;
  }

  function composer(): ReactNode {
    const artifact = selected, first = artifact.attempts.length > 0, number = numberOf(selectedId);
    const blocked = !selectedLive || !!limit || unresolved;
    return <>
      {(limit || notice) && <div className="lw-chat-notice" role="status"><p>{limit || notice}</p>{limit && <button type="button" onClick={newConversation}>답을 유지하고 이 카드 새 대화</button>}</div>}
      <div className="lw-composer-tools"><span>{first ? `카드 ${number}에서 이어 가는 대화` : "답을 낸 뒤 AI에게 설명을 요청할 수 있습니다"}</span><button type="button" className="cl-explain" disabled={!hydrated || !first || busy || blocked || !selectedLive} onClick={() => void sendMessage(artifact.artifactId, explainRequestMessage)}>AI에게 설명 요청</button>{busy && <button type="button" className="lw-send lw-stop" onClick={turns.cancel}><Icon kind="stop" size={15} /><span>{active.current ? numberOf(byArtifact(active.current.artifactId)?.question.questionId || "") : ""}번 카드 응답 중단</span></button>}</div>
      <QuestionComposer artifactId={artifact.artifactId} label="이 카드에 대해 질문하기" value={artifact.messageDraft} placeholder={first ? `카드 ${number}에서 막힌 부분을 물어보십시오…` : "풀기 전에 궁금한 점을 물어보십시오…"} hydrated={hydrated} busy={busy} blocked={blocked}
        onChange={value => update(previous => setCardMessageDraft(previous, lesson, selectedId, value))} onSend={() => void sendMessage(artifact.artifactId, artifact.messageDraft)} />
      <p className="lw-ai-note">{first ? "AI는 사용자가 보낼 때만 부릅니다. AI의 답은 틀릴 수 있고 서버 판정을 바꾸지 않습니다." : "답 제출 전에는 AI 대신 무료 준비 안내를 제공합니다."}</p>
      {saveWarning}
    </>;
  }
  function byArtifact(artifactId: string) { return artifacts.find(item => item.artifactId === artifactId); }

  return <WorkspaceFrame shell={shell} lessonWord={<>{lesson.work.title} <span className="cl-unit-word">유닛 {lesson.unit.n}</span></>} save={{ text: store.saveText, failed: store.saveState === "failed" }} outline={outline}
    toolbarActions={<><a href={view.listHref} aria-label="이 작품의 유닛 목록" title="이 작품의 유닛 목록"><Icon kind="book" size={18} /><span>목록</span></a><button type="button" onClick={newConversation} disabled={!selectedLive}>이 카드 새 대화</button></>}
    toc={{ title: <>{lesson.work.title}{" "}<br />유닛 {lesson.unit.n}</>, lead: `${lesson.unit.when}에 익힐 표현을 카드마다 읽고 빈칸을 채웁니다.`, summary: <><p>카드 {cards.length}개{answered > 0 ? ` · 첫 답을 남긴 카드 ${answered}개` : ""}</p><p>문서 전체의 목차입니다. 읽기와 풀이는 원하는 순서로 합니다.</p></> }}
    referenceStack={null}
    documentHeading={<><p>사전 훈련 · {lesson.work.kind === "book" ? "책" : "영화"}</p><h2>{lesson.unit.when}에 익힐 표현 {cards.length}개</h2><div><span><i>{lesson.work.title}</i> · 유닛 {lesson.unit.n}</span><span>{lesson.unit.summary}</span></div></>}
    document={<>{cards.map((card, index) => {
      const artifact = byQuestion.get(card.questionId)!, old = artifact.contentVersion !== lesson.contentVersion;
      return <section className={`cl-card ${selectedId === card.questionId ? "cl-card-selected" : ""}`} data-outline-id={card.questionId} data-question-id={card.questionId} id={documentAnchorId(card.questionId)} tabIndex={-1} aria-labelledby={`${documentAnchorId(card.questionId)}-h`} key={card.questionId}>
        <div className="lw-document-section-label">{pad(index + 1)} / 표현 카드</div>
        <h2 id={card.questionId} className="cl-expression"><span id={`${documentAnchorId(card.questionId)}-h`} className="en">{card.expression}</span><span className="cl-count">{view.countLabel} {card.count}번{card.countInPart !== undefined ? ` · ${lesson.unit.n}부 ${card.countInPart}번` : ""}</span></h2>
        <dl className="cl-kv"><dt>뜻</dt><dd>{card.meaning}</dd><dt>감각</dt><dd>{card.sense}</dd></dl>
        <figure className="cl-example"><blockquote className="en">{card.example.text}</blockquote><figcaption>{placeLabel(lesson.work, card.example)}</figcaption></figure>
        <div className="cl-drill"><p className="cl-drill-label">빈칸 문장 · 한국어 힌트: {card.drill.hint}</p><p className="en cl-drill-sentence">{blanksView(card.drill.sentence)}</p><p className="cl-source">{placeLabel(lesson.work, card.drill)}</p></div>
        <p className="cl-basis">근거: {card.basis}</p>
        <footer className="cl-card-foot"><button type="button" aria-pressed={selectedId === card.questionId} aria-label={`카드 ${index + 1} ${card.expression} 이어 가기`} onClick={() => choose(card.questionId, true)}>이 카드로 이어 가기</button>{artifact.attempts.length > 0 && <span className="cl-card-fact">첫 답을 남겼습니다{artifact.attempts.length > 1 ? ` · 수정 ${artifact.attempts.length - 1}회` : ""}{artifact.reveal ? " · 답을 봤습니다" : ""}</span>}{old && <span className="cl-card-fact">이전 자료 판의 기록이 있어 읽기만 합니다.</span>}</footer>
      </section>;
    })}</>}
    documentEnd={<>
      {view.pairs.length > 0 && <section className="cl-pairs" aria-labelledby="pair-read-h"><h2 id="pair-read-h">이 표현으로 읽기</h2><div className="links">{view.pairs.map(story => <a className="link-card" key={story.id} href={`/reading/${story.id}/`}><span className="t">이 표현으로 읽기: <span className="en">{story.title}</span> ({minutes(story.limitSeconds)}) {story.draft && <span className="tag draft-tag">초안</span>}</span><span className="s">카드 표현으로 쓴 새 이야기 · {story.words}낱말 · 문제 {story.questions}개</span></a>)}</div></section>}
      <nav className="cl-pager" aria-label="다른 유닛">
        {view.prev ? <a href={view.prev.href}><span className="k">이전</span>유닛 {view.prev.n} · {view.prev.when}</a> : <a href={view.listHref}><span className="k">목록</span>{lesson.work.title} 유닛</a>}
        {view.next ? <a className="next" href={view.next.href}><span className="k">다음</span>유닛 {view.next.n} · {view.next.when}</a> : <a className="next" href="/prep/"><span className="k">목록</span>다른 작품</a>}
      </nav>
      <p className="lw-document-end">{lesson.work.title} 유닛 {lesson.unit.n} 문서 끝 · 카드 {cards.length}개 가운데 원하는 카드를 골라 풀 수 있습니다.</p>
    </>}
    chat={{
      context: <>
        <p className="lw-reading-context">입력 대상: <strong>{labelOf(selected)}</strong><span>{selected.attempts.length ? `첫 답 있음${selected.attempts.length > 1 ? ` · 수정 ${selected.attempts.length - 1}회` : ""}` : "첫 답 전"}</span></p>
        <div className="lw-target-selector"><label htmlFor="lw-target">함께 풀 카드</label><select id="lw-target" aria-label="함께 풀 카드" value={selectedId} onChange={event => choose(event.target.value)}>{cards.map((card, index) => <option key={card.questionId} value={card.questionId}>카드 {index + 1} · {card.expression}</option>)}</select></div>
        <p className="lw-target-question en">{blanksView(selectedCard.drill.sentence, false)}</p>
        <p className="lw-target-hint">한국어 힌트: {selectedCard.drill.hint}</p>
        <p className="lw-input-stage" role="status">{selectedStage === "old" ? "이전 자료 판의 기록은 읽기만 합니다" : selectedStage === "first" ? "빈칸을 채워 첫 답을 남깁니다" : selectedStage === "revise" || selectedStage === "limit" ? "새 시도로 수정을 남깁니다" : selectedStage === "waiting" ? "판정을 기다리는 답이 있습니다" : "이 카드에 관해 질문합니다"}</p>
        {outdated.length > 0 && <div className="cl-old-banner" role="status"><p>이전 자료 판으로 남은 기록이 {outdated.length}개 카드에 있습니다. 읽기만 하고 판정과 AI 전송을 막았습니다.</p><button type="button" onClick={restartFromNewVersion}>이 기록을 지우고 새 판으로 시작</button></div>}
      </>,
      timeline: <>{record.events.map(event => <div className="lw-timeline-event" data-event-kind={event.kind} data-artifact-id={"artifactId" in event ? event.artifactId : undefined} key={event.id}>{timelineEvent(event)}</div>)}</>,
      input: inputArea(),
      composer: composer(),
    }}
    dialog={null} />;
}

function dismissTurn(previous: LessonState, artifactId: string, threadId: string, turnId: string, requestId: string) {
  return markTurn(previous, artifactId, threadId, turnId, requestId, "cancelled", "실패한 요청을 접었습니다. 원래 질문은 그대로 남깁니다.");
}
export default CardLesson;
