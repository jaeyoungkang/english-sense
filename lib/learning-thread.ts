import { learningChatLimits, type LearningChatMessage } from "./learning-chat-contract";

/**
 * Conversation lifecycle shared by learning v3 (one lesson, seven cards) and lesson v4 (any registry lesson).
 * It knows nothing about a lesson's id, its question count or its answer shapes; each record owns those.
 * The reducers only need an artifact with threads, a content version and a question id.
 */
export type FailedTurnAttempt = { requestId: string; status: "failed" | "cancelled"; error?: string };
export type WorkspaceTurn = { id: string; requestId: string; user: string; origin: "question" | "submission"; status: "pending" | "complete" | "failed" | "cancelled"; reply?: string; mode?: "guidance" | "ai"; error?: string; failedAttempts?: FailedTurnAttempt[] };
export type WorkspaceThread = { id: string; turns: WorkspaceTurn[]; draft?: string };
export type ThreadedArtifact = { artifactId: string; contentVersion: string; question: { questionId: string }; messageDraft: string; threads: WorkspaceThread[]; activeThreadId: string };
export type ThreadEvent = { id: string; artifactId: string } & (
  | { kind: "thread"; threadId: string }
  | { kind: "request" | "retry" | "reply"; threadId: string; turnId: string; requestId: string }
);
export type ThreadedState = { artifacts: ThreadedArtifact[]; events: { id: string }[] };
/** What a reply must repeat from the request it answers; the lesson-specific id is checked by the record that owns it. */
export type ThreadReply = { requestId: string; artifactId: string; questionId: string; contentVersion: string; reply: string; mode: "guidance" | "ai" };
type ArtifactOf<S extends ThreadedState> = S["artifacts"][number];

export const characterCount = (text: string) => [...text].length;
const chars = characterCount;
export const newId = () => crypto.randomUUID();
export const identity = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export const text = (value: unknown, max: number, required = false): value is string => typeof value === "string" && chars(value) <= max && (!required || !!value.trim());
export const publicKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

function validFailedAttempt(value: unknown): value is FailedTurnAttempt {
  return object(value) && publicKeys(value, ["requestId", "status", "error"]) && identity(value.requestId) && ["failed", "cancelled"].includes(value.status as string) && (value.error === undefined || typeof value.error === "string");
}

