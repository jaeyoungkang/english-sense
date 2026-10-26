"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LEARNING_CHAT_ENDPOINT, LEARNING_LESSON_ID, isLearningChatResponse, learningChatLimits, type LearningChatMessage, type LearningChatRequest } from "@/lib/learning-chat-contract";

/** Only scene and prompt data cross the initial server/client boundary. */
export type LearningWorkspaceQuestion = { ch: number; who: string; scene: string; ask: string; opts: { t: string }[] };
type Attempt = { choice: number; reason: string };
type Turn = { id: string; requestId: string; user: string; origin: "question" | "submission"; status: "pending" | "complete" | "failed" | "cancelled"; reply?: string; mode?: "guidance" | "ai"; error?: string };
type TimelineEvent =
  | { id: string; kind: "initial" }
  | { id: string; kind: "revision"; index: number }
  | { id: string; kind: "request" | "retry" | "reply"; turnId: string; requestId: string }
  | { id: string; kind: "legacy" | "carry"; hadInitial: boolean; revisionCount: number; turnIds: string[]; repliedTurnIds: string[] };
type Archive = { id: string; turns: Turn[]; draft: string; events?: TimelineEvent[] };
type BaseRecord = { lessonId: string; choice: string; reason: string; initialAttempt: Attempt | null; revisionDraft: string; revisions: { text: string }[]; messageDraft: string; turns: Turn[]; archives: Archive[] };
type WorkspaceRecord = BaseRecord & { version: 2; events: TimelineEvent[]; revisionOpen: boolean };
const LEGACY_STORAGE_KEY = "english-sense-learning-workspace-v1";
const STORAGE_KEY = "english-sense-learning-workspace-v2";
const fresh = (): WorkspaceRecord => ({ version: 2, lessonId: LEARNING_LESSON_ID, choice: "", reason: "", initialAttempt: null, revisionDraft: "", revisions: [], messageDraft: "", turns: [], archives: [], events: [], revisionOpen: false });
const chars = (text: string) => [...text].length;
const eventId = () => crypto.randomUUID();
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validTurn(turn: unknown): turn is Turn {
  return object(turn) && typeof turn.id === "string" && typeof turn.requestId === "string" && typeof turn.user === "string" && chars(turn.user) <= learningChatLimits.message && ["question", "submission"].includes(turn.origin as string) && ["pending", "complete", "failed", "cancelled"].includes(turn.status as string) && (turn.reply === undefined || (typeof turn.reply === "string" && chars(turn.reply) <= learningChatLimits.reply)) && (turn.mode === undefined || ["guidance", "ai"].includes(turn.mode as string)) && (turn.error === undefined || typeof turn.error === "string") && (turn.status !== "complete" || (typeof turn.reply === "string" && ["guidance", "ai"].includes(turn.mode as string)));
}
function validBase(value: unknown): value is BaseRecord {
  if (!object(value) || value.lessonId !== LEARNING_LESSON_ID || !["", "0", "1", "2"].includes(value.choice as string) || typeof value.reason !== "string" || chars(value.reason) > learningChatLimits.reason || typeof value.revisionDraft !== "string" || chars(value.revisionDraft) > learningChatLimits.revision || typeof value.messageDraft !== "string" || chars(value.messageDraft) > learningChatLimits.message) return false;
  if (value.initialAttempt !== null && (!object(value.initialAttempt) || ![0, 1, 2].includes(value.initialAttempt.choice as number) || typeof value.initialAttempt.reason !== "string" || !value.initialAttempt.reason.trim() || chars(value.initialAttempt.reason) > learningChatLimits.reason)) return false;
  return Array.isArray(value.revisions) && value.revisions.length <= learningChatLimits.revisions && value.revisions.every(r => object(r) && typeof r.text === "string" && !!r.text.trim() && chars(r.text) <= learningChatLimits.revision) && Array.isArray(value.turns) && value.turns.every(validTurn) && Array.isArray(value.archives) && value.archives.every(a => object(a) && typeof a.id === "string" && typeof a.draft === "string" && Array.isArray(a.turns) && a.turns.every(validTurn));
}
function validEvents(value: unknown, record: Pick<BaseRecord, "initialAttempt" | "revisions" | "turns">): value is TimelineEvent[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every(event => {
    if (!object(event) || typeof event.id !== "string" || ids.has(event.id)) return false;
    ids.add(event.id);
    if (event.kind === "initial") return record.initialAttempt !== null;
    if (event.kind === "revision") return Number.isInteger(event.index) && Number(event.index) >= 0 && Number(event.index) < record.revisions.length;
    if (["request", "retry", "reply"].includes(event.kind as string)) return typeof event.requestId === "string" && record.turns.some(turn => turn.id === event.turnId && (event.kind !== "reply" || (turn.status === "complete" && turn.requestId === event.requestId)));
    if (event.kind === "legacy" || event.kind === "carry") return typeof event.hadInitial === "boolean" && (!event.hadInitial || record.initialAttempt !== null) && Number.isInteger(event.revisionCount) && Number(event.revisionCount) >= 0 && Number(event.revisionCount) <= record.revisions.length && Array.isArray(event.turnIds) && event.turnIds.every(id => typeof id === "string" && record.turns.some(turn => turn.id === id)) && Array.isArray(event.repliedTurnIds) && event.repliedTurnIds.every(id => event.turnIds instanceof Array && event.turnIds.includes(id) && record.turns.some(turn => turn.id === id && turn.status === "complete"));
    return false;
  });
}
function coversTurns(events: TimelineEvent[], turns: Turn[]): boolean {
  const representedTurn = (id: string) => events.some(event => ("turnId" in event && event.turnId === id && event.kind === "request") || (event.kind === "legacy" && event.turnIds.includes(id)));
  const representedReply = (id: string) => events.some(event => ("turnId" in event && event.turnId === id && event.kind === "reply") || (event.kind === "legacy" && event.repliedTurnIds.includes(id)));
  return turns.every(turn => representedTurn(turn.id) && (turn.status !== "complete" || representedReply(turn.id)));
}
function validRecord(value: unknown): value is WorkspaceRecord {
  if (!validBase(value)) return false;
  const metadata = value as BaseRecord & Record<string, unknown>;
  // Archives cover their own turns, not revisions added after that conversation ended.
  if (metadata.version !== 2 || typeof metadata.revisionOpen !== "boolean" || !validEvents(metadata.events, value) || !value.archives.every(archive => archive.events === undefined || (validEvents(archive.events, { ...value, turns: archive.turns }) && coversTurns(archive.events, archive.turns)))) return false;
  const events = metadata.events;
  return coversTurns(events, value.turns) && (!value.initialAttempt || events.some(event => event.kind === "initial" || ((event.kind === "legacy" || event.kind === "carry") && event.hadInitial))) && value.revisions.every((_, index) => events.some(event => (event.kind === "revision" && event.index === index) || ((event.kind === "legacy" || event.kind === "carry") && event.revisionCount > index)));
}
/** v1 had no cross-type ordering. Retain its content as a labelled group, never fabricate dates. */
function migrateLegacy(value: unknown): WorkspaceRecord | null {
  if (!validBase(value)) return null;
  const metadata = value as BaseRecord & Record<string, unknown>;
  if (metadata.version !== 1 || !["scene", "attempt", "chat"].includes(metadata.pane as string)) return null;
  const { lessonId, choice, reason, initialAttempt, revisionDraft, revisions, messageDraft, turns, archives } = value;
  const hasRecord = !!initialAttempt || revisions.length > 0 || turns.length > 0;
  return { version: 2, lessonId, choice, reason, initialAttempt, revisionDraft, revisions, messageDraft, turns, archives, revisionOpen: !!revisionDraft && !!initialAttempt, events: hasRecord ? [{ id: eventId(), kind: "legacy", hadInitial: !!initialAttempt, revisionCount: revisions.length, turnIds: turns.map(turn => turn.id), repliedTurnIds: turns.filter(turn => turn.status === "complete").map(turn => turn.id) }] : [] };
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
  const [referenceExpanded, setReferenceExpanded] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const recordRef = useRef(record);
  const readBlocked = useRef(false);
  const alive = useRef(true);
  const active = useRef<{ controller: AbortController; requestId: string; turnId: string } | null>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const sceneImage = useRef<HTMLImageElement>(null);
  const stickToEnd = useRef(false);
  const lastEvent = useRef<string | null>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  recordRef.current = record;
  const update = useCallback((change: (previous: WorkspaceRecord) => WorkspaceRecord) => {
    setRecord(previous => { const next = change(previous); recordRef.current = next; return next; });
  }, []);

  useEffect(() => {
    alive.current = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      let restored: WorkspaceRecord | null = null;
      if (raw !== null) {
        const value: unknown = JSON.parse(raw);
        if (!validRecord(value)) throw new Error("invalid v2 record");
        restored = value;
      } else {
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy !== null) { restored = migrateLegacy(JSON.parse(legacy)); if (!restored) throw new Error("invalid v1 record"); }
      }
      if (restored) {
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
    if (!hydrated) return;
    const id = record.events.at(-1)?.id || null;
    if (lastEvent.current !== null && id !== lastEvent.current) {
      if (stickToEnd.current && chatScroll.current) chatScroll.current.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "instant" });
      else setUnseen(true);
    }
    lastEvent.current = id;
  }, [record.events, hydrated]);
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
  function goToEnd() {
    stickToEnd.current = true; setUnseen(false);
    requestAnimationFrame(() => chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "instant" }));
  }
  function openRevision() {
    update(previous => ({ ...previous, revisionOpen: true }));
    goToEnd();
    requestAnimationFrame(() => { const field = document.getElementById("lw-revision"); field?.focus({ preventScroll: true }); field?.scrollIntoView({ block: "nearest", behavior: "instant" }); });
  }
  function startNewChat() {
    const current = recordRef.current;
    if ((current.turns.length || current.messageDraft || current.events.length) && !confirm("현재 대화와 작성 중 메시지를 지난 대화에 남기고 새 대화를 엽니다. 처음 답과 수정은 유지합니다. 계속합니까?")) return;
    cancelRequest();
    update(previous => ({ ...previous, archives: previous.turns.length || previous.messageDraft || previous.events.length ? [...previous.archives, { id: crypto.randomUUID(), turns: previous.turns, draft: previous.messageDraft, events: previous.events }] : previous.archives, turns: [], messageDraft: "", events: previous.initialAttempt || previous.revisions.length ? [{ id: eventId(), kind: "carry", hadInitial: !!previous.initialAttempt, revisionCount: previous.revisions.length, turnIds: [], repliedTurnIds: [] }] : [] }));
    setNotice("새 대화를 열었습니다. 처음 답과 수정한 답은 계속 전달합니다.");
    goToEnd();
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
    active.current = request; setBusy(true); setNotice(""); goToEnd();
    const body: LearningChatRequest = { lessonId: LEARNING_LESSON_ID, requestId, initialAttempt: initialOverride || current.initialAttempt, revisions: current.revisions, messages: historyFor(current.turns), message: content };
    update(previous => ({ ...previous, messageDraft: origin === "question" && !retryTurn ? "" : previous.messageDraft, turns: retryTurn ? previous.turns.map(turn => turn.id === turnId ? { ...turn, requestId, status: "pending", error: undefined } : turn) : [...previous.turns, { id: turnId, requestId, user: content, origin, status: "pending" }], events: [...previous.events, { id: eventId(), kind: retryTurn ? "retry" : "request", turnId, requestId }] }));
    const timeout = window.setTimeout(() => controller.abort(), 70000);
    try {
      const response = await fetch(LEARNING_CHAT_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(object(result) && typeof result.detail === "string" ? result.detail : "응답을 받지 못했습니다. 같은 질문을 다시 보낼 수 있습니다.");
      if (!isLearningChatResponse(result) || result.requestId !== requestId) throw new Error("요청과 맞는 응답을 읽지 못했습니다. 같은 질문을 다시 보낼 수 있습니다.");
      if (!alive.current || active.current?.requestId !== requestId) return;
      update(previous => ({ ...previous, turns: previous.turns.map(turn => turn.id === turnId && turn.requestId === requestId ? { ...turn, reply: result.reply, mode: result.mode, status: "complete" } : turn), events: [...previous.events, { id: eventId(), kind: "reply", turnId, requestId }] }));
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
    update(previous => ({ ...previous, initialAttempt, events: [...previous.events, { id: eventId(), kind: "initial" }] }));
    goToEnd();
    requestAnimationFrame(() => document.getElementById("lw-message")?.focus({ preventScroll: true }));
    void sendMessage("처음 제출한 답과 이유를 장면에 비추어 설명해 주세요. 제가 떠올린 장면을 함께 살펴보고, 스스로 고쳐 볼 지점을 알려 주세요.", "submission", initialAttempt);
  }
  function submitRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const text = record.revisionDraft.trim();
    if (!text) { const input = event.currentTarget.querySelector<HTMLTextAreaElement>("#lw-revision"); input?.setCustomValidity("수정한 답을 한 글자 이상 적어 주십시오."); input?.reportValidity(); return; }
    if (record.revisions.length >= learningChatLimits.revisions) return;
    update(previous => ({ ...previous, revisions: [...previous.revisions, { text }], revisionDraft: "", revisionOpen: false, events: [...previous.events, { id: eventId(), kind: "revision", index: previous.revisions.length }] }));
    goToEnd();
    requestAnimationFrame(() => document.getElementById("lw-message")?.focus({ preventScroll: true }));
    setNotice("수정한 답을 남겼습니다. 다음 대화 요청에 함께 전달합니다.");
  }
  const limit = historyLimit(record.turns);
  const unresolved = record.turns.some(turn => turn.status === "failed");
  const saveText = !hydrated ? "임시 기록 확인 중" : saveState === "failed" ? "임시 저장 실패 · 화면에 유지 중" : "이 브라우저에 임시 저장됨";
  const saveWarning = saveState === "failed" ? <div className="lw-save-warning" role="status"><span>임시 저장하지 못했습니다. 화면을 닫으면 입력을 잃을 수 있습니다.</span><button type="button" onClick={retryStorage}>저장 다시 시도</button></div> : null;

  function firstAnswer() {
    return record.initialAttempt && <div className="lw-user-performance"><div className="lw-message-meta">나 · 처음 제출한 답</div><p className="lw-first-answer">{question.opts[record.initialAttempt.choice]?.t}</p><h3>고른 까닭</h3><p className="lw-preserve">{record.initialAttempt.reason}</p></div>;
  }
  function revisionAnswer(index: number) {
    return <div className="lw-user-performance lw-revision-turn"><div className="lw-message-meta">나 · 수정 {index + 1}</div><p className="lw-preserve">{record.revisions[index]?.text}</p><p className="lw-performance-note">처음 답을 유지하고 따로 남긴 수행입니다.</p></div>;
  }
  function requestStatus(turn: Turn, requestId: string, archived = false) {
    if (turn.requestId !== requestId) return <p className="lw-old-status">이 요청은 아래에서 다시 시도했습니다.</p>;
    if (turn.status === "complete") return null;
    if (archived) return <p className="lw-old-status">{turn.error || "이전 대화에서 중단한 요청입니다."}</p>;
    if (turn.status === "pending") return <div className="lw-waiting" role="status"><span className="lw-pulse" />{record.initialAttempt ? "장면과 내 답을 살펴보고 있습니다…" : "준비 안내를 가져오고 있습니다…"}</div>;
    return <div className={`lw-request-error ${turn.status === "cancelled" ? "lw-cancelled" : ""}`}><p>{turn.error || "응답 기다리기를 중단했습니다."}</p>{turn.status === "failed" && <div><button type="button" onClick={() => void sendMessage(turn.user, turn.origin, undefined, turn)} disabled={busy}>같은 질문 다시 보내기</button><button type="button" onClick={() => update(previous => ({ ...previous, turns: previous.turns.map(item => item.id === turn.id ? { ...item, status: "cancelled" } : item) }))}>이 요청 접기</button></div>}</div>;
  }
  function userRequest(turn: Turn) {
    return <div className="lw-user-message"><div className="lw-message-meta">{turn.origin === "submission" ? "피드백 요청" : "나"}{turn.origin === "submission" && <span>제출 버튼으로 보낸 요청</span>}</div><p>{turn.user}</p></div>;
  }
  function assistantReply(turn: Turn) {
    return <div className="lw-assistant-message"><div className="lw-message-meta"><span className="lw-reply-mark" aria-hidden="true">e.</span>{turn.mode === "guidance" ? "준비 안내 · AI 호출 없음" : "AI 튜터"}</div><p>{turn.reply}</p></div>;
  }
  function timelineEvent(event: TimelineEvent, turns = record.turns, archived = false): ReactNode {
    if (event.kind === "initial") return firstAnswer();
    if (event.kind === "revision") return revisionAnswer(event.index);
    if (event.kind === "legacy" || event.kind === "carry") return <section className="lw-legacy-group" aria-label={event.kind === "legacy" ? "이전 기록" : "새 대화에 이어 온 수행"}><h2>{event.kind === "legacy" ? "이전 기록을 가져왔습니다" : "새 대화 · 이전 수행을 이어 갑니다"}</h2><p>{event.kind === "legacy" ? "이전 버전에는 수정과 대화 사이의 작성 순서가 없습니다. 시각이나 순서를 추정하지 않고 한데 모아 보여 줍니다. 새로 남기는 내용부터 아래에 실제 순서로 쌓입니다." : "처음 제출한 답과 수정은 유지합니다. 이전 대화는 기록에서 다시 읽을 수 있습니다."}</p><details><summary>{event.kind === "legacy" ? "이전 수행과 대화 읽기" : "이어 온 수행 읽기"}</summary>{event.hadInitial && firstAnswer()}{record.revisions.slice(0, event.revisionCount).map((_, index) => <div key={index}>{revisionAnswer(index)}</div>)}{event.turnIds.map(id => { const turn = turns.find(item => item.id === id); return turn && <div className="lw-legacy-turn" key={id}>{userRequest(turn)}{event.repliedTurnIds.includes(id) ? assistantReply(turn) : <><p className="lw-old-status">이전 기록에는 이 요청의 응답이 없습니다.</p>{!archived && turn.status === "failed" && <button className="lw-text-button" type="button" disabled={busy} onClick={() => void sendMessage(turn.user, turn.origin, undefined, turn)}>이 요청 다시 보내기</button>}</>}</div>; })}</details></section>;
    if (!("turnId" in event)) return null;
    const turn = turns.find(item => item.id === event.turnId);
    if (!turn) return null;
    if (event.kind === "reply") return assistantReply(turn);
    if (event.kind === "retry") return <div className="lw-retry-event"><p>같은 질문을 다시 보냈습니다.</p>{requestStatus(turn, event.requestId, archived)}</div>;
    return <div className="lw-turn">{userRequest(turn)}{requestStatus(turn, event.requestId, archived)}</div>;
  }

  return <main id="main-content" className="lw-app" onInputCapture={event => { if (event.target instanceof HTMLTextAreaElement) event.target.setCustomValidity(""); }}>
    <header className="lw-toolbar"><div className="lw-lesson-title"><a className="lw-mark" href="/" aria-label="영어 감각 홈">e.</a><h1>영어 감각 <span aria-hidden="true">/</span> <span className="lw-word">have</span></h1></div><div className="lw-toolbar-actions"><button type="button" aria-label="내 수행 기록" title="내 수행 기록" onClick={() => setDialog("records")}><Icon kind="attempt" size={18} /><span>기록</span></button><a href="#resources" aria-label="감각 자료 찾기" title="감각 자료 찾기" onClick={event => { event.preventDefault(); setDialog("resources"); }}><Icon kind="book" size={18} /><span>자료</span></a><button type="button" onClick={startNewChat}>새 대화</button></div></header>
    <div className="lw-session-status"><span className={saveState === "failed" ? "lw-save-failed" : ""} role="status">{saveText}</span><span>계정·개인 서버 저장 없음</span></div>
    <section className={`lw-reference ${referenceExpanded ? "lw-reference-expanded" : ""}`} aria-labelledby="lw-reference-heading"><div className="lw-reference-inner"><figure className="lw-sense-image">{!imageFailed ? <img ref={sceneImage} src="/assets/learning/have-sense.webp" alt="사람을 둘러싼 연두색 타원 안에 손전등, 하트, 시계, 가슴에 구름이 있는 몸 모양, 체크리스트와 발자국이 놓여 있다." onError={() => setImageFailed(true)} /> : <div className="lw-image-fallback"><svg viewBox="0 0 280 170" role="img" aria-label="주어의 영역 안에 대상이 놓인 have 감각 대체 도식"><ellipse cx="140" cy="85" rx="123" ry="70" fill="#e6ead9" stroke="#7d8d65" strokeDasharray="5 5" /><circle cx="110" cy="92" r="23" fill="#687b50" /><text x="110" y="98" fill="#fff" textAnchor="middle" fontSize="15">주어</text><rect x="150" y="51" width="58" height="34" rx="4" fill="#fcfaf4" stroke="#7d8d65" /><text x="179" y="73" fill="#465c35" textAnchor="middle" fontSize="13">무언가</text></svg></div>}<figcaption>{imageFailed ? "이미지 대신 감각 도식을 표시합니다" : "have의 감각 · 학습용 도해"}</figcaption></figure><div className="lw-reference-copy"><div className="lw-reference-label"><span>항상 곁에 두는 감각 자료</span><button type="button" aria-expanded={referenceExpanded} aria-controls="lw-reference-detail" onClick={() => setReferenceExpanded(previous => !previous)}>{referenceExpanded ? "접기" : "펼치기"}<span aria-hidden="true">{referenceExpanded ? "−" : "+"}</span></button></div><h2 id="lw-reference-heading"><span>have</span> — 내 영역 안에 놓여 있다.</h2><p>물건뿐 아니라 몸, 마음, 시간, 할 일, 지난 일도 내 영역이 됩니다.</p><div id="lw-reference-detail" hidden={!referenceExpanded}><p>주어가 자기 영역을 두고, 그 안에 무언가가 놓여 있습니다. 그림은 움직임이 아니라 영역 안에 놓인 관계를 보여 줍니다.</p><a href="/have/" target="_blank" rel="noopener">감각 설명 전체 읽기 ↗<span className="lw-sr-only">새 창</span></a></div></div></div></section>
    <div className="lw-conversation-area"><div className="lw-transcript" ref={chatScroll} onScroll={event => { const target = event.currentTarget; stickToEnd.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80; if (stickToEnd.current) setUnseen(false); }}><div className="lw-transcript-inner">
      <article className="lw-material-message"><div className="lw-message-meta"><span className="lw-reply-mark" aria-hidden="true">e.</span>학습 자료 · 감각 사전</div><p>위의 그림을 참고해 한 장면을 풀어 봅니다. 먼저 내 답과 까닭을 남기면, 그 답에서 AI와 대화를 이어 갑니다.</p></article>
      <article className="lw-question-message" aria-labelledby="lw-question-heading"><div className="lw-message-meta">장면 문제 · <span className="lw-book-name">Tonight on the Titanic</span></div><h2 id="lw-question-heading">문이 열리고, 아이가 나타납니다.</h2><p className="lw-scene-text">{question.scene}</p><p className="lw-scene-question">{question.ask}</p><p className="lw-source">{question.ch}장 · 말하는 사람: {question.who}<br /><cite>Mary Pope Osborne, Magic Tree House #17</cite> · 기존 have 자료의 연습 문제입니다.</p></article>
      <div className="lw-timeline" role="log" aria-label="학습 수행과 대화" aria-live="polite" aria-relevant="additions text">{record.events.map(event => <div className="lw-timeline-event" data-event-kind={event.kind} key={event.id}>{timelineEvent(event)}</div>)}</div>
      {!hydrated ? <p className="lw-muted lw-loading">이 브라우저의 수행과 대화를 확인하고 있습니다.</p> : !record.initialAttempt ? <form className="lw-attempt-form" id="lw-first-answer-form" onSubmit={submitAttempt}><div className="lw-message-meta">내 답 제출 · 아직 제출 전</div><fieldset><legend>어떤 문장을 고르겠습니까?</legend>{question.opts.map((option, index) => <label className="lw-option" key={index}><input id={`lw-choice-${index}`} type="radio" name="choice" value={index} checked={record.choice === String(index)} onChange={() => update(previous => ({ ...previous, choice: String(index) }))} required /><span>{option.t}</span></label>)}</fieldset><label className="lw-field-label" htmlFor="lw-reason">그 문장을 고른 까닭</label><textarea id="lw-reason" value={record.reason} onChange={event => update(previous => ({ ...previous, reason: event.target.value }))} required maxLength={learningChatLimits.reason} placeholder="어떤 장면이 떠올랐는지 적어 보십시오." rows={3} /><div className="lw-field-foot"><span>확신이 없어도 지금의 생각을 남깁니다.</span><span>{chars(record.reason)} / {learningChatLimits.reason}</span></div><button className="lw-button lw-primary" type="submit" disabled={busy}>내 답 제출하고 대화하기 <span aria-hidden="true">→</span></button><p className="lw-form-note">처음 답과 이유를 남기고, 그 내용을 바탕으로 AI 피드백을 요청합니다.</p>{saveWarning}</form> : record.revisionOpen ? <form className="lw-attempt-form lw-inline-revision" onSubmit={submitRevision}><div className="lw-message-meta">답을 고쳐 쓰기 · 아직 제출 전</div><label className="lw-field-label" htmlFor="lw-revision">내가 고친 답</label><textarea id="lw-revision" value={record.revisionDraft} onChange={event => update(previous => ({ ...previous, revisionDraft: event.target.value }))} required maxLength={learningChatLimits.revision} rows={3} placeholder="처음 답을 덮어쓰지 않고 따로 남깁니다." /><div className="lw-field-foot"><span>{record.revisions.length} / {learningChatLimits.revisions}회 수정</span><span>{chars(record.revisionDraft)} / {learningChatLimits.revision}</span></div><div className="lw-form-actions"><button className="lw-button lw-primary" type="submit" disabled={record.revisions.length >= learningChatLimits.revisions}>수정한 답 남기기</button><button className="lw-text-button" type="button" onClick={() => update(previous => ({ ...previous, revisionOpen: false }))}>초안을 두고 나중에 쓰기</button></div>{saveWarning}</form> : null}
      {record.initialAttempt && record.turns.length === 0 && <button className="lw-text-button lw-feedback-request" type="button" onClick={() => void sendMessage("처음 제출한 답과 이유를 장면에 비추어 설명해 주세요.", "submission")}>내 답 피드백 요청</button>}
    </div></div>
    <div className="lw-composer-area">{unseen && <button className="lw-new-response" type="button" onClick={goToEnd}>새 응답 보기 <span aria-hidden="true">↓</span></button>}<div className="lw-composer-inner">{(limit || notice) && <div className="lw-chat-notice" role="status"><p>{limit || notice}</p>{limit && <button type="button" onClick={startNewChat}>수행을 유지하고 새 대화</button>}</div>}<div className="lw-composer-tools"><span>{record.initialAttempt ? "답에서 이어 가는 대화" : "선택과 이유는 위의 ‘내 답 제출’ 칸에 적습니다"}</span>{record.initialAttempt ? <button type="button" disabled={record.revisions.length >= learningChatLimits.revisions} onClick={openRevision}><Icon kind="attempt" size={14} />{record.revisionDraft ? "작성하던 수정 이어 쓰기" : "답을 고쳐 쓰기"}</button> : <button type="button" onClick={() => { goToEnd(); requestAnimationFrame(() => { const field = document.getElementById("lw-reason"); field?.focus({ preventScroll: true }); field?.scrollIntoView({ block: "nearest", behavior: "instant" }); }); }}>첫 답 적기 ↑</button>}</div><form className="lw-composer" onSubmit={event => { event.preventDefault(); void sendMessage(record.messageDraft); }}><label className="lw-sr-only" htmlFor="lw-message">이 장면에 대해 질문하기</label><textarea id="lw-message" value={record.messageDraft} onChange={event => update(previous => ({ ...previous, messageDraft: event.target.value }))} maxLength={learningChatLimits.message} rows={2} placeholder={record.initialAttempt ? "막힌 부분이나 새로 든 생각을 물어보십시오…" : "풀기 전에 궁금한 점을 물어보십시오…"} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && !limit && !unresolved) void sendMessage(record.messageDraft); } }} /><div className="lw-composer-bottom"><span>{chars(record.messageDraft)} / {learningChatLimits.message}</span>{busy ? <button type="button" className="lw-send lw-stop" onClick={cancelRequest}><Icon kind="stop" size={15} /><span>중단</span></button> : <button className="lw-send" type="submit" disabled={!hydrated || !record.messageDraft.trim() || !!limit || unresolved} aria-label="질문 보내기"><Icon kind="arrow" size={20} /></button>}</div></form><p className="lw-ai-note">{record.initialAttempt ? "AI의 답은 틀릴 수 있습니다. 배움이나 완료로 자동 기록하지 않습니다." : "답 제출 전에는 AI 대신 무료 준비 안내를 제공합니다."}</p>{saveWarning}</div></div></div>
    {dialog && <dialog className="lw-dialog" ref={modal} onCancel={event => { event.preventDefault(); closeDialog(); }} aria-labelledby="lw-dialog-heading"><header><h2 id="lw-dialog-heading">{dialog === "resources" ? "감각 자료 찾기" : "이 브라우저의 수행과 대화"}</h2><button type="button" onClick={closeDialog} aria-label="닫고 학습으로 돌아가기"><Icon kind="close" /></button></header><div className="lw-dialog-scroll">{dialog === "resources" ? <><p className="lw-dialog-intro">자료는 새 창에서 엽니다. 작성 중인 답과 대화는 이 작업 공간에 유지합니다.</p><figure className="lw-sense-map"><svg viewBox="0 0 320 175" role="img" aria-labelledby="lw-sense-title"><title id="lw-sense-title">have 감각 도식: 주어의 영역 안에 대상이 놓여 있습니다</title><circle cx="120" cy="87" r="72" fill="#edf1e5" stroke="#859470" strokeDasharray="5 5" /><circle cx="120" cy="103" r="21" fill="#6d8058" /><text x="120" y="109" textAnchor="middle" fill="#fff" fontSize="17" fontFamily="Georgia,serif">I</text><rect x="84" y="38" width="111" height="28" rx="3" fill="#fcfbf6" stroke="#a2ad94" /><text x="139" y="57" textAnchor="middle" fill="#526745" fontSize="14" fontFamily="Georgia,serif">something</text><text x="233" y="89" textAnchor="middle" fill="#6a7d54" fontSize="22" fontFamily="Georgia,serif">have</text><text x="239" y="112" textAnchor="middle" fill="#818a76" fontSize="11">주어의 영역</text></svg><figcaption>감각 도식 · 일반 자료<br />주어의 영역과 그 안에 놓인 대상의 관계를 그립니다.</figcaption></figure><div className="lw-resource-list">{[["have", "영역 안에 놓여 있다"], ["get", "경계를 넘어 들어선다"], ["be", "장소·모습에 놓여 있다"], ["go", "기준점에서 멀어진다"]].map(([word, meaning]) => <a href={`/${word}/`} key={word} target="_blank" rel="noopener"><span>{word}</span><span>{meaning}</span><span aria-hidden="true">↗</span><span className="lw-sr-only">새 창</span></a>)}</div><a className="lw-book-resource" href="/practice/titanic/" target="_blank" rel="noopener"><Icon kind="book" />책의 장면과 줄거리 읽기 ↗<span className="lw-sr-only">새 창</span></a></> : <><p className="lw-dialog-intro">직접 제출한 수행과 받은 응답만 보입니다. 서버 저장·기기 간 동기화·학습 정본 반영은 제공하지 않습니다.</p>{record.initialAttempt ? <section className="lw-record-block"><h3>처음 답과 까닭</h3><p>{question.opts[record.initialAttempt.choice]?.t}</p><p>{record.initialAttempt.reason}</p>{record.revisions.map((revision, index) => <div key={index}><h3>수정 {index + 1}</h3><p>{revision.text}</p></div>)}</section> : <p className="lw-muted">아직 제출한 답이 없습니다. 작성 중인 답은 대화 속 제출 칸에 남아 있습니다.</p>}<h3 className="lw-archive-heading">지난 대화</h3>{record.archives.length ? record.archives.map((archive, index) => <details className="lw-archive" key={archive.id}><summary>대화 {index + 1} · {archive.turns.length}개 요청</summary>{archive.events ? <div className="lw-archive-timeline">{archive.events.map(event => <div className="lw-timeline-event" key={event.id}>{timelineEvent(event, archive.turns, true)}</div>)}</div> : archive.turns.map(turn => <div key={turn.id}><h3>내 요청</h3><p>{turn.user}</p>{turn.reply ? <><h3>{turn.mode === "ai" ? "AI 응답" : "준비 안내"}</h3><p>{turn.reply}</p></> : <p className="lw-muted">응답 없음 · {turn.status === "cancelled" ? "중단" : "실패"}</p>}</div>)}{archive.draft && <div><h3>보내지 않은 메시지</h3><p>{archive.draft}</p></div>}</details>) : <p className="lw-muted">지난 대화가 없습니다. 현재 대화는 학습 흐름에 이어져 있습니다.</p>}<div className="lw-reset-area"><p>초기화하면 현재 작업 공간의 처음 답·수정·대화·초안을 지웁니다. 가져온 이전 버전의 원본은 보존합니다.</p><button type="button" onClick={() => { if (!confirm("현재 작업 공간의 답·수정·대화·초안을 초기화합니까? 이전 버전에서 가져온 원본은 보존합니다.")) return; cancelRequest(); readBlocked.current = false; update(() => fresh()); setNotice(""); closeDialog(); }}>이 장면의 학습 초기화</button></div></>}</div></dialog>}
  </main>;
}

export default LearningWorkspace;
