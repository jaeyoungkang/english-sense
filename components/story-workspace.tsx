"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LESSON_CHECK_ENDPOINT, isLessonCheckResponse, type LessonCheckRequest } from "@/lib/lesson-contract";
import { isLessonChatResponse, type LessonChatRequest } from "@/lib/lesson-chat-contract";
import { LEARNING_CHAT_ENDPOINT, learningChatLimits } from "@/lib/learning-chat-contract";
import { activeThread, characterCount as chars, historyFor, startThread, threadLimit, updateArtifact, markTurn, type WorkspaceTurn } from "@/lib/learning-thread";
import { documentAnchorId } from "@/lib/document-workspace-state";
import { acceptLessonCheck, acceptLessonReply, beginLessonTurn, buildLessonCheckRequest, createLessonState, endReading, lessonAccess, lessonStorageKeys, loadLessonRecord, projectLessonArtifacts, readingStatus, registerLessonArtifact, retryLessonTurn, selectLessonQuestion, startReading, submitLessonAttempt, syncReading, type JudgementResponse, type LessonArtifact, type LessonEvent, type LessonReply, type LessonState } from "@/lib/lesson-workspace-state";
import type { PublicStoryLesson, PublicStoryQuestion, StoryLessonLinks } from "@/lib/lesson-registry";
import { clockLabel } from "@/lib/study-content";
import { Icon, WorkspaceFrame, useWorkspaceShell, type OutlineItem } from "@/components/workspace-shell";
import { SaveWarning, useRecordStore, useTurnRequests } from "@/components/workspace-session";
import { AssistantReply, QuestionComposer, RequestStatus, UserRequest } from "@/components/workspace-chat";

/**
 * A story lesson (`/reading/<id>/`): timed reading, seven choose questions and the side conversation on the shared workspace shell.
 * The record is lesson v4 (one key per lesson). The browser holds only the public projection; the answer, the explanation and the
 * basis arrive in the judgement response after the first answer.
 */

const kindLabel: Record<PublicStoryQuestion["kind"], string> = { content: "내용", sense: "표현의 감각", expression: "표현" };
const letter = (index: number) => String.fromCharCode(65 + index);
/** Questions and options are English, except the expression questions that ask for a Korean meaning. */
const langOf = (value: string) => /[가-힣]/.test(value) ? "ko" : "en";
/** The same sentence the scene lesson sends from its submit button. Here the learner sends it with "AI에게 설명 요청". */
const EXPLAIN_REQUEST = "처음 제출한 답과 이유를 장면에 비추어 설명해 주세요. 제가 떠올린 장면을 함께 살펴보고, 스스로 고쳐 볼 지점을 알려 주세요.";
const CHECK_TIMEOUT_MS = 20000;
type CheckFailure = { pending: boolean; message: string };

