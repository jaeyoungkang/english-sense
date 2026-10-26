import { ARTIFACT_LESSON_ID, LEARNING_QUESTION_IDS, LEGACY_HAVE_CONTENT_VERSION, type PublicLearningCatalog, type PublicLearningQuestion } from "./learning-catalog";
import { LEARNING_LESSON_ID, learningChatLimits, type ArtifactInitialAttempt, type ArtifactLearningChatResponse, type LearningChatMessage } from "./learning-chat-contract";

export const WORKSPACE_STORAGE_KEYS = { v3: "english-sense-learning-workspace-v3", v2: "english-sense-learning-workspace-v2", v1: "english-sense-learning-workspace-v1" } as const;
export type WorkspaceTurn = { id: string; requestId: string; user: string; origin: "question" | "submission"; status: "pending" | "complete" | "failed" | "cancelled"; reply?: string; mode?: "guidance" | "ai"; error?: string };
export type WorkspaceThread = { id: string; turns: WorkspaceTurn[]; draft?: string };
export type QuizArtifact = { artifactId: string; lessonId: typeof ARTIFACT_LESSON_ID; contentVersion: string; question: PublicLearningQuestion; source: PublicLearningCatalog["source"]; choice: string; answerDraft: string; reason: string; initialAttempt: ArtifactInitialAttempt | null; revisions: { text: string }[]; revisionDraft: string; revisionOpen: boolean; messageDraft: string; threads: WorkspaceThread[]; activeThreadId: string; legacyImport?: { version: 1 | 2; record: LegacyBase & { events?: LegacyEvent[] } } };
export type WorkspaceEvent = { id: string; artifactId: string } & (
  | { kind: "card" | "initial" | "legacy" }
  | { kind: "revision"; index: number }
  | { kind: "thread"; threadId: string }
  | { kind: "request" | "retry" | "reply"; threadId: string; turnId: string; requestId: string }
);
export type WorkspaceState = { version: 3; lessonId: typeof ARTIFACT_LESSON_ID; artifacts: QuizArtifact[]; selectedArtifactId: string; events: WorkspaceEvent[] };
export const characterCount = (text: string) => [...text].length;
const chars = characterCount;
const newId = () => crypto.randomUUID();
const identity = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const text = (value: unknown, max: number, required = false): value is string => typeof value === "string" && chars(value) <= max && (!required || !!value.trim());
const publicKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