export function validTurn(turn: unknown): turn is WorkspaceTurn {
  return object(turn) && publicKeys(turn, ["id", "requestId", "user", "origin", "status", "reply", "mode", "error", "failedAttempts"]) && typeof turn.id === "string" && typeof turn.requestId === "string" && typeof turn.user === "string" && chars(turn.user) <= learningChatLimits.message && ["question", "submission"].includes(turn.origin as string) && ["pending", "complete", "failed", "cancelled"].includes(turn.status as string) && (turn.reply === undefined || (typeof turn.reply === "string" && chars(turn.reply) <= learningChatLimits.reply)) && (turn.mode === undefined || ["guidance", "ai"].includes(turn.mode as string)) && (turn.error === undefined || typeof turn.error === "string") && (turn.failedAttempts === undefined || (Array.isArray(turn.failedAttempts) && turn.failedAttempts.length >= 1 && turn.failedAttempts.length <= 20 && turn.failedAttempts.every(validFailedAttempt))) && (turn.status !== "complete" || (typeof turn.reply === "string" && ["guidance", "ai"].includes(turn.mode as string)));
}
export function findArtifact<S extends ThreadedState>(state: S, artifactId: string): ArtifactOf<S> {
  const artifact = state.artifacts.find(item => item.artifactId === artifactId);
  if (!artifact) throw new Error("질문할 퀴즈를 찾지 못했습니다.");
  return artifact as ArtifactOf<S>;
}
export function activeThread(artifact: ThreadedArtifact): WorkspaceThread { const thread = artifact.threads.find(item => item.id === artifact.activeThreadId); if (!thread) throw new Error("대화를 찾지 못했습니다."); return thread; }
export function updateArtifact<S extends ThreadedState>(state: S, artifactId: string, update: (artifact: ArtifactOf<S>) => ArtifactOf<S>): S { return { ...state, artifacts: state.artifacts.map(item => item.artifactId === artifactId ? update(item as ArtifactOf<S>) : item) }; }
function withEvent<S extends ThreadedState>(state: S, event: ThreadEvent): S { return { ...state, events: [...state.events, event] }; }
export function historyFor(thread: WorkspaceThread): LearningChatMessage[] { return thread.turns.filter(turn => turn.status === "complete").flatMap(turn => [{ role: "user" as const, content: turn.user }, { role: "assistant" as const, content: turn.reply! }]); }
export function threadLimit(thread: WorkspaceThread): string | null {
  const messages = historyFor(thread);
  return messages.length > learningChatLimits.historyMessages || messages.some(item => chars(item.content) > learningChatLimits.historyMessage) || messages.reduce((sum, item) => sum + chars(item.content), 0) > learningChatLimits.historyCharacters ? "이 퀴즈의 대화 길이 한도에 도달했습니다. 내용을 자르지 않고 보존합니다. 이 퀴즈의 새 대화를 열 수 있습니다." : null;
}
function updateThread<S extends ThreadedState>(state: S, artifactId: string, threadId: string, update: (thread: WorkspaceThread) => WorkspaceThread): S { return updateArtifact(state, artifactId, item => ({ ...item, threads: item.threads.map(thread => thread.id === threadId ? update(thread) : thread) })); }
export function beginTurn<S extends ThreadedState>(state: S, artifactId: string, turn: WorkspaceTurn): S {
  const artifact = findArtifact(state, artifactId), thread = activeThread(artifact);
  if (threadLimit(thread) || thread.turns.some(item => item.status === "pending" || item.status === "failed") || !validTurn(turn) || turn.status !== "pending" || !identity(turn.id) || !identity(turn.requestId) || !turn.user.trim() || thread.turns.some(item => item.id === turn.id)) throw new Error("이 대화의 처리 중이거나 실패한 요청을 먼저 확인합니다.");
  const next = updateThread(state, artifactId, thread.id, item => ({ ...item, turns: [...item.turns, turn] }));
  return withEvent(next, { id: newId(), kind: "request", artifactId, threadId: thread.id, turnId: turn.id, requestId: turn.requestId });
}
export function retryTurn<S extends ThreadedState>(state: S, artifactId: string, threadId: string, turnId: string, requestId: string): S {
  const artifact = findArtifact(state, artifactId), thread = artifact.threads.find(item => item.id === threadId), turn = thread?.turns.find(item => item.id === turnId);
  if (!thread || !turn || turn.status !== "failed" || threadId !== artifact.activeThreadId || threadLimit(thread)) throw new Error("현재 대화에서 실패한 요청만 다시 보낼 수 있습니다.");
  const priorAttempt: FailedTurnAttempt = { requestId: turn.requestId, status: turn.status, ...(turn.error !== undefined ? { error: turn.error } : {}) };
  const next = updateThread(state, artifactId, threadId, item => ({
    ...item,
    turns: item.turns.map(item => {
      if (item.id !== turnId) return item;
      const { error: _removedError, ...rest } = item;
      return { ...rest, requestId, status: "pending" as const, failedAttempts: [...(item.failedAttempts ?? []), priorAttempt] };
    }),
  }));
  return withEvent(next, { id: newId(), kind: "retry", artifactId, threadId, turnId, requestId });
}
export function markTurn<S extends ThreadedState>(state: S, artifactId: string, threadId: string, turnId: string, requestId: string, status: "failed" | "cancelled", error: string): S {
  return updateThread(state, artifactId, threadId, thread => ({ ...thread, turns: thread.turns.map(turn => turn.id === turnId && turn.requestId === requestId && turn.status !== "complete" ? { ...turn, status, error } : turn) }));
}
export function acceptReply<S extends ThreadedState>(state: S, response: ThreadReply): S {
  const artifact = state.artifacts.find(item => item.artifactId === response.artifactId);
  if (!artifact || artifact.question.questionId !== response.questionId || artifact.contentVersion !== response.contentVersion) return state;
  const thread = artifact.threads.find(item => item.turns.some(turn => turn.requestId === response.requestId && turn.status === "pending"));
  const turn = thread?.turns.find(item => item.requestId === response.requestId && item.status === "pending");
  if (!thread || !turn) return state;
  const next = updateThread(state, artifact.artifactId, thread.id, item => ({ ...item, turns: item.turns.map(item => item.id === turn.id ? { ...item, status: "complete", reply: response.reply, mode: response.mode } : item) }));
  return withEvent(next, { id: newId(), kind: "reply", artifactId: artifact.artifactId, threadId: thread.id, turnId: turn.id, requestId: response.requestId });
}
export function startThread<S extends ThreadedState>(state: S, artifactId: string): S {
  const artifact = findArtifact(state, artifactId), thread = activeThread(artifact), threadId = newId();
  const next = updateArtifact(state, artifactId, item => ({ ...item, threads: [...item.threads.map(item => item.id === thread.id ? { ...item, draft: artifact.messageDraft, turns: item.turns.map(turn => turn.status === "pending" ? { ...turn, status: "cancelled" as const, error: "이 퀴즈의 새 대화를 열어 기다리기를 중단했습니다." } : turn) } : item), { id: threadId, turns: [] }], activeThreadId: threadId, messageDraft: "" }));
  return withEvent(next, { id: newId(), kind: "thread", artifactId, threadId });
}
/** Reopening a record never replays a request: a pending turn becomes a cancelled one the learner can retry. */
export function restoredTurns(turns: WorkspaceTurn[]): WorkspaceTurn[] { return turns.map(turn => turn.status === "pending" ? { ...turn, status: "cancelled", error: "화면을 닫아 응답 기다리기를 중단했습니다. 자동으로 다시 전송하지 않습니다." } : turn); }
export function recoverServerTurnReply<S extends ThreadedState>(state: S, response: ThreadReply): S {
  const artifact = state.artifacts.find(item => item.artifactId === response.artifactId);
  if (!artifact || artifact.question.questionId !== response.questionId || artifact.contentVersion !== response.contentVersion) return state;
  const thread = artifact.threads.find(item => item.turns.some(turn => turn.requestId === response.requestId && turn.status !== "complete"));
  const turn = thread?.turns.find(item => item.requestId === response.requestId && item.status !== "complete");
  if (!thread || !turn) return state;
  const next = updateThread(state, artifact.artifactId, thread.id, item => ({
    ...item,
    turns: item.turns.map(item => {
      if (item.id !== turn.id) return item;
      const { error: _removedError, ...rest } = item;
      return { ...rest, status: "complete" as const, reply: response.reply, mode: response.mode };
    }),
  }));
  return withEvent(next, { id: newId(), kind: "reply", artifactId: artifact.artifactId, threadId: thread.id, turnId: turn.id, requestId: response.requestId });
}