export function StoryWorkspace({ lesson, links }: { lesson: PublicStoryLesson; links: StoryLessonLinks }) {
  const keys = lessonStorageKeys(lesson.lessonId);
  const store = useRecordStore<LessonState>({
    key: keys.record,
    initial: () => createLessonState(lesson),
    load: () => { const loaded = loadLessonRecord(key => localStorage.getItem(key), lesson, Date.now()); if (!loaded.ok) throw new Error(loaded.message); return loaded.state; },
    overwritePrompt: "읽지 못한 이 이야기의 임시 기록을 화면의 내용으로 바꾸어 저장합니까? 읽지 못한 원본은 사라집니다.",
  });
  const { record, recordRef, update, hydrated } = store;
  const turns = useTurnRequests(store);
  const { busy, active } = turns;
  const [now, setNow] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [announce, setAnnounce] = useState("");
  const [checks, setChecks] = useState<Record<string, CheckFailure>>({});
  const checkingNow = useRef(new Set<string>());
  const [askBeforeFor, setAskBeforeFor] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);
  const titleFocus = useRef(false), titleRef = useRef<HTMLHeadingElement>(null);
  const announced = useRef({ marks: new Set<number>(), phase: "" });
  const shell = useWorkspaceShell({ storageKeys: { document: keys.document, layout: keys.layout }, documentMode: "plain", hydrated, lastEventId: record.events.at(-1)?.id || null, defaultAnchor: "reading", getLastEventId: () => recordRef.current.events.at(-1)?.id || null });
  const { goToEnd, moveToChat } = shell;

  // The clock is the wall clock. It starts after hydration so the first HTML never shows a time.
  useEffect(() => { if (hydrated) setNow(Date.now()); }, [hydrated]);
  const status = hydrated && now !== null ? readingStatus(record, now) : null;
  const phase = status?.phase ?? "loading";
  useEffect(() => {
    if (phase !== "reading") return;
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick); window.addEventListener("focus", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); };
  }, [phase]);
  // A passed deadline ends the reading once; the record writes the end at the deadline, not at this moment.
  useEffect(() => { if (hydrated && phase === "ended") update(previous => syncReading(previous, Date.now())); }, [hydrated, phase]);
  const remainingSeconds = status?.phase === "reading" ? Math.ceil(status.remainingMs / 1000) : null;
  useEffect(() => {
    const seen = announced.current;
    if (phase === "reading" && remainingSeconds !== null) {
      const mark = remainingSeconds <= 30 ? 30 : remainingSeconds <= 60 ? 60 : 0;
      if (mark && !seen.marks.has(mark)) { seen.marks.add(mark); if (mark === 30) seen.marks.add(60); setAnnounce(mark === 60 ? "남은 시간이 1분 이하입니다." : "남은 시간이 30초 이하입니다."); }
    } else if (phase === "ended" && seen.phase === "reading") setAnnounce("읽기가 끝났습니다. 본문을 가렸고 문제가 열렸습니다.");
    seen.phase = phase;
  }, [phase, remainingSeconds]);
  useEffect(() => {
    if (!titleFocus.current || (phase !== "reading" && phase !== "ended")) return;
    titleFocus.current = false; titleRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const artifacts = projectLessonArtifacts(record, lesson);
  const touch = (previous: LessonState, questionId: string) => registerLessonArtifact(previous, lesson, questionId);
  const selected = artifacts.find(artifact => artifact.question.questionId === record.selectedQuestionId) ?? artifacts[0];
  const numberOf = (artifact: LessonArtifact) => lesson.questions.findIndex(question => question.questionId === artifact.question.questionId) + 1;
  const targetLabel = (artifact: LessonArtifact) => `문제 ${numberOf(artifact)}`;
  const accessOf = (artifact: LessonArtifact) => lessonAccess(record, lesson, artifact);
  const answered = artifacts.filter(artifact => artifact.attempts.length > 0).length;
  const allAnswered = answered === artifacts.length;
  const oldVersion = record.artifacts.some(artifact => artifact.contentVersion !== lesson.contentVersion);

  function chooseTarget(questionId: string, input = false) {
    update(previous => selectLessonQuestion(touch(previous, questionId), lesson, questionId)); setNotice("");
    if (input) requestAnimationFrame(() => moveToChat(true));
  }
  function setChoice(artifact: LessonArtifact, choice: number) {
    update(previous => updateArtifact(touch(previous, artifact.question.questionId), artifact.artifactId, item => ({ ...item, choice })));
  }
  function startClock() { titleFocus.current = true; setAnnounce(""); announced.current = { marks: new Set(), phase: "" }; update(previous => startReading(previous, lesson, Date.now())); setNow(Date.now()); }
  function finishReading() { titleFocus.current = true; update(previous => endReading(previous, Date.now())); setNow(Date.now()); }
  function startOver() {
    if (!confirm("이 이야기의 이 브라우저 기록(읽기·첫 답·판정·대화·초안)을 지우고 새 판으로 시작합니다. 되돌릴 수 없습니다. 계속합니까?")) return;
    turns.cancel(); store.unblock(); checkingNow.current.clear(); setChecks({}); setPeek(false); setAskBeforeFor(null); setNotice("");
    update(() => createLessonState(lesson));
  }

  async function sendCheck(request: LessonCheckRequest) {
    const { artifactId } = request;
    if (checkingNow.current.has(artifactId)) return;
    checkingNow.current.add(artifactId);
    setChecks(previous => ({ ...previous, [artifactId]: { pending: true, message: "" } }));
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    let failure = "";
    try {
      const response = await fetch(LESSON_CHECK_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.signal });
      const result: unknown = await response.json().catch(() => null);
      if (response.status === 409) failure = "이 이야기가 고쳐져 자료 판이 달라졌습니다. 이 기록은 옛 판으로 남아 판정하지 않습니다.";
      else if (!response.ok || !isLessonCheckResponse(result)) failure = "판정을 받지 못했습니다.";
      else {
        const accepted = acceptLessonCheck(recordRef.current, request, result);
        if (accepted === recordRef.current && !recordRef.current.artifacts.find(item => item.artifactId === artifactId)?.attempts.at(-1)?.check) failure = "요청 대상과 맞는 판정을 읽지 못했습니다.";
        else update(previous => acceptLessonCheck(previous, request, result));
      }
    } catch (cause) { failure = cause instanceof Error && cause.name === "AbortError" ? "판정을 오래 기다려 중단했습니다." : "서버에 연결하지 못했습니다."; }
    finally { window.clearTimeout(timeout); checkingNow.current.delete(artifactId); }
    setChecks(previous => { const { [artifactId]: _gone, ...rest } = previous; return failure ? { ...rest, [artifactId]: { pending: false, message: failure } } : rest; });
  }
  function submitFirst(event: FormEvent<HTMLFormElement>, artifact: LessonArtifact) {
    event.preventDefault();
    if (artifact.attempts.length || artifact.choice === null || accessOf(artifact) !== "open") return;
    const id = artifact.artifactId, attempt = { kind: "choose" as const, choice: artifact.choice };
    let request: LessonCheckRequest;
    try { request = buildLessonCheckRequest(submitLessonAttempt(recordRef.current, lesson, id, attempt), lesson, id, crypto.randomUUID()); } catch (cause) { setNotice(cause instanceof Error ? cause.message : "첫 답을 남기지 못했습니다."); return; }
    update(previous => submitLessonAttempt(previous, lesson, id, attempt)); goToEnd();
    void sendCheck(request);
    requestAnimationFrame(() => moveToChat(true));
  }
  function recheck(artifact: LessonArtifact) {
    try { void sendCheck(buildLessonCheckRequest(recordRef.current, lesson, artifact.artifactId, crypto.randomUUID())); } catch (cause) { setNotice(cause instanceof Error ? cause.message : "판정을 다시 받지 못했습니다."); }
  }

  async function sendMessage(artifactId: string, message: string, origin: WorkspaceTurn["origin"] = "question", retry?: { threadId: string; turnId: string }) {
    const artifact = projectLessonArtifacts(recordRef.current, lesson).find(item => item.artifactId === artifactId), content = message.trim();
    if (!artifact || !content || chars(content) > learningChatLimits.message || active.current) return;
    const thread = retry ? artifact.threads.find(item => item.id === retry.threadId) : activeThread(artifact);
    if (!thread) return;
    if (lessonAccess(recordRef.current, lesson, artifact) !== "open") { setNotice(artifact.contentVersion !== lesson.contentVersion ? "이 문제의 자료 판이 현재 자료와 다릅니다. 당시 기록을 보존하고 AI 전송을 막았습니다." : "읽기를 마친 뒤에 질문할 수 있습니다."); return; }
    if (threadLimit(thread)) { setNotice("이 문제의 대화 길이 한도에 도달했습니다."); return; }
    if (!retry && thread.turns.some(turn => turn.status === "failed")) { setNotice("이 문제의 실패한 요청을 다시 보내거나 접은 뒤 질문합니다."); return; }
    const questionId = artifact.question.questionId, first = artifact.attempts[0]?.attempt ?? null;
    await turns.send({
      artifactId, threadId: thread.id, turnId: retry?.turnId, endpoint: LEARNING_CHAT_ENDPOINT,
      body: (requestId): LessonChatRequest => ({ lessonId: lesson.lessonId, questionId, contentVersion: artifact.contentVersion, artifactId, requestId, initialAttempt: first, revisions: [], messages: historyFor(thread), message: content }),
      onStart: () => { setNotice(""); goToEnd(); },
      begin: (previous, { requestId, turnId }) => {
        const touched = touch(previous, questionId);
        const next = retry ? retryLessonTurn(touched, lesson, artifactId, thread.id, turnId, requestId) : beginLessonTurn(touched, lesson, artifactId, { id: turnId, requestId, user: content, origin, status: "pending" });
        return origin === "question" && !retry ? updateArtifact(next, artifactId, item => ({ ...item, messageDraft: "" })) : next;
      },
      read: (result, requestId): LessonReply | null => isLessonChatResponse(result) && result.requestId === requestId && result.lessonId === lesson.lessonId && result.artifactId === artifactId && result.questionId === questionId && result.contentVersion === artifact.contentVersion ? result : null,
      accept: (previous, reply) => acceptLessonReply(previous, reply),
    });
  }
  function newConversation() {
    if (!confirm(`${targetLabel(selected)}의 새 대화를 엽니다. 이 문제의 이전 대화와 첫 답은 남아 있습니다. 계속합니까?`)) return;
    if (active.current?.artifactId === selected.artifactId) turns.cancel();
    update(previous => startThread(touch(previous, selected.question.questionId), selected.artifactId)); setNotice("이 문제의 새 대화를 열었습니다. 이전 대화는 위 흐름에 남아 있습니다."); goToEnd();
  }

  const selectedThread = activeThread(selected), selectedAccess = accessOf(selected), limit = threadLimit(selectedThread);
  const unresolved = selectedThread.turns.some(turn => turn.status === "failed");
  const firstAttempt = selected.attempts[0];
  const judging = checks[selected.artifactId];
  const explained = selectedThread.turns.some(turn => turn.origin === "submission");
  const inputMode = selectedAccess !== "open" ? "closed" : !firstAttempt ? (askBeforeFor === selected.artifactId ? "question" : "initial") : "question";
  const saveWarning = <SaveWarning store={store} />;

  const outline: OutlineItem[] = [{ id: "reading", title: lesson.title, label: "이야기 읽기" }, ...lesson.questions.map((question, index) => ({ id: `question-${question.questionId}`, title: `문제 ${index + 1}`, label: kindLabel[question.kind] }))];
  const optionTags = (artifact: LessonArtifact, index: number) => {
    const check = artifact.attempts[0]?.check, mine = artifact.attempts[0]?.attempt.kind === "choose" && artifact.attempts[0].attempt.choice === index;
    return [mine ? "내 첫 답" : "", check?.kind === "choose" && check.answerIndex === index ? "정본 답" : ""].filter(Boolean);
  };

  function firstAnswer(artifact: LessonArtifact) {
    const attempt = artifact.attempts[0]?.attempt;
    if (attempt?.kind !== "choose" || !("options" in artifact.question)) return null;
    return <div className="lw-user-performance"><div className="lw-message-meta">나 · {targetLabel(artifact)} · 처음 제출한 답</div><p className="lw-first-answer" lang={langOf(artifact.question.options[attempt.choice])}><b>{letter(attempt.choice)}.</b> {artifact.question.options[attempt.choice]}</p></div>;
  }
  function judgement(artifact: LessonArtifact, check: JudgementResponse) {
    if (check.kind !== "choose" || !("options" in artifact.question)) return null;
    const card = artifact.question.card ? links.cards[artifact.question.card] : undefined;
    return <div className="lw-judgement" role="group" aria-label={`${targetLabel(artifact)} 서버 판정`}>
      <div className="lw-message-meta"><span className="lw-judgement-mark">판정</span>{targetLabel(artifact)} · 정본과 대조한 결과 · AI 아님</div>
      <p className={`lw-judgement-line ${check.match ? "lw-judgement-same" : "lw-judgement-differs"}`}>{check.match ? "정본 답과 같습니다." : "정본 답과 다릅니다."}</p>
      <p className="lw-judgement-answer">정본 답: <span lang={langOf(artifact.question.options[check.answerIndex])}><b>{letter(check.answerIndex)}.</b> {artifact.question.options[check.answerIndex]}</span></p>
      <h3>정본 해설</h3><p className="lw-preserve">{check.explain}</p>
      {check.basis && <p className="lw-judgement-basis">근거: {check.basis}</p>}
      {card && <p className="lw-judgement-card"><a href={card.href}>카드에서 다시 보기: <span lang="en">{card.expression}</span></a></p>}
      <p className="lw-performance-note">정본 답과 같은지 비교한 결과이며, 정본에 없는 자연스러운 답이 있을 수 있습니다.</p>
    </div>;
  }
  function judgementState(artifact: LessonArtifact) {
    if (!artifact.attempts[0] || artifact.attempts[0].check) return null;
    const failure = checks[artifact.artifactId], old = artifact.contentVersion !== lesson.contentVersion;
    if (failure?.pending) return <div className="lw-judgement-status lw-waiting" role="status"><span className="lw-pulse" />{targetLabel(artifact)}의 판정을 기다리고 있습니다…</div>;
    if (old) return <div className="lw-judgement-status" role="status"><p>이 기록은 옛 판이라 판정을 받지 않습니다. 첫 답은 남아 있습니다.</p></div>;
    return <div className="lw-judgement-status lw-judgement-failed" role="status"><p>판정을 받지 못했습니다. 답은 남아 있습니다.</p>{failure?.message && <p className="lw-muted">{failure.message}</p>}<button type="button" onClick={() => recheck(artifact)}>다시 판정</button></div>;
  }
  function turnItems(artifact: LessonArtifact, turn: WorkspaceTurn, threadId: string, requestId: string) {
    return <RequestStatus label={targetLabel(artifact)} turn={turn} requestId={requestId} current={threadId === artifact.activeThreadId} waiting={artifact.attempts.length ? "내 답과 해설을 살펴보고 있습니다…" : "준비 안내를 가져오고 있습니다…"} busy={busy} locked={artifact.contentVersion !== lesson.contentVersion}
      onRetry={() => void sendMessage(artifact.artifactId, turn.user, turn.origin, { threadId, turnId: turn.id })}
      onDismiss={() => update(previous => markTurn(previous, artifact.artifactId, threadId, turn.id, requestId, "cancelled", "실패한 요청을 접었습니다. 원래 질문은 그대로 남깁니다."))} />;
  }
  function timelineEvent(event: LessonEvent): ReactNode {
    if (event.kind === "reading-start") return <p className="lw-reading-marker">읽기를 시작했습니다 · 제한 시간 {clockLabel(event.limitSeconds)}</p>;
    if (event.kind === "reading-end") {
      const start = record.events.find((item): item is Extract<LessonEvent, { kind: "reading-start" }> => item.kind === "reading-start" && item.readingId === event.readingId);
      return <p className="lw-reading-marker">읽기를 마쳤습니다 · 읽은 시간 {start ? clockLabel((event.endedAt - start.startedAt) / 1000) : "-"} · {event.by === "time" ? "시간 마감" : "직접 마침"}</p>;
    }
    const artifact = artifacts.find(item => item.artifactId === event.artifactId);
    if (!artifact) return null;
    if (event.kind === "initial") return <>{firstAnswer(artifact)}{judgementState(artifact)}</>;
    if (event.kind === "check") { const check = artifact.attempts[event.index]?.check; return check ? judgement(artifact, check) : null; }
    if (!("threadId" in event)) return null;
    const thread = artifact.threads.find(item => item.id === event.threadId);
    if (!thread) return null;
    if (event.kind === "thread") return <div className="lw-thread-divider"><h2>{targetLabel(artifact)} · 새 대화</h2><p>이전 대화와 첫 답은 남아 있습니다.</p></div>;
    if (!("turnId" in event)) return null;
    const turn = thread.turns.find(item => item.id === event.turnId);
    if (!turn) return null;
    if (event.kind === "reply") return <AssistantReply label={targetLabel(artifact)} turn={turn} />;
    if (event.kind === "retry") return <div className="lw-retry-event"><p>{targetLabel(artifact)}의 같은 질문을 다시 보냈습니다.</p>{turnItems(artifact, turn, thread.id, event.requestId)}</div>;
    return <div className="lw-turn"><UserRequest label={targetLabel(artifact)} turn={turn} sentVia="‘AI에게 설명 요청’ 단추로 보낸 요청" />{turnItems(artifact, turn, thread.id, event.requestId)}</div>;
  }

  const body = <div className="lw-story-body" lang="en">{lesson.paragraphs.map((paragraph, index) => <p key={index}>{paragraph.map((piece, at) => piece.em ? <i key={at}>{piece.text}</i> : piece.text)}</p>)}</div>;
  const readMs = status?.phase === "ended" ? status.readMs : 0;
  const readingZone = <>
    {phase === "ended" ? <>
      <div className="lw-body-hidden"><p>본문을 가렸습니다 · 읽은 시간 {clockLabel(readMs / 1000)}{status?.phase === "ended" && status.by === "time" ? " (시간 마감)" : ""}</p>
        <button type="button" className="lw-button" disabled={!allAnswered} aria-describedby="lw-peek-note" onClick={() => setPeek(open => !open)} aria-expanded={allAnswered && peek}>{peek && allAnswered ? "본문 가리기" : "본문 확인하기"}</button>
        <p id="lw-peek-note" className="lw-form-note">{allAnswered ? "모든 문제에 첫 답을 남겨 본문을 확인할 수 있습니다. 확인은 기록에 남지 않습니다." : "모든 문제에 첫 답을 남기면 본문 확인이 열립니다."}</p></div>
      {peek && allAnswered && body}
    </> : phase === "reading" ? <>
      <p className="lw-reading-clock" aria-hidden="true">남은 시간 <b>{clockLabel(remainingSeconds ?? 0)}</b></p>
      {body}
      <div className="lw-reading-finish"><button type="button" className="lw-button" onClick={finishReading}>다 읽었으니 본문을 가립니다</button></div>
    </> : <div className="lw-reading-gate">
      <p>제한 시간 <b>{clockLabel(lesson.limitSeconds)}</b> · {lesson.words}낱말 · 문제 {lesson.questions.length}개</p>
      <p className="lw-form-note">시작을 누르면 시간이 흐릅니다. 다 읽으면 본문이 가려지니 한 번에 집중해서 읽으십시오. 문제는 읽기를 마치면 열립니다.</p>
      <button type="button" className="lw-button lw-primary" onClick={startClock} disabled={!hydrated || now === null}>읽기 시작</button>
    </div>}
  </>;

  function questionSection(artifact: LessonArtifact, index: number) {
    const question = artifact.question as PublicStoryQuestion, access = accessOf(artifact), isOpen = access !== "reading-not-ended", number = index + 1;
    const first = artifact.attempts[0];
    return <div className="lw-content-artifact" data-outline-id={`question-${question.questionId}`} id={documentAnchorId(`question-${question.questionId}`)} tabIndex={-1} key={question.questionId}>
      <div className="lw-document-section-label">{String(index + 2).padStart(2, "0")} / 문제 · {kindLabel[question.kind]}</div>
      <section className={`lw-quiz-artifact lw-story-question ${selected.question.questionId === question.questionId ? "lw-artifact-selected" : ""}`} data-artifact-id={artifact.artifactId} data-question-id={question.questionId} data-content-version={artifact.contentVersion} aria-label={`문제 ${number}`}>
        <header className="lw-artifact-header"><div><span className="lw-artifact-index">문제 {number}</span><span>{kindLabel[question.kind]}</span></div>{isOpen && <button type="button" aria-pressed={selected.question.questionId === question.questionId} onClick={() => chooseTarget(question.questionId, true)}>이 문제로 풀기</button>}</header>
        {isOpen ? <>
          <h2 className="lw-story-ask" lang={langOf(question.question)}>{question.question}</h2>
          <ol className="lw-question-options" aria-label={`문제 ${number} 보기`}>{question.options.map((option, at) => <li key={at} lang={langOf(option)}>{option}{optionTags(artifact, at).map(tag => <span className="lw-option-tag" key={tag}>{tag}</span>)}</li>)}</ol>
          {first ? <p className="lw-form-note">첫 답을 남겼습니다. 판정과 해설은 대화에서 봅니다.</p> : access === "old-version" ? null : <p className="lw-form-note">첫 답은 대화 영역에서 남깁니다.</p>}
          {access === "old-version" && <p className="lw-version-warning">이 문제는 옛 판의 기록입니다. 당시 내용을 읽기만 하고 판정과 AI 전송은 하지 않습니다.</p>}
        </> : <><h2>문제 {number}</h2><p className="lw-locked-note">읽기를 마치면 열립니다.</p></>}
      </section>
    </div>;
  }

  const timerControls = phase === "reading" ? <span className="lw-reading-controls">
    <span className="lw-reading-timer" role="timer" aria-live="off" aria-label="남은 시간">남은 시간 <b>{clockLabel(remainingSeconds ?? 0)}</b></span>
    <button type="button" onClick={finishReading}>다 읽었습니다</button>
  </span> : null;

  return <WorkspaceFrame shell={shell} lessonWord={<><span className="lw-story-word" lang="en">{lesson.title}</span>{lesson.draft && <span className="tag draft-tag">초안</span>}</>} save={{ text: store.saveText, failed: store.saveState === "failed" }} outline={outline}
    toolbarActions={<>{timerControls}<span className="lw-sr-only" role="status">{announce}</span><a href="/reading/" aria-label="수업 목록"><Icon kind="book" size={18} /><span>수업 목록</span></a></>}
    toc={{ title: <>이야기 수업<br />학습 문서</>, lead: "이야기를 읽고, 본문을 가린 뒤 문제를 풉니다.", summary: <><p>이야기 1개 · 문제 {lesson.questions.length}개</p>{answered > 0 && <p>첫 답을 남긴 문제 {answered}개</p>}<p>문서 전체의 목차입니다. 문제는 원하는 순서로 풉니다.</p></> }}
    referenceStack={null}
    documentHeading={<><p>ENGLISH SENSE · TIMED READING</p><h2>읽고, 가리고, 떠올리기</h2><div><span>{lesson.draft ? "초안 · " : ""}{lesson.words}낱말 · 문제 {lesson.questions.length}개</span></div>
      {links.pair && <p className="pair-note"><i>{links.pair.workTitle}</i> 유닛 {links.pair.unit} 표현으로 쓴 이야기입니다. <a href={links.pair.href}>유닛 {links.pair.unit} 카드 보기</a></p>}
      {lesson.draft && <p className="lw-draft-note">초안은 강PD가 아직 읽고 통과시키지 않은 이야기입니다. 어색한 영어가 섞여 있을 수 있습니다.</p>}
      {oldVersion && <div className="lw-old-version" role="note"><p>이 이야기가 고쳐져 자료 판이 바뀌었습니다. 옛 판으로 남긴 답과 대화는 읽기만 하고, 그 문제의 판정과 AI 전송은 막았습니다.</p><button type="button" onClick={startOver}>이 기록을 지우고 새 판으로 시작</button><p className="lw-form-note">지우면 되돌릴 수 없습니다. 이 이야기의 기록 하나만 지우고 다른 수업은 그대로입니다.</p></div>}</>}
    document={<>
      <div className="lw-content-artifact lw-story-reading" data-outline-id="reading" data-phase={phase} id={documentAnchorId("reading")} tabIndex={-1}>
        <div className="lw-document-section-label">01 / 이야기 읽기</div>
        <section className="lw-reading-zone" aria-labelledby="lw-reading-title">
          <h2 id="lw-reading-title" ref={titleRef} tabIndex={-1} lang="en">{lesson.title}</h2>
          {readingZone}
        </section>
      </div>
      {artifacts.map(questionSection)}
    </>}
    documentEnd={<p className="lw-document-end">{lesson.title} 학습 문서 끝 · 문제 {lesson.questions.length}개 가운데 원하는 문제를 골라 풀 수 있습니다.</p>}
    chat={{
      context: <><p className="lw-reading-context">입력 대상: <strong>{targetLabel(selected)} · {kindLabel[(selected.question as PublicStoryQuestion).kind]}</strong></p>
        <div className="lw-target-selector"><label htmlFor="lw-target">풀 문제</label><select id="lw-target" aria-label="풀 문제" value={selected.question.questionId} onChange={event => chooseTarget(event.target.value)}>{artifacts.map(artifact => <option key={artifact.artifactId} value={artifact.question.questionId}>문제 {numberOf(artifact)} · {kindLabel[(artifact.question as PublicStoryQuestion).kind]}{artifact.attempts.length ? " · 첫 답 있음" : ""}</option>)}</select></div>
        <p className="lw-target-question" lang={selectedAccess === "reading-not-ended" ? "ko" : langOf((selected.question as PublicStoryQuestion).question)}>{selectedAccess === "reading-not-ended" ? "읽기를 마치면 문제가 열립니다." : (selected.question as PublicStoryQuestion).question}</p>
        <p className="lw-input-stage" role="status">{selectedAccess === "reading-not-ended" ? (phase === "reading" ? "읽는 중에는 대화 입력을 닫아 둡니다" : "읽기를 시작하고 마치면 입력이 열립니다") : selectedAccess === "old-version" ? "옛 판 기록 · 읽기만 합니다" : !firstAttempt ? "보기를 골라 첫 답을 남깁니다" : judging?.pending ? "판정을 기다립니다" : !firstAttempt.check ? "판정을 받지 못했습니다 · 답은 남아 있습니다" : "판정됨 · 이 문제에 관해 질문할 수 있습니다"}</p></>,
      timeline: <>{record.events.length === 0 && <p className="lw-muted">읽기를 시작하면 읽기와 수행, 판정, 대화가 일어난 순서대로 여기에 쌓입니다.</p>}{record.events.map(event => <div className="lw-timeline-event" data-event-kind={event.kind} data-artifact-id={"artifactId" in event ? event.artifactId : undefined} key={event.id}>{timelineEvent(event)}</div>)}</>,
      input: inputMode === "initial" ? <form key={selected.artifactId} className="lw-attempt-form lw-initial-input" aria-label={`${targetLabel(selected)} 첫 답`} onSubmit={event => submitFirst(event, selected)}>
        <fieldset><legend>어떤 보기를 고르겠습니까?</legend>{(selected.question as PublicStoryQuestion).options.map((option, index) => <label className="lw-option" key={index}><input type="radio" name="choice" value={index} checked={selected.choice === index} onChange={() => setChoice(selected, index)} required /><span lang={langOf(option)}><b>{letter(index)}.</b> {option}</span></label>)}</fieldset>
        <button className="lw-button lw-primary" type="submit" disabled={!hydrated || busy}>첫 답 남기기 <span aria-hidden="true">→</span></button>
        <p className="lw-form-note">남기면 서버가 정본 답과 비교해 판정합니다. 판정에는 AI를 쓰지 않습니다. 정본 답과 해설은 그때 나옵니다.</p>{saveWarning}</form> : null,
      composer: <>
        {(limit || notice) && <div className="lw-chat-notice" role="status"><p>{limit ? "이 문제의 대화 길이 한도에 도달했습니다. 내용을 자르지 않고 보존합니다. 새 대화를 열 수 있습니다." : notice}</p>{limit && <button type="button" onClick={newConversation}>이 문제 새 대화</button>}</div>}
        {inputMode === "closed" ? <p className="lw-locked-note">{selectedAccess === "old-version" ? "옛 판 기록이라 질문을 보내지 않습니다. 기록은 읽을 수 있습니다." : phase === "reading" ? "읽는 중에는 대화 입력을 닫아 둡니다. 읽기를 마치면 열립니다." : "읽기를 마치면 대화 입력이 열립니다."}</p> : <>
          <div className="lw-composer-tools"><span>{inputMode === "initial" ? "첫 답 전 질문은 AI 대신 무료 준비 안내로 답합니다." : firstAttempt ? `${targetLabel(selected)}에서 이어 가는 대화` : "답 제출 전 · 무료 준비 안내"}</span>
            {!firstAttempt && <button type="button" onClick={() => { setAskBeforeFor(inputMode === "initial" ? selected.artifactId : null); requestAnimationFrame(() => moveToChat(true)); }}>{inputMode === "initial" ? "답하기 전에 질문하기" : "첫 답 이어 쓰기"}</button>}
            {firstAttempt && !explained && <button type="button" disabled={busy || unresolved || !!limit} onClick={() => void sendMessage(selected.artifactId, EXPLAIN_REQUEST, "submission")}>AI에게 설명 요청</button>}
            {busy && <button type="button" className="lw-send lw-stop" onClick={turns.cancel}><Icon kind="stop" size={15} /><span>{active.current ? `문제 ${numberOf(artifacts.find(item => item.artifactId === active.current!.artifactId) ?? selected)}` : ""} 응답 중단</span></button>}</div>
          {inputMode === "question" && <QuestionComposer artifactId={selected.artifactId} label="이 문제에 대해 질문하기" value={selected.messageDraft} placeholder={firstAttempt ? `${targetLabel(selected)}에서 막힌 부분을 물어보십시오…` : "풀기 전에 궁금한 점을 물어보십시오…"} hydrated={hydrated} busy={busy} blocked={!!limit || unresolved} onChange={value => update(previous => updateArtifact(touch(previous, selected.question.questionId), selected.artifactId, item => ({ ...item, messageDraft: value })))} onSend={() => void sendMessage(selected.artifactId, selected.messageDraft)} />}
          <p className="lw-ai-note">{firstAttempt ? "AI는 단추를 누르거나 질문을 보낼 때만 부릅니다. AI의 답은 틀릴 수 있고, 서버 판정은 바뀌지 않습니다." : "답 제출 전에는 AI 대신 무료 준비 안내를 제공합니다."}</p></>}
        {saveWarning}</>,
    }}
    dialog={null} />;
}
export default StoryWorkspace;