function validQuestion(value: unknown): value is PublicLearningQuestion {
  if (!object(value) || !publicKeys(value, ["questionId", "type", "ch", "who", "scene", "ask", "opts"]) || !LEARNING_QUESTION_IDS.includes(value.questionId as PublicLearningQuestion["questionId"]) || !Number.isInteger(value.ch) || !text(value.who, 1000, true) || !text(value.scene, 10000, true) || !text(value.ask, 10000, true)) return false;
  return value.type === "choose" ? Array.isArray(value.opts) && value.opts.length === 3 && value.opts.every(option => object(option) && publicKeys(option, ["t"]) && text(option.t, 5000, true)) : value.type === "produce" && value.opts === undefined;
}
function validAttempt(value: unknown, question: PublicLearningQuestion): value is ArtifactInitialAttempt | null {
  if (value === null) return true;
  if (!object(value)) return false;
  if (question.type === "choose") return publicKeys(value, ["kind", "choice", "reason"]) && value.kind === "choose" && Number.isInteger(value.choice) && Number(value.choice) >= 0 && Number(value.choice) < (question.opts?.length || 0) && text(value.reason, learningChatLimits.reason, true);
  return publicKeys(value, ["kind", "text", "reason"]) && value.kind === "produce" && text(value.text, learningChatLimits.answer, true) && (value.reason === undefined || text(value.reason, learningChatLimits.reason, true));
}
function artifactFrom(catalog: PublicLearningCatalog, question: PublicLearningQuestion): QuizArtifact {
  const artifactId = `quiz-${question.questionId}-${catalog.contentVersion.slice(0, 12)}`;
  const threadId = `${artifactId}-t1`;
  return { artifactId, lessonId: catalog.lessonId, contentVersion: catalog.contentVersion, question: structuredClone(question), source: { ...catalog.source }, choice: "", answerDraft: "", reason: "", initialAttempt: null, revisions: [], revisionDraft: "", revisionOpen: false, messageDraft: "", threads: [{ id: threadId, turns: [] }], activeThreadId: threadId };
}
export function createWorkspace(catalog: PublicLearningCatalog): WorkspaceState {
  if (!catalog.questions.length) throw new Error("학습 문항을 찾지 못했습니다.");
  const artifact = artifactFrom(catalog, catalog.questions[0]);
  return { version: 3, lessonId: catalog.lessonId, artifacts: [artifact], selectedArtifactId: artifact.artifactId, events: [{ id: `${artifact.artifactId}-opened`, kind: "card", artifactId: artifact.artifactId }] };
}
export function findArtifact(state: WorkspaceState, artifactId: string): QuizArtifact {
  const artifact = state.artifacts.find(item => item.artifactId === artifactId);
  if (!artifact) throw new Error("질문할 퀴즈를 찾지 못했습니다.");
  return artifact;
}
export function activeThread(artifact: QuizArtifact): WorkspaceThread { const thread = artifact.threads.find(item => item.id === artifact.activeThreadId); if (!thread) throw new Error("대화를 찾지 못했습니다."); return thread; }
export function updateArtifact(state: WorkspaceState, artifactId: string, update: (artifact: QuizArtifact) => QuizArtifact): WorkspaceState { return { ...state, artifacts: state.artifacts.map(item => item.artifactId === artifactId ? update(item) : item) }; }
export function selectArtifact(state: WorkspaceState, artifactId: string): WorkspaceState { findArtifact(state, artifactId); return { ...state, selectedArtifactId: artifactId }; }
/** Reading the complete catalog never registers a selection, submission or request. */
export function projectDocumentArtifacts(state: WorkspaceState, catalog: PublicLearningCatalog): QuizArtifact[] {
  return catalog.questions.map(question => {
    const saved = state.artifacts.find(artifact => artifact.question.questionId === question.questionId);
    return saved ? structuredClone(saved) : artifactFrom(catalog, question);
  });
}
/** Explicit selection is independent of the order in which questions were answered. */
export function selectQuestion(state: WorkspaceState, catalog: PublicLearningCatalog, questionId: string): WorkspaceState {
  const question = catalog.questions.find(question => question.questionId === questionId);
  if (!question) throw new Error("공개한 학습 문항을 찾지 못했습니다.");
  const saved = state.artifacts.find(artifact => artifact.question.questionId === questionId);
  if (saved) return selectArtifact(state, saved.artifactId);
  const artifact = artifactFrom(catalog, question);
  return { ...state, artifacts: [...state.artifacts, artifact], selectedArtifactId: artifact.artifactId, events: [...state.events, { id: newId(), kind: "card", artifactId: artifact.artifactId }] };
}
/** Compatibility for older sequential state transitions; the document UI uses selectQuestion. */
export function addNextArtifact(state: WorkspaceState, catalog: PublicLearningCatalog): WorkspaceState {
  const last = state.artifacts.at(-1)!;
  if (!last.initialAttempt) throw new Error("열려 있는 마지막 퀴즈에 먼저 답을 제출합니다.");
  if (last.contentVersion !== catalog.contentVersion) throw new Error("자료 판이 달라 다음 퀴즈를 붙이지 않았습니다. 이전 기록은 유지합니다.");
  const question = catalog.questions[state.artifacts.length];
  if (!question) return state;
  const artifact = artifactFrom(catalog, question);
  return { ...state, artifacts: [...state.artifacts, artifact], selectedArtifactId: artifact.artifactId, events: [...state.events, { id: newId(), artifactId: artifact.artifactId, kind: "card" }] };
}
export function submitInitial(state: WorkspaceState, artifactId: string, attempt: ArtifactInitialAttempt): WorkspaceState {
  const artifact = findArtifact(state, artifactId);
  if (artifact.initialAttempt) throw new Error("처음 제출한 답은 바꾸지 않습니다. 수정으로 남깁니다.");
  if (!validAttempt(attempt, artifact.question)) throw new Error("문항에 맞는 답과 까닭을 확인합니다.");
  const next = updateArtifact(state, artifactId, item => ({ ...item, initialAttempt: structuredClone(attempt) }));
  return { ...next, events: [...next.events, { id: newId(), artifactId, kind: "initial" }] };
}
export function addRevision(state: WorkspaceState, artifactId: string, value: string): WorkspaceState {
  const artifact = findArtifact(state, artifactId), content = value.trim();
  if (!artifact.initialAttempt || !text(content, learningChatLimits.revision, true) || artifact.revisions.length >= learningChatLimits.revisions) throw new Error("처음 답을 제출한 뒤 한도 안에서 수정합니다.");
  const next = updateArtifact(state, artifactId, item => ({ ...item, revisions: [...item.revisions, { text: content }], revisionDraft: "", revisionOpen: false }));
  return { ...next, events: [...next.events, { id: newId(), artifactId, kind: "revision", index: artifact.revisions.length }] };
}
export function historyFor(thread: WorkspaceThread): LearningChatMessage[] { return thread.turns.filter(turn => turn.status === "complete").flatMap(turn => [{ role: "user" as const, content: turn.user }, { role: "assistant" as const, content: turn.reply! }]); }
export function threadLimit(thread: WorkspaceThread): string | null {
  const messages = historyFor(thread);
  return messages.length > learningChatLimits.historyMessages || messages.some(item => chars(item.content) > learningChatLimits.historyMessage) || messages.reduce((sum, item) => sum + chars(item.content), 0) > learningChatLimits.historyCharacters ? "이 퀴즈의 대화 길이 한도에 도달했습니다. 내용을 자르지 않고 보존합니다. 이 퀴즈의 새 대화를 열 수 있습니다." : null;
}
function updateThread(state: WorkspaceState, artifactId: string, threadId: string, update: (thread: WorkspaceThread) => WorkspaceThread): WorkspaceState { return updateArtifact(state, artifactId, item => ({ ...item, threads: item.threads.map(thread => thread.id === threadId ? update(thread) : thread) })); }
export function beginTurn(state: WorkspaceState, artifactId: string, turn: WorkspaceTurn): WorkspaceState {
  const artifact = findArtifact(state, artifactId), thread = activeThread(artifact);
  if (threadLimit(thread) || thread.turns.some(item => item.status === "pending" || item.status === "failed") || !validTurn(turn) || turn.status !== "pending" || !identity(turn.id) || !identity(turn.requestId) || !turn.user.trim() || thread.turns.some(item => item.id === turn.id)) throw new Error("이 대화의 처리 중이거나 실패한 요청을 먼저 확인합니다.");
  const next = updateThread(state, artifactId, thread.id, item => ({ ...item, turns: [...item.turns, turn] }));
  return { ...next, events: [...next.events, { id: newId(), kind: "request", artifactId, threadId: thread.id, turnId: turn.id, requestId: turn.requestId }] };
}
export function retryTurn(state: WorkspaceState, artifactId: string, threadId: string, turnId: string, requestId: string): WorkspaceState {
  const artifact = findArtifact(state, artifactId), thread = artifact.threads.find(item => item.id === threadId), turn = thread?.turns.find(item => item.id === turnId);
  if (!thread || !turn || turn.status !== "failed" || threadId !== artifact.activeThreadId || threadLimit(thread)) throw new Error("현재 대화에서 실패한 요청만 다시 보낼 수 있습니다.");
  const next = updateThread(state, artifactId, threadId, item => ({ ...item, turns: item.turns.map(item => item.id === turnId ? { ...item, requestId, status: "pending", error: undefined } : item) }));
  return { ...next, events: [...next.events, { id: newId(), kind: "retry", artifactId, threadId, turnId, requestId }] };
}
export function markTurn(state: WorkspaceState, artifactId: string, threadId: string, turnId: string, requestId: string, status: "failed" | "cancelled", error: string): WorkspaceState {
  return updateThread(state, artifactId, threadId, thread => ({ ...thread, turns: thread.turns.map(turn => turn.id === turnId && turn.requestId === requestId && turn.status !== "complete" ? { ...turn, status, error } : turn) }));
}
export function acceptReply(state: WorkspaceState, response: ArtifactLearningChatResponse): WorkspaceState {
  const artifact = state.artifacts.find(item => item.artifactId === response.artifactId);
  if (!artifact || artifact.question.questionId !== response.questionId || artifact.contentVersion !== response.contentVersion) return state;
  const thread = artifact.threads.find(item => item.turns.some(turn => turn.requestId === response.requestId && turn.status === "pending"));
  const turn = thread?.turns.find(item => item.requestId === response.requestId && item.status === "pending");
  if (!thread || !turn) return state;
  const next = updateThread(state, artifact.artifactId, thread.id, item => ({ ...item, turns: item.turns.map(item => item.id === turn.id ? { ...item, status: "complete", reply: response.reply, mode: response.mode } : item) }));
  return { ...next, events: [...next.events, { id: newId(), kind: "reply", artifactId: artifact.artifactId, threadId: thread.id, turnId: turn.id, requestId: response.requestId }] };
}
export function startThread(state: WorkspaceState, artifactId: string): WorkspaceState {
  const artifact = findArtifact(state, artifactId), thread = activeThread(artifact), threadId = newId();
  const next = updateArtifact(state, artifactId, item => ({ ...item, threads: [...item.threads.map(item => item.id === thread.id ? { ...item, draft: artifact.messageDraft, turns: item.turns.map(turn => turn.status === "pending" ? { ...turn, status: "cancelled" as const, error: "이 퀴즈의 새 대화를 열어 기다리기를 중단했습니다." } : turn) } : item), { id: threadId, turns: [] }], activeThreadId: threadId, messageDraft: "" }));
  return { ...next, events: [...next.events, { id: newId(), kind: "thread", artifactId, threadId }] };
}

