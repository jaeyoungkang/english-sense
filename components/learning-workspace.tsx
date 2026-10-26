"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type FormEvent, type ReactNode } from "react";
import { LEARNING_CHAT_ENDPOINT, LEARNING_LESSON_ID, isLearningChatResponse, learningChatLimits, type LearningChatMessage, type LearningChatRequest } from "@/lib/learning-chat-contract";

/** Only scene and prompt data cross the initial server/client boundary. */
export type LearningWorkspaceQuestion = { ch: number; who: string; scene: string; ask: string; opts: { t: string }[] };
type Attempt = { choice: number; reason: string };
type Turn = { id: string; requestId: string; user: string; origin: "question" | "submission"; status: "pending" | "complete" | "failed" | "cancelled"; reply?: string; mode?: "guidance" | "ai"; error?: string };
type Pane = "scene" | "attempt" | "chat";
type WorkspaceRecord = { version: 1; lessonId: string; choice: string; reason: string; initialAttempt: Attempt | null; revisionDraft: string; revisions: { text: string }[]; messageDraft: string; turns: Turn[]; archives: { id: string; turns: Turn[]; draft: string }[]; pane: Pane };
const STORAGE_KEY = "english-sense-learning-workspace-v1";
const fresh = (): WorkspaceRecord => ({ version: 1, lessonId: LEARNING_LESSON_ID, choice: "", reason: "", initialAttempt: null, revisionDraft: "", revisions: [], messageDraft: "", turns: [], archives: [], pane: "scene" });
const chars = (text: string) => [...text].length;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validTurn(turn: unknown): turn is Turn {
  return object(turn) && typeof turn.id === "string" && typeof turn.requestId === "string" && typeof turn.user === "string" && chars(turn.user) <= learningChatLimits.message && ["question", "submission"].includes(turn.origin as string) && ["pending", "complete", "failed", "cancelled"].includes(turn.status as string) && (turn.reply === undefined || (typeof turn.reply === "string" && chars(turn.reply) <= learningChatLimits.reply)) && (turn.mode === undefined || ["guidance", "ai"].includes(turn.mode as string)) && (turn.error === undefined || typeof turn.error === "string") && (turn.status !== "complete" || (typeof turn.reply === "string" && ["guidance", "ai"].includes(turn.mode as string)));
}
function validRecord(value: unknown): value is WorkspaceRecord {
  if (!object(value) || value.version !== 1 || value.lessonId !== LEARNING_LESSON_ID || !["", "0", "1", "2"].includes(value.choice as string) || typeof value.reason !== "string" || chars(value.reason) > learningChatLimits.reason || typeof value.revisionDraft !== "string" || chars(value.revisionDraft) > learningChatLimits.revision || typeof value.messageDraft !== "string" || chars(value.messageDraft) > learningChatLimits.message || !["scene", "attempt", "chat"].includes(value.pane as string)) return false;
  if (value.initialAttempt !== null && (!object(value.initialAttempt) || ![0, 1, 2].includes(value.initialAttempt.choice as number) || typeof value.initialAttempt.reason !== "string" || !value.initialAttempt.reason.trim() || chars(value.initialAttempt.reason) > learningChatLimits.reason)) return false;
  return Array.isArray(value.revisions) && value.revisions.length <= learningChatLimits.revisions && value.revisions.every(r => object(r) && typeof r.text === "string" && !!r.text.trim() && chars(r.text) <= learningChatLimits.revision) && Array.isArray(value.turns) && value.turns.every(validTurn) && Array.isArray(value.archives) && value.archives.every(a => object(a) && typeof a.id === "string" && typeof a.draft === "string" && Array.isArray(a.turns) && a.turns.every(validTurn));
}
function historyFor(turns: Turn[]): LearningChatMessage[] { return turns.filter(turn => turn.status === "complete").flatMap(turn => [{ role: "user" as const, content: turn.user }, { role: "assistant" as const, content: turn.reply! }]); }
function historyLimit(turns: Turn[]): string | null {
  const history = historyFor(turns);
  if (history.length > learningChatLimits.historyMessages || history.some(message => chars(message.content) > learningChatLimits.historyMessage) || history.reduce((sum, message) => sum + chars(message.content), 0) > learningChatLimits.historyCharacters) return "이 대화가 전송할 수 있는 길이에 도달했습니다. 맥락을 자르지 않고 남겨 둡니다. 새 대화를 열면 처음 답과 수정은 그대로 이어집니다.";
  return null;
}
function Icon({ kind, size = 20 }: { kind: "scene" | "attempt" | "chat" | "arrow" | "book" | "close" | "stop"; size?: number }) {
  const paths: Record<string, ReactNode> = { scene: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m4 16 5-5 4 4 3-3 5 5M16 8h.01" /></>, attempt: <><path d="m4 20 4-1 12-12-3-3L5 16l-1 4ZM14 7l3 3" /></>, chat: <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />, arrow: <path d="M12 20V4m-6 6 6-6 6 6" />, book: <><path d="M12 5v15M3 4c4-1 6-1 9 1 3-2 5-2 9-1v15c-4-1-6-1-9 1-3-2-5-2-9-1V4Z" /></>, close: <path d="m6 6 12 12M6 18 18 6" />, stop: <rect x="6" y="6" width="12" height="12" /> };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

export function LearningWorkspace({ question }: { question: LearningWorkspaceQuestion }) {
  const [record, setRecord] = useState<WorkspaceRecord>(fresh);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"loading" | "saved" | "failed">("loading");
  const [busy, setBusy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [dialog, setDialog] = useState<"resources" | "records" | null>(null);
  const [notice, setNotice] = useState("");
  const recordRef = useRef(record);
  const readBlocked = useRef(false);
  const alive = useRef(true);
  const active = useRef<{ controller: AbortController; requestId: string; turnId: string } | null>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const sceneImage = useRef<HTMLImageElement>(null);
  const stickToEnd = useRef(true);
  const modal = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const paneFocus = useRef<Partial<Record<Pane, { id: string; start?: number | null; end?: number | null }>>>({});
  recordRef.current = record;
  const update = useCallback((change: (previous: WorkspaceRecord) => WorkspaceRecord) => {
    setRecord(previous => { const next = change(previous); recordRef.current = next; return next; });
  }, []);

  useEffect(() => {
    alive.current = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const restored: unknown = JSON.parse(raw);
        if (!validRecord(restored)) throw new Error("invalid record");
        restored.turns = restored.turns.map(turn => turn.status === "pending" ? { ...turn, status: "cancelled", error: "화면을 닫아 응답 기다리기를 중단했습니다. 자동으로 다시 전송하지 않습니다." } : turn);
        setRecord(restored);
      }
    } catch { readBlocked.current = true; setSaveState("failed"); }
    setHydrated(true);
    return () => { alive.current = false; active.current?.controller.abort(); active.current = null; };
  }, []);

  const persist = useCallback((value: WorkspaceRecord) => {
    try { if (readBlocked.current) throw new Error("unreadable record"); localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); setSaveState("saved"); }
    catch { setSaveState("failed"); }
  }, []);
  useEffect(() => { if (hydrated) persist(record); }, [record, hydrated, persist]);
  useEffect(() => { const image = sceneImage.current; if (hydrated && image?.complete && image.naturalWidth === 0) setImageFailed(true); }, [hydrated]);
  useEffect(() => {
    if (stickToEnd.current && chatScroll.current) chatScroll.current.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "instant" });
  }, [record.turns, busy]);
  useEffect(() => {
    if (!dialog || !modal.current) return;
    returnFocus.current = document.activeElement as HTMLElement;
    modal.current.showModal();
  }, [dialog]);
  useEffect(() => {
    const openLinkedResources = () => { if (["#words", "#resources"].includes(window.location.hash)) setDialog("resources"); };
    openLinkedResources();
    window.addEventListener("hashchange", openLinkedResources);
    return () => window.removeEventListener("hashchange", openLinkedResources);
  }, []);

  function retryStorage() {
    if (readBlocked.current && !confirm("기존 임시 기록을 읽지 못했습니다. 현재 화면의 내용으로 바꾸어 저장합니까?")) return;
    readBlocked.current = false; persist(recordRef.current);
  }
  function cancelRequest() {
    const request = active.current;
    if (!request) return;
    active.current = null; request.controller.abort(); setBusy(false);
    update(previous => ({ ...previous, turns: previous.turns.map(turn => turn.id === request.turnId ? { ...turn, status: "cancelled", error: "응답 기다리기를 중단했습니다. 이미 시작한 외부 호출의 비용까지 취소되지는 않을 수 있습니다." } : turn) }));
  }
  function closeDialog() { modal.current?.close(); setDialog(null); requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true })); }
  function changePane(pane: Pane) {
    const focused = document.activeElement;
    if (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) paneFocus.current[record.pane] = { id: focused.id, ...(focused instanceof HTMLTextAreaElement ? { start: focused.selectionStart, end: focused.selectionEnd } : {}) };
    update(previous => ({ ...previous, pane }));
    requestAnimationFrame(() => {
      if (!window.matchMedia("(max-width: 900px)").matches) return;
      const saved = paneFocus.current[pane], element = saved ? document.getElementById(saved.id) : document.getElementById(`lw-${pane}-heading`);
      element?.focus({ preventScroll: true });
      if (element instanceof HTMLTextAreaElement && typeof saved?.start === "number") element.setSelectionRange(saved.start, saved.end ?? saved.start);
    });
  }
  function startNewChat() {
    const current = recordRef.current;
    if ((current.turns.length || current.messageDraft) && !confirm("현재 대화와 작성 중 메시지를 지난 대화에 남기고 새 대화를 엽니다. 처음 답과 수정은 유지합니다. 계속합니까?")) return;
    cancelRequest();
    update(previous => ({ ...previous, archives: previous.turns.length || previous.messageDraft ? [...previous.archives, { id: crypto.randomUUID(), turns: previous.turns, draft: previous.messageDraft }] : previous.archives, turns: [], messageDraft: "" }));
    setNotice("새 대화를 열었습니다. 처음 답과 수정한 답은 계속 전달합니다.");
    stickToEnd.current = true;
  }
  async function sendMessage(message: string, origin: Turn["origin"] = "question", initialOverride?: Attempt, retryTurn?: Turn) {
    const current = recordRef.current;
    const content = message.trim();
    if (!content || chars(content) > learningChatLimits.message || active.current) return;
    const limit = historyLimit(current.turns);
    if (limit) { setNotice(limit); return; }
    if (!retryTurn && current.turns.some(turn => turn.status === "failed")) { setNotice("실패한 요청을 다시 보내거나 접은 뒤 다음 질문을 보냅니다."); return; }
    const requestId = crypto.randomUUID();
    const turnId = retryTurn?.id || crypto.randomUUID();
    const controller = new AbortController();
    const request = { controller, requestId, turnId };
    active.current = request; setBusy(true); setNotice(""); stickToEnd.current = true;
    const body: LearningChatRequest = { lessonId: LEARNING_LESSON_ID, requestId, initialAttempt: initialOverride || current.initialAttempt, revisions: current.revisions, messages: historyFor(current.turns), message: content };
    update(previous => ({ ...previous, messageDraft: origin === "question" && !retryTurn ? "" : previous.messageDraft, turns: retryTurn ? previous.turns.map(turn => turn.id === turnId ? { ...turn, requestId, status: "pending", error: undefined } : turn) : [...previous.turns, { id: turnId, requestId, user: content, origin, status: "pending" }] }));
    const timeout = window.setTimeout(() => controller.abort(), 70000);
    try {
      const response = await fetch(LEARNING_CHAT_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(object(result) && typeof result.detail === "string" ? result.detail : "응답을 받지 못했습니다. 같은 질문을 다시 보낼 수 있습니다.");
      if (!isLearningChatResponse(result) || result.requestId !== requestId) throw new Error("요청과 맞는 응답을 읽지 못했습니다. 같은 질문을 다시 보낼 수 있습니다.");
      if (!alive.current || active.current?.requestId !== requestId) return;
      update(previous => ({ ...previous, turns: previous.turns.map(turn => turn.id === turnId && turn.requestId === requestId ? { ...turn, reply: result.reply, mode: result.mode, status: "complete" } : turn) }));
    } catch (cause) {
      if (!alive.current || active.current?.requestId !== requestId) return;
      const message = cause instanceof Error && cause.name === "AbortError" ? "응답을 오래 기다려 중단했습니다. 같은 질문을 다시 보낼 수 있습니다." : cause instanceof TypeError ? "서버에 연결하지 못했습니다. 질문은 남아 있습니다." : cause instanceof Error ? cause.message : "응답을 받지 못했습니다. 질문은 남아 있습니다.";
      update(previous => ({ ...previous, turns: previous.turns.map(turn => turn.id === turnId && turn.requestId === requestId ? { ...turn, status: "failed", error: message } : turn) }));
    } finally {
      window.clearTimeout(timeout);
      if (active.current?.requestId === requestId) { active.current = null; if (alive.current) setBusy(false); }
    }
  }
  function submitAttempt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (record.initialAttempt || busy) return;
    const initialAttempt = { choice: Number(record.choice), reason: record.reason.trim() };
    if (!record.choice || !initialAttempt.reason) {
      const reason = event.currentTarget.querySelector<HTMLTextAreaElement>("#lw-reason");
      reason?.setCustomValidity("고른 까닭을 한 글자 이상 적어 주십시오."); reason?.reportValidity(); return;
    }
    update(previous => ({ ...previous, initialAttempt, pane: "chat" }));
    requestAnimationFrame(() => document.getElementById("lw-chat-heading")?.focus({ preventScroll: true }));
    void sendMessage("처음 제출한 답과 이유를 장면에 비추어 설명해 주세요. 제가 떠올린 장면을 함께 살펴보고, 스스로 고쳐 볼 지점을 알려 주세요.", "submission", initialAttempt);
  }
  function submitRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const text = record.revisionDraft.trim();
    if (!text) { const input = event.currentTarget.querySelector<HTMLTextAreaElement>("#lw-revision"); input?.setCustomValidity("수정한 답을 한 글자 이상 적어 주십시오."); input?.reportValidity(); return; }
    if (record.revisions.length >= learningChatLimits.revisions) return;
    update(previous => ({ ...previous, revisions: [...previous.revisions, { text }], revisionDraft: "" }));
    setNotice("수정한 답을 남겼습니다. 다음 대화 요청에 함께 전달합니다.");
  }
  const limit = historyLimit(record.turns);
  const unresolved = record.turns.some(turn => turn.status === "failed");
  const saveText = !hydrated ? "임시 기록 확인 중" : saveState === "failed" ? "임시 저장 실패 · 화면에 유지 중" : "이 브라우저에 임시 저장됨";
  const rememberFocus = (event: FocusEvent<HTMLElement>) => {
    const element = event.target;
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.id) paneFocus.current[record.pane] = { id: element.id, ...(element instanceof HTMLTextAreaElement ? { start: element.selectionStart, end: element.selectionEnd } : {}) };
  };
  const saveWarning = saveState === "failed" ? <div className="lw-save-warning" role="status"><span>임시 저장하지 못했습니다. 화면을 닫으면 입력을 잃을 수 있습니다.</span><button type="button" onClick={retryStorage}>저장 다시 시도</button></div> : null;

  return <main id="main-content" className="lw-app" onFocusCapture={rememberFocus} onBlurCapture={rememberFocus} onInputCapture={event => { if (event.target instanceof HTMLTextAreaElement) event.target.setCustomValidity(""); }}>
    <aside className="lw-rail" aria-label="학습 도구"><a className="lw-mark" href="/" aria-label="영어 감각 홈"><span aria-hidden="true">e.</span></a><span className="lw-rail-divider" /><button className="lw-rail-item lw-selected" type="button" aria-label="현재 장면" onClick={() => changePane("scene")}><Icon kind="scene" /><span>장면</span></button><button className="lw-rail-item" type="button" aria-label="내 수행 기록" onClick={() => setDialog("records")}><Icon kind="attempt" /><span>기록</span></button><button className="lw-rail-item" type="button" aria-label="감각 자료 찾기" onClick={() => setDialog("resources")}><Icon kind="book" /><span>자료</span></button><span className="lw-rail-bottom">영어<br />감각</span></aside>
    <div className="lw-workspace">
      <header className="lw-toolbar"><div className="lw-lesson-title"><span className="lw-workspace-label">개인 학습</span><h1><span className="lw-book-short">타이타닉</span><span aria-hidden="true"> / </span><span className="lw-word">have</span></h1><span className="lw-lesson-tag">장면 연습</span></div><div className="lw-toolbar-actions"><a href="#resources" aria-label="감각 자료 찾기" onClick={event => { event.preventDefault(); setDialog("resources"); }}><Icon kind="book" size={17} /><span>감각 자료</span></a><button type="button" onClick={startNewChat}>새 대화</button></div></header>
      <div className="lw-session-status"><span className={saveState === "failed" ? "lw-save-failed" : ""} role="status">{saveText}</span><span>계정·개인 서버 저장 없음</span></div>
      <div className="lw-panels">
        <section className="lw-panel lw-scene-panel" data-active={record.pane === "scene"} aria-labelledby="lw-scene-heading"><header className="lw-panel-heading"><h2 id="lw-scene-heading" tabIndex={-1}><span className="lw-panel-number">01</span>장면</h2><span>{question.ch}장 · {question.who}</span></header><div className="lw-panel-scroll">
          <figure className="lw-scene-image">{!imageFailed ? <img ref={sceneImage} src="/assets/learning/titanic-corridor.webp" alt="학습용 재구성: 배의 어두운 복도, 열린 객실 문 앞에 서 있는 아이" onError={() => setImageFailed(true)} /> : <div className="lw-image-fallback"><svg viewBox="0 0 420 280" role="img" aria-label="문 앞에 나타난 아이를 그린 장면 대체 그림"><path d="M0 0h420v280H0z" fill="#dcd5c5" /><path d="m0 280 140-100V35h140v145l140 100" fill="#bbb6a8" /><path d="M158 180V55h105v125" fill="#575c52" /><path d="m161 55 62 20v145l-62-40" fill="#a38c6d" /><ellipse cx="251" cy="143" rx="22" ry="25" fill="#ddba90" /><path d="M226 137q7-37 48-10" fill="#a15a37" /><path d="M222 221v-44q29-19 58 0v44" fill="#d9d6c7" /></svg><p>이미지를 불러오지 못해 대체 그림을 표시합니다.</p></div>}<figcaption>학습용 재구성 이미지 · 원작 삽화가 아닙니다</figcaption></figure>
          <div className="lw-scene-copy"><p className="lw-eyebrow">문이 열리고, 아이가 나타납니다</p><p className="lw-scene-text">{question.scene}</p><p className="lw-scene-question">{question.ask}</p><p className="lw-source"><cite>Mary Pope Osborne, Tonight on the Titanic<br />Magic Tree House #17</cite><br />기존 have 자료의 장면 연습입니다. 다음 학습 유닛이나 학습 완료를 정하지 않습니다.</p></div>
          <button className="lw-mobile-next" type="button" onClick={() => changePane("attempt")}>내 답 적기 <span aria-hidden="true">→</span></button>
        </div></section>

        <section className="lw-panel lw-attempt-panel" data-active={record.pane === "attempt"} aria-labelledby="lw-attempt-heading"><header className="lw-panel-heading"><h2 id="lw-attempt-heading" tabIndex={-1}><span className="lw-panel-number">02</span>내 수행</h2><span>{record.initialAttempt ? "처음 답 유지" : "해설 전에 먼저"}</span></header><div className="lw-panel-scroll">
          {!hydrated ? <p className="lw-muted lw-loading">이 브라우저의 수행을 확인하고 있습니다.</p> : !record.initialAttempt ? <form className="lw-attempt-form" onSubmit={submitAttempt}><fieldset><legend>어떤 문장을 고르겠습니까?</legend>{question.opts.map((option, index) => <label className="lw-option" key={index}><input id={`lw-choice-${index}`} type="radio" name="choice" value={index} checked={record.choice === String(index)} onChange={() => update(previous => ({ ...previous, choice: String(index) }))} required /><span>{option.t}</span></label>)}</fieldset><label className="lw-field-label" htmlFor="lw-reason">그 문장을 고른 까닭</label><textarea id="lw-reason" value={record.reason} onChange={event => update(previous => ({ ...previous, reason: event.target.value }))} required maxLength={learningChatLimits.reason} placeholder="어떤 장면이 떠올랐는지 적어 보십시오." rows={4} /><div className="lw-field-foot"><span>확신이 없어도 지금의 생각을 남깁니다.</span><span>{chars(record.reason)} / {learningChatLimits.reason}</span></div><button className="lw-button lw-primary lw-wide" type="submit" disabled={busy}>내 답 제출하고 대화하기 <span aria-hidden="true">→</span></button><p className="lw-form-note">제출한 답과 이유로 AI 피드백을 요청합니다. 처음 답은 이후에도 그대로 남습니다.</p>{saveWarning}</form> : <div className="lw-submitted"><div className="lw-submission-label"><span className="lw-status-dot" />처음 제출한 답</div><p className="lw-first-answer">{question.opts[record.initialAttempt.choice]?.t}</p><h3>고른 까닭</h3><p className="lw-preserve">{record.initialAttempt.reason}</p><div className="lw-revision-area"><h3>다시 쓴다면</h3><p className="lw-form-note">대화를 나누며 스스로 고친 문장이나 달라진 생각을 적습니다.</p><form onSubmit={submitRevision}><label className="lw-field-label" htmlFor="lw-revision">내가 고친 답</label><textarea id="lw-revision" value={record.revisionDraft} onChange={event => update(previous => ({ ...previous, revisionDraft: event.target.value }))} required maxLength={learningChatLimits.revision} rows={4} placeholder="처음 답을 덮어쓰지 않고 따로 남깁니다." /><div className="lw-field-foot"><span>{record.revisions.length} / {learningChatLimits.revisions}회 수정</span><span>{chars(record.revisionDraft)} / {learningChatLimits.revision}</span></div><button className="lw-button lw-outline lw-wide" type="submit" disabled={record.revisions.length >= learningChatLimits.revisions}>수정한 답 남기기</button>{saveWarning}</form>{record.revisions.length >= learningChatLimits.revisions && <p className="lw-form-note">이번 장면의 수정 기록 한도에 도달했습니다. 기존 수정은 모두 남아 있습니다.</p>}{record.revisions.length > 0 && <details className="lw-revision-history"><summary>남긴 수정 {record.revisions.length}개</summary>{record.revisions.map((revision, index) => <div key={index}><span>수정 {index + 1}</span><p>{revision.text}</p></div>)}</details>}</div><button className="lw-mobile-next" type="button" onClick={() => changePane("chat")}>이 장면으로 대화하기 <span aria-hidden="true">→</span></button></div>}
          <div className="lw-mobile-record-entry"><button className="lw-button lw-outline lw-wide" type="button" aria-label="내 수행 기록" onClick={() => setDialog("records")}><Icon kind="attempt" size={17} />내 수행 기록<span aria-hidden="true">↗</span></button></div>
        </div></section>

        <section className="lw-panel lw-chat-panel" data-active={record.pane === "chat"} aria-labelledby="lw-chat-heading"><header className="lw-panel-heading"><h2 id="lw-chat-heading" tabIndex={-1}><span className="lw-tutor-dot" /><span>함께 풀기</span></h2><span>{record.initialAttempt ? "AI 튜터" : "제출 전 · 준비 안내"}</span></header><div className="lw-chat-context"><span className="lw-context-chip">have</span><span>장면 · {record.initialAttempt ? "처음 답 · 수정 · 이전 대화" : "현재 문제"}를 함께 전달합니다</span></div>
          <div className="lw-chat-scroll" ref={chatScroll} onScroll={event => { const target = event.currentTarget; stickToEnd.current = target.scrollHeight - target.scrollTop - target.clientHeight < 100; }} role="log" aria-label="이 장면의 대화" aria-live="polite" aria-relevant="additions text">
            {record.turns.length === 0 ? <div className="lw-chat-empty"><span className="lw-chat-emblem" aria-hidden="true"><Icon kind="chat" size={27} /></span><h3>이 장면에서, 함께 생각합니다.</h3><p>{record.initialAttempt ? "처음 답과 고른 까닭을 이미 알고 있습니다. 선명하지 않은 부분을 질문하거나, 피드백을 요청해 보십시오." : "먼저 문장을 고르고 까닭을 적어 보십시오. 제출 전 질문에는 준비된 과업 안내를 보여 주며 AI를 호출하지 않습니다."}</p>{record.initialAttempt && <button className="lw-button lw-outline" type="button" onClick={() => void sendMessage("처음 제출한 답과 이유를 장면에 비추어 설명해 주세요.", "submission")}>내 답 피드백 요청</button>}</div> : record.turns.map(turn => <article className="lw-turn" key={turn.id}><div className="lw-user-message"><div className="lw-message-meta">{turn.origin === "submission" ? "피드백 요청" : "나"}{turn.origin === "submission" && <span>버튼으로 보낸 요청</span>}</div><p>{turn.user}</p></div>{turn.status === "complete" ? <div className="lw-assistant-message"><div className="lw-message-meta"><span className="lw-reply-mark" aria-hidden="true">e.</span>{turn.mode === "guidance" ? "준비 안내 · AI 호출 없음" : "AI 튜터"}</div><p>{turn.reply}</p></div> : turn.status === "pending" ? <div className="lw-waiting" role="status"><span className="lw-pulse" />{record.initialAttempt ? "장면과 내 답을 살펴보고 있습니다…" : "준비 안내를 가져오고 있습니다…"}</div> : <div className={`lw-request-error ${turn.status === "cancelled" ? "lw-cancelled" : ""}`}><p>{turn.error || "응답 기다리기를 중단했습니다."}</p>{turn.status === "failed" && <div><button type="button" onClick={() => void sendMessage(turn.user, turn.origin, undefined, turn)} disabled={busy}>같은 질문 다시 보내기</button><button type="button" onClick={() => update(previous => ({ ...previous, turns: previous.turns.map(item => item.id === turn.id ? { ...item, status: "cancelled" } : item) }))}>이 요청 접기</button></div>}</div>}</article>)}
          </div>
          <div className="lw-composer-area">{(limit || notice) && <div className="lw-chat-notice" role="status"><p>{limit || notice}</p>{limit && <button type="button" onClick={startNewChat}>수행을 유지하고 새 대화</button>}</div>}<form className="lw-composer" onSubmit={event => { event.preventDefault(); void sendMessage(record.messageDraft); }}><label className="lw-sr-only" htmlFor="lw-message">이 장면에 대해 질문하기</label><textarea id="lw-message" value={record.messageDraft} onChange={event => update(previous => ({ ...previous, messageDraft: event.target.value }))} maxLength={learningChatLimits.message} rows={2} placeholder={record.initialAttempt ? "막힌 부분이나 새로 든 생각을 물어보십시오…" : "먼저 풀어 보기 위한 질문을 적으십시오…"} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && !limit && !unresolved) void sendMessage(record.messageDraft); } }} /><div className="lw-composer-bottom"><span>{chars(record.messageDraft)} / {learningChatLimits.message}</span>{busy ? <button type="button" className="lw-send lw-stop" onClick={cancelRequest}><Icon kind="stop" size={15} /><span>중단</span></button> : <button className="lw-send" type="submit" disabled={!hydrated || !record.messageDraft.trim() || !!limit || unresolved} aria-label="질문 보내기"><Icon kind="arrow" size={20} /></button>}</div></form><p className="lw-ai-note">{record.initialAttempt ? "AI의 답은 틀릴 수 있습니다. 배움이나 완료로 자동 기록하지 않습니다." : "답을 제출하기 전에는 무료 준비 안내를 제공합니다."}</p>{saveWarning}</div>
        </section>
      </div>
      <nav className="lw-mobile-nav" aria-label="학습 패널">{([ ["scene", "장면", "scene"], ["attempt", "내 수행", "attempt"], ["chat", "함께 풀기", "chat"] ] as const).map(([pane, label, icon]) => <button key={pane} type="button" aria-pressed={record.pane === pane} onClick={() => changePane(pane)}><Icon kind={icon} size={19} />{label}{pane === "chat" && busy && <span className="lw-mobile-busy" aria-label="응답 대기 중" />}</button>)}</nav>
    </div>
    {dialog && <dialog className="lw-dialog" ref={modal} onCancel={event => { event.preventDefault(); closeDialog(); }} aria-labelledby="lw-dialog-heading"><header><h2 id="lw-dialog-heading">{dialog === "resources" ? "감각 자료 찾기" : "이 브라우저의 수행과 대화"}</h2><button type="button" onClick={closeDialog} aria-label="닫고 학습으로 돌아가기"><Icon kind="close" /></button></header><div className="lw-dialog-scroll">{dialog === "resources" ? <><p className="lw-dialog-intro">자료는 새 창에서 엽니다. 작성 중인 답과 대화는 이 작업 공간에 유지합니다.</p><figure className="lw-sense-map"><svg viewBox="0 0 320 175" role="img" aria-labelledby="lw-sense-title"><title id="lw-sense-title">have 감각 도식: 주어의 영역 안에 대상이 놓여 있습니다</title><circle cx="120" cy="87" r="72" fill="#edf1e5" stroke="#859470" strokeDasharray="5 5" /><circle cx="120" cy="103" r="21" fill="#6d8058" /><text x="120" y="109" textAnchor="middle" fill="#fff" fontSize="17" fontFamily="Georgia,serif">I</text><rect x="84" y="38" width="111" height="28" rx="3" fill="#fcfbf6" stroke="#a2ad94" /><text x="139" y="57" textAnchor="middle" fill="#526745" fontSize="14" fontFamily="Georgia,serif">something</text><text x="233" y="89" textAnchor="middle" fill="#6a7d54" fontSize="22" fontFamily="Georgia,serif">have</text><text x="239" y="112" textAnchor="middle" fill="#818a76" fontSize="11">주어의 영역</text></svg><figcaption>감각 도식 · 일반 자료<br />장면 재구성 이미지와 달리 말의 관계를 그립니다.</figcaption></figure><div className="lw-resource-list">{[["have", "영역 안에 놓여 있다"], ["get", "경계를 넘어 들어선다"], ["be", "장소·모습에 놓여 있다"], ["go", "기준점에서 멀어진다"]].map(([word, meaning]) => <a href={`/${word}/`} key={word} target="_blank" rel="noopener"><span>{word}</span><span>{meaning}</span><span aria-hidden="true">↗</span><span className="lw-sr-only">새 창</span></a>)}</div><a className="lw-book-resource" href="/practice/titanic/" target="_blank" rel="noopener"><Icon kind="book" />책의 장면과 줄거리 읽기 ↗<span className="lw-sr-only">새 창</span></a></> : <><p className="lw-dialog-intro">직접 제출한 수행과 받은 응답만 보입니다. 서버 저장·기기 간 동기화·학습 정본 반영은 제공하지 않습니다.</p>{record.initialAttempt ? <section className="lw-record-block"><h3>처음 답과 까닭</h3><p>{question.opts[record.initialAttempt.choice]?.t}</p><p>{record.initialAttempt.reason}</p>{record.revisions.map((revision, index) => <div key={index}><h3>수정 {index + 1}</h3><p>{revision.text}</p></div>)}</section> : <p className="lw-muted">아직 제출한 답이 없습니다. 작성 중인 답은 내 수행 패널에 남아 있습니다.</p>}<h3 className="lw-archive-heading">지난 대화</h3>{record.archives.length ? record.archives.map((archive, index) => <details className="lw-archive" key={archive.id}><summary>대화 {index + 1} · {archive.turns.length}개 요청</summary>{archive.turns.map(turn => <div key={turn.id}><h3>내 요청</h3><p>{turn.user}</p>{turn.reply ? <><h3>{turn.mode === "ai" ? "AI 응답" : "준비 안내"}</h3><p>{turn.reply}</p></> : <p className="lw-muted">응답 없음 · {turn.status === "cancelled" ? "중단" : "실패"}</p>}</div>)}{archive.draft && <div><h3>보내지 않은 메시지</h3><p>{archive.draft}</p></div>}</details>) : <p className="lw-muted">지난 대화가 없습니다. 현재 대화는 함께 풀기 패널에 있습니다.</p>}<div className="lw-reset-area"><p>학습을 초기화하면 이 브라우저의 처음 답·수정·대화·초안을 모두 지웁니다.</p><button type="button" onClick={() => { if (!confirm("이 브라우저에 남긴 이 장면의 답·수정·모든 대화·초안을 지우고 처음부터 시작합니까?")) return; cancelRequest(); readBlocked.current = false; update(() => fresh()); setNotice(""); closeDialog(); }}>이 장면의 학습 초기화</button></div></>}</div></dialog>}
  </main>;
}

export default LearningWorkspace;