// Exact legacy shape and validation stay separate from the v3 artifact contract.
type LegacyAttempt = { choice: number; reason: string };
type LegacyTurn = { id: string; requestId: string; user: string; origin: "question" | "submission"; status: "pending" | "complete" | "failed" | "cancelled"; reply?: string; mode?: "guidance" | "ai"; error?: string };
type LegacyEvent =
  | { id: string; kind: "initial" }
  | { id: string; kind: "revision"; index: number }
  | { id: string; kind: "request" | "retry" | "reply"; turnId: string; requestId: string }
  | { id: string; kind: "legacy" | "carry"; hadInitial: boolean; revisionCount: number; turnIds: string[]; repliedTurnIds: string[] };
type LegacyArchive = { id: string; turns: LegacyTurn[]; draft: string; events?: LegacyEvent[] };
type LegacyBase = { lessonId: string; choice: string; reason: string; initialAttempt: LegacyAttempt | null; revisionDraft: string; revisions: { text: string }[]; messageDraft: string; turns: LegacyTurn[]; archives: LegacyArchive[] };
type LegacyV2 = LegacyBase & { version: 2; events: LegacyEvent[]; revisionOpen: boolean };
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validTurn(turn: unknown): turn is LegacyTurn {
  return object(turn) && typeof turn.id === "string" && typeof turn.requestId === "string" && typeof turn.user === "string" && chars(turn.user) <= learningChatLimits.message && ["question", "submission"].includes(turn.origin as string) && ["pending", "complete", "failed", "cancelled"].includes(turn.status as string) && (turn.reply === undefined || (typeof turn.reply === "string" && chars(turn.reply) <= learningChatLimits.reply)) && (turn.mode === undefined || ["guidance", "ai"].includes(turn.mode as string)) && (turn.error === undefined || typeof turn.error === "string") && (turn.status !== "complete" || (typeof turn.reply === "string" && ["guidance", "ai"].includes(turn.mode as string)));
}
function validBase(value: unknown): value is LegacyBase {
  if (!object(value) || value.lessonId !== LEARNING_LESSON_ID || !["", "0", "1", "2"].includes(value.choice as string) || typeof value.reason !== "string" || chars(value.reason) > learningChatLimits.reason || typeof value.revisionDraft !== "string" || chars(value.revisionDraft) > learningChatLimits.revision || typeof value.messageDraft !== "string" || chars(value.messageDraft) > learningChatLimits.message) return false;
  if (value.initialAttempt !== null && (!object(value.initialAttempt) || ![0, 1, 2].includes(value.initialAttempt.choice as number) || typeof value.initialAttempt.reason !== "string" || !value.initialAttempt.reason.trim() || chars(value.initialAttempt.reason) > learningChatLimits.reason)) return false;
  return Array.isArray(value.revisions) && value.revisions.length <= learningChatLimits.revisions && value.revisions.every(r => object(r) && typeof r.text === "string" && !!r.text.trim() && chars(r.text) <= learningChatLimits.revision) && Array.isArray(value.turns) && value.turns.every(validTurn) && Array.isArray(value.archives) && value.archives.every(a => object(a) && typeof a.id === "string" && typeof a.draft === "string" && Array.isArray(a.turns) && a.turns.every(validTurn));
}
function validEvents(value: unknown, record: Pick<LegacyBase, "initialAttempt" | "revisions" | "turns">): value is LegacyEvent[] {
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
function coversTurns(events: LegacyEvent[], turns: LegacyTurn[]): boolean {
  const representedTurn = (id: string) => events.some(event => ("turnId" in event && event.turnId === id && event.kind === "request") || (event.kind === "legacy" && event.turnIds.includes(id)));
  const representedReply = (id: string) => events.some(event => ("turnId" in event && event.turnId === id && event.kind === "reply") || (event.kind === "legacy" && event.repliedTurnIds.includes(id)));
  return turns.every(turn => representedTurn(turn.id) && (turn.status !== "complete" || representedReply(turn.id)));
}
function validLegacyV2(value: unknown): value is LegacyV2 {
  if (!validBase(value)) return false;
  const metadata = value as LegacyBase & Record<string, unknown>;
  // Archives cover their own turns, not revisions added after that conversation ended.
  if (metadata.version !== 2 || typeof metadata.revisionOpen !== "boolean" || !validEvents(metadata.events, value) || !value.archives.every(archive => archive.events === undefined || (validEvents(archive.events, { ...value, turns: archive.turns }) && coversTurns(archive.events, archive.turns)))) return false;
  const events = metadata.events;
  return coversTurns(events, value.turns) && (!value.initialAttempt || events.some(event => event.kind === "initial" || ((event.kind === "legacy" || event.kind === "carry") && event.hadInitial))) && value.revisions.every((_, index) => events.some(event => (event.kind === "revision" && event.index === index) || ((event.kind === "legacy" || event.kind === "carry") && event.revisionCount > index)));
}
function validArtifact(value: unknown): value is QuizArtifact {
  if (!object(value) || !identity(value.artifactId) || value.lessonId !== ARTIFACT_LESSON_ID || typeof value.contentVersion !== "string" || !/^[a-f0-9]{64}$/.test(value.contentVersion) || !validQuestion(value.question) || !object(value.source) || !publicKeys(value.source, ["title", "author", "path"]) || ![value.source.title, value.source.author, value.source.path].every(item => text(item, 2000, true))) return false;
  if (!text(value.choice, 20) || (value.choice !== "" && !["0", "1", "2"].includes(value.choice)) || !text(value.reason, learningChatLimits.reason) || !text(value.answerDraft, learningChatLimits.answer) || !validAttempt(value.initialAttempt, value.question) || !text(value.revisionDraft, learningChatLimits.revision) || typeof value.revisionOpen !== "boolean" || !text(value.messageDraft, learningChatLimits.message) || !Array.isArray(value.revisions) || value.revisions.length > learningChatLimits.revisions || !value.revisions.every(item => object(item) && publicKeys(item, ["text"]) && text(item.text, learningChatLimits.revision, true)) || (value.initialAttempt === null && value.revisions.length > 0)) return false;
  if (!Array.isArray(value.threads) || !value.threads.length || !value.threads.every(thread => object(thread) && identity(thread.id) && Array.isArray(thread.turns) && thread.turns.every(validTurn) && (thread.draft === undefined || text(thread.draft, learningChatLimits.message))) || new Set(value.threads.map(thread => thread.id)).size !== value.threads.length || !value.threads.some(thread => thread.id === value.activeThreadId)) return false;
  if (value.legacyImport !== undefined) {
    if (!object(value.legacyImport)) return false;
    const legacy = value.legacyImport;
    if (!(legacy.version === 2 ? validLegacyV2(legacy.record) : legacy.version === 1 && validBase(legacy.record) && (legacy.record as LegacyBase & { version?: number; pane?: string }).version === 1 && ["scene", "attempt", "chat"].includes((legacy.record as LegacyBase & { pane: string }).pane))) return false;
    if (value.contentVersion !== LEGACY_HAVE_CONTENT_VERSION || value.question.questionId !== LEARNING_QUESTION_IDS[0] || value.question.type !== "choose") return false;
    const original = legacy.record as LegacyBase;
    if (original.initialAttempt && (value.initialAttempt?.kind !== "choose" || value.initialAttempt.choice !== original.initialAttempt.choice || value.initialAttempt.reason !== original.initialAttempt.reason)) return false;
    if (!original.revisions.every((revision, index) => (value.revisions as { text: string }[])[index]?.text === revision.text)) return false;
  }
  return true;
}
function importedThread(artifact: QuizArtifact, threadId: string): LegacyTurn[] | null {
  const legacy = artifact.legacyImport?.record;
  if (!legacy) return null;
  if (threadId === `${artifact.artifactId}-legacy-current`) return legacy.turns;
  const index = legacy.archives.findIndex((_, index) => threadId === `${artifact.artifactId}-legacy-a${index}`);
  return index >= 0 ? legacy.archives[index].turns : null;
}
export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!object(value) || value.version !== 3 || value.lessonId !== ARTIFACT_LESSON_ID || !Array.isArray(value.artifacts) || !value.artifacts.length || value.artifacts.length > LEARNING_QUESTION_IDS.length || !value.artifacts.every(validArtifact) || !Array.isArray(value.events) || !value.artifacts.some(item => item.artifactId === value.selectedArtifactId)) return false;
  const artifacts = value.artifacts as QuizArtifact[], events = value.events as unknown[];
  if (new Set(artifacts.map(item => item.artifactId)).size !== artifacts.length || new Set(artifacts.map(item => item.question.questionId)).size !== artifacts.length) return false;
  const ids = new Set<string>();
  if (!events.every(raw => {
    if (!object(raw) || !identity(raw.id) || ids.has(raw.id)) return false;
    ids.add(raw.id);
    const artifact = artifacts.find(item => item.artifactId === raw.artifactId);
    if (!artifact) return false;
    if (raw.kind === "card") return true;
    if (raw.kind === "initial") return artifact.initialAttempt !== null;
    if (raw.kind === "legacy") return !!artifact.legacyImport;
    if (raw.kind === "revision") return Number.isInteger(raw.index) && Number(raw.index) >= 0 && Number(raw.index) < artifact.revisions.length;
    const thread = artifact.threads.find(item => item.id === raw.threadId);
    if (!thread) return false;
    if (raw.kind === "thread") return true;
    if (!["request", "retry", "reply"].includes(raw.kind as string) || !identity(raw.requestId)) return false;
    const turn = thread.turns.find(item => item.id === raw.turnId);
    return !!turn && (raw.kind !== "reply" || (turn.status === "complete" && turn.requestId === raw.requestId));
  })) return false;
  const typedEvents = value.events as WorkspaceEvent[];
  return artifacts.every(artifact => {
    const own = typedEvents.filter(event => event.artifactId === artifact.artifactId), legacy = artifact.legacyImport?.record;
    if (own.filter(event => event.kind === "card").length !== 1 || (!!legacy && own.filter(event => event.kind === "legacy").length !== 1)) return false;
    if (artifact.initialAttempt && !legacy?.initialAttempt && !own.some(event => event.kind === "initial")) return false;
    if (!artifact.revisions.every((_, index) => index < (legacy?.revisions.length || 0) || own.some(event => event.kind === "revision" && event.index === index))) return false;
    return artifact.threads.every(thread => {
      const imported = importedThread(artifact, thread.id);
      if (!imported && thread.id !== `${artifact.artifactId}-t1` && !own.some(event => event.kind === "thread" && event.threadId === thread.id)) return false;
      const turnIds = new Set(thread.turns.map(turn => turn.id));
      if (turnIds.size !== thread.turns.length) return false;
      if (imported && !imported.every(original => thread.turns.some(turn => turn.id === original.id && turn.user === original.user && (original.status !== "complete" || (turn.reply === original.reply && turn.mode === original.mode))))) return false;
      return thread.turns.every(turn => {
        const original = imported?.find(item => item.id === turn.id);
        return (!!original || own.some(event => event.kind === "request" && event.threadId === thread.id && event.turnId === turn.id)) && (turn.status !== "complete" || original?.status === "complete" || own.some(event => event.kind === "reply" && event.threadId === thread.id && event.turnId === turn.id && event.requestId === turn.requestId));
      });
    });
  });
}
function restoredTurns(turns: WorkspaceTurn[]): WorkspaceTurn[] { return turns.map(turn => turn.status === "pending" ? { ...turn, status: "cancelled", error: "화면을 닫아 응답 기다리기를 중단했습니다. 자동으로 다시 전송하지 않습니다." } : turn); }
function migrate(value: unknown, version: 1 | 2, catalog: PublicLearningCatalog): WorkspaceState {
  if (catalog.contentVersion !== LEGACY_HAVE_CONTENT_VERSION) throw new Error("이전 기록의 자료 판과 현재 자료가 다릅니다. 원본을 보존하고 자동으로 연결하지 않았습니다.");
  if (!(version === 2 ? validLegacyV2(value) : validBase(value) && (value as LegacyBase & { version?: number; pane?: string }).version === 1 && ["scene", "attempt", "chat"].includes((value as LegacyBase & { pane: string }).pane))) throw new Error("이전 임시 기록을 읽지 못했습니다. 원본을 보존합니다.");
  const legacy = value as LegacyBase;
  const state = createWorkspace(catalog), artifact = state.artifacts[0];
  if (artifact.question.questionId !== LEARNING_QUESTION_IDS[0] || artifact.question.type !== "choose") throw new Error("이전 기록의 첫 문항을 확인하지 못했습니다.");
  artifact.choice = legacy.choice; artifact.reason = legacy.reason; artifact.initialAttempt = legacy.initialAttempt ? { kind: "choose", ...legacy.initialAttempt } : null;
  artifact.revisions = structuredClone(legacy.revisions); artifact.revisionDraft = legacy.revisionDraft; artifact.revisionOpen = !!legacy.revisionDraft && !!legacy.initialAttempt; artifact.messageDraft = legacy.messageDraft;
  artifact.threads = [...legacy.archives.map((archive, index) => ({ id: `${artifact.artifactId}-legacy-a${index}`, turns: restoredTurns(structuredClone(archive.turns)), draft: archive.draft })), { id: `${artifact.artifactId}-legacy-current`, turns: restoredTurns(structuredClone(legacy.turns)) }];
  artifact.activeThreadId = `${artifact.artifactId}-legacy-current`;
  artifact.legacyImport = { version, record: structuredClone(value) as LegacyBase & { events?: LegacyEvent[] } };
  state.events.push({ id: newId(), artifactId: artifact.artifactId, kind: "legacy" });
  if (!isWorkspaceState(state)) throw new Error("이전 기록을 안전하게 연결하지 못했습니다. 원본을 보존합니다.");
  return state;
}
export function restoreWorkspace(raw: { v3: string | null; v2: string | null; v1: string | null }, catalog: PublicLearningCatalog): WorkspaceState {
  if (raw.v3 !== null) {
    const state: unknown = JSON.parse(raw.v3);
    if (!isWorkspaceState(state)) throw new Error("임시 기록의 내용이나 연결을 읽지 못했습니다. 원본을 보존합니다.");
    const publicFields = (question: PublicLearningQuestion) => [question.questionId, question.type, question.ch, question.who, question.scene, question.ask, question.opts?.map(option => option.t) ?? null];
    for (const artifact of state.artifacts) {
      if (artifact.contentVersion !== catalog.contentVersion) continue;
      const question = catalog.questions.find(item => item.questionId === artifact.question.questionId);
      if (!question || JSON.stringify(publicFields(artifact.question)) !== JSON.stringify(publicFields(question)) || artifact.source.title !== catalog.source.title || artifact.source.author !== catalog.source.author || artifact.source.path !== catalog.source.path) throw new Error("기록의 자료 판과 문항 내용이 맞지 않습니다. 원본을 보존하고 연결하지 않았습니다.");
    }
    return { ...state, artifacts: state.artifacts.map(artifact => ({ ...artifact, threads: artifact.threads.map(thread => ({ ...thread, turns: restoredTurns(thread.turns) })) })) };
  }
  if (raw.v2 !== null) return migrate(JSON.parse(raw.v2), 2, catalog);
  if (raw.v1 !== null) return migrate(JSON.parse(raw.v1), 1, catalog);
  return createWorkspace(catalog);
}
