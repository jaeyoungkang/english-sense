import { ARTIFACT_LESSON_ID } from "./learning-catalog";
import { learningChatLimits } from "./learning-chat-contract";
import { DOCUMENT_UI_STORAGE_KEY } from "./document-workspace-state";
import { WORKSPACE_STORAGE_KEYS } from "./learning-workspace-state";
import { acceptReply, beginTurn, findArtifact, identity, newId, object, publicKeys, restoredTurns, retryTurn, text, updateArtifact, validTurn, type ThreadEvent, type ThreadReply, type WorkspaceThread, type WorkspaceTurn } from "./learning-thread";
import { isLessonAttempt, isLessonCheckResponse, lessonCheckLimits, type LessonAttempt, type LessonCheckRequest, type LessonCheckResponse } from "./lesson-contract";
import { getLessonEntry, type LessonEntry, type PublicCard, type PublicCardsLesson, type PublicStoryLesson, type PublicStoryQuestion } from "./lesson-registry";
import { WORKSPACE_LAYOUT_STORAGE_KEY } from "./workspace-layout-state";

/**
 * Lesson record v4 for story and cards lessons, one browser record per lesson.
 * `titanic-have` keeps learning v3 and its global keys; nothing here reads or migrates them.
 * The record states facts (answers, judgements, events). It never derives completion, mastery or progress.
 */
export const LESSON_STORAGE_PREFIX = "english-sense-lesson-v4:";
export const readingLimitSeconds = 3600;

export type LessonDocument = PublicStoryLesson | PublicCardsLesson;
export type LessonQuestion = PublicStoryQuestion | PublicCard;
export type JudgementResponse = Extract<LessonCheckResponse, { kind: "choose" | "fill" }>;
export type RevealResponse = Extract<LessonCheckResponse, { kind: "reveal" }>;
/** `check` stays null until a judgement for exactly this attempt has been accepted. The attempt itself is never rewritten. */
export type LessonAttemptRecord = { attempt: LessonAttempt; check: JudgementResponse | null };
/** `afterAttempts` is how many attempts existed when the answers were shown; later attempts were made after seeing them. */
export type LessonReveal = { response: RevealResponse; afterAttempts: number };
export type LessonArtifact = {
  artifactId: string; lessonId: string; contentVersion: string; question: LessonQuestion;
  choice: number | null; inputs: string[]; messageDraft: string;
  attempts: LessonAttemptRecord[]; reveal: LessonReveal | null;
  threads: WorkspaceThread[]; activeThreadId: string;
};
/** Selecting a question is not an event. Reading start and end are lesson-level events without an artifact. */
export type LessonEvent = { id: string } & (
  | { kind: "initial"; artifactId: string }
  | { kind: "revision"; artifactId: string; index: number }
  | { kind: "check"; artifactId: string; index: number; requestId: string }
  | { kind: "reveal"; artifactId: string; requestId: string }
  | { kind: "reading-start"; readingId: string; startedAt: number; limitSeconds: number }
  | { kind: "reading-end"; readingId: string; endedAt: number; by: "time" | "user" }
  | ThreadEvent
);
export type LessonState = { version: 4; lessonId: string; artifacts: LessonArtifact[]; selectedQuestionId: string | null; events: LessonEvent[] };
export type LessonReply = ThreadReply & { lessonId: string };
export type ReadingStatus =
  | { phase: "before" }
  | { phase: "reading"; readingId: string; startedAt: number; deadline: number; remainingMs: number }
  | { phase: "ended"; readingId: string; startedAt: number; endedAt: number; by: "time" | "user"; readMs: number };
export type LessonAccess = "open" | "old-version" | "reading-not-ended";
export type LessonLoad = { ok: true; key: string; state: LessonState } | { ok: false; key: string; message: string };

type LessonEntryWithQuestions = Exclude<LessonEntry, { kind: "scene" }>;
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validTime = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : 1)) : item);
const lessonQuestions = (lesson: LessonDocument): LessonQuestion[] => lesson.kind === "story" ? lesson.questions : lesson.cards;
const blanksOf = (question: LessonQuestion) => "drill" in question ? question.drill.blanks : 0;

/** Record, document UI and layout keys per lesson. `titanic-have` keeps its existing keys (the record is still v3). */
export function lessonStorageKeys(lessonId: string): { recordVersion: 3 | 4; record: string; document: string; layout: string } {
  if (lessonId === ARTIFACT_LESSON_ID) return { recordVersion: 3, record: WORKSPACE_STORAGE_KEYS.v3, document: DOCUMENT_UI_STORAGE_KEY, layout: WORKSPACE_LAYOUT_STORAGE_KEY };
  const entry = getLessonEntry(lessonId);
  if (!entry) throw new Error("알 수 없는 수업입니다.");
  return { recordVersion: 4, record: `${LESSON_STORAGE_PREFIX}${lessonId}`, document: `${DOCUMENT_UI_STORAGE_KEY}:${lessonId}`, layout: `${WORKSPACE_LAYOUT_STORAGE_KEY}:${lessonId}` };
}

function artifactFrom(lesson: LessonDocument, question: LessonQuestion): LessonArtifact {
  const artifactId = `q-${question.questionId}-${lesson.contentVersion.slice(0, 12)}`, threadId = `${artifactId}-t1`;
  if (!identity(threadId)) throw new Error("문항 ID가 길어 기록 식별자를 만들 수 없습니다.");
  return { artifactId, lessonId: lesson.lessonId, contentVersion: lesson.contentVersion, question: structuredClone(question), choice: null, inputs: Array.from({ length: blanksOf(question) }, () => ""), messageDraft: "", attempts: [], reveal: null, threads: [{ id: threadId, turns: [] }], activeThreadId: threadId };
}
export function createLessonState(lesson: LessonDocument): LessonState {
  if (!getLessonEntry(lesson.lessonId) || lesson.lessonId === ARTIFACT_LESSON_ID || !lessonQuestions(lesson).length) throw new Error("수업 문항을 찾지 못했습니다.");
  return { version: 4, lessonId: lesson.lessonId, artifacts: [], selectedQuestionId: null, events: [] };
}
function sameLesson(state: LessonState, lesson: LessonDocument) {
  if (state.lessonId !== lesson.lessonId) throw new Error("다른 수업의 기록입니다.");
}
function questionOf(lesson: LessonDocument, questionId: string): LessonQuestion {
  const question = lessonQuestions(lesson).find(item => item.questionId === questionId);
  if (!question) throw new Error("공개한 수업 문항을 찾지 못했습니다.");
  return question;
}

/** Reading the complete lesson never registers a selection, an answer or a request. */
export function projectLessonArtifacts(state: LessonState, lesson: LessonDocument): LessonArtifact[] {
  sameLesson(state, lesson);
  return lessonQuestions(lesson).map(question => {
    const saved = state.artifacts.find(artifact => artifact.question.questionId === question.questionId);
    return saved ? structuredClone(saved) : artifactFrom(lesson, question);
  });
}
/** Selection is independent of answer order and registers no event, artifact or request. */
export function selectLessonQuestion(state: LessonState, lesson: LessonDocument, questionId: string): LessonState {
  sameLesson(state, lesson);
  questionOf(lesson, questionId);
  return state.selectedQuestionId === questionId ? state : { ...state, selectedQuestionId: questionId };
}
/** Gives a question its record (drafts, thread) without an event. Real work still goes through the reducers below. */
export function registerLessonArtifact(state: LessonState, lesson: LessonDocument, questionId: string): LessonState {
  sameLesson(state, lesson);
  const question = questionOf(lesson, questionId);
  if (state.artifacts.some(artifact => artifact.question.questionId === questionId)) return state;
  return { ...state, artifacts: [...state.artifacts, artifactFrom(lesson, question)] };
}

function readingOf(state: Pick<LessonState, "events">) {
  const start = state.events.find((event): event is Extract<LessonEvent, { kind: "reading-start" }> => event.kind === "reading-start");
  const end = start && state.events.find((event): event is Extract<LessonEvent, { kind: "reading-end" }> => event.kind === "reading-end" && event.readingId === start.readingId);
  return { start, end };
}
/** The deadline is wall-clock time, so a sleeping tab or a closed page cannot extend it. A passed deadline reads as ended by time even before its event is written. */
export function readingStatus(state: LessonState, now: number): ReadingStatus {
  const { start, end } = readingOf(state);
  if (!start) return { phase: "before" };
  const deadline = start.startedAt + start.limitSeconds * 1000;
  if (end) return { phase: "ended", readingId: start.readingId, startedAt: start.startedAt, endedAt: end.endedAt, by: end.by, readMs: end.endedAt - start.startedAt };
  if (now >= deadline) return { phase: "ended", readingId: start.readingId, startedAt: start.startedAt, endedAt: deadline, by: "time", readMs: deadline - start.startedAt };
  return { phase: "reading", readingId: start.readingId, startedAt: start.startedAt, deadline, remainingMs: Math.min(start.limitSeconds * 1000, deadline - now) };
}
export function startReading(state: LessonState, lesson: LessonDocument, now: number): LessonState {
  sameLesson(state, lesson);
  if (lesson.kind !== "story" || !validTime(now) || !Number.isInteger(lesson.limitSeconds) || lesson.limitSeconds < 1 || lesson.limitSeconds > readingLimitSeconds) throw new Error("이 수업에는 시간 제한 읽기가 없습니다.");
  if (readingOf(state).start) throw new Error("읽기는 한 번만 시작합니다.");
  return { ...state, events: [...state.events, { id: newId(), kind: "reading-start", readingId: newId(), startedAt: now, limitSeconds: lesson.limitSeconds }] };
}
/** Writes the end event once per reading. A passed deadline ends the reading by time at the deadline, not at `now`. */
export function syncReading(state: LessonState, now: number): LessonState {
  const { start, end } = readingOf(state);
  if (!start || end || !validTime(now)) return state;
  const deadline = start.startedAt + start.limitSeconds * 1000;
  return now >= deadline ? { ...state, events: [...state.events, { id: newId(), kind: "reading-end", readingId: start.readingId, endedAt: deadline, by: "time" }] } : state;
}
export function endReading(state: LessonState, now: number): LessonState {
  const { start, end } = readingOf(state);
  if (!start) throw new Error("읽기를 시작한 뒤에 마칩니다.");
  if (end || !validTime(now)) return state;
  const synced = syncReading(state, now);
  if (synced !== state) return synced;
  return { ...state, events: [...state.events, { id: newId(), kind: "reading-end", readingId: start.readingId, endedAt: Math.max(now, start.startedAt), by: "user" }] };
}

/** Story questions open after the reading ends. An artifact from another content version is read-only. */
export function lessonAccess(state: LessonState, lesson: LessonDocument, artifact: LessonArtifact): LessonAccess {
  if (artifact.contentVersion !== lesson.contentVersion) return "old-version";
  return lesson.kind === "story" && !readingOf(state).end ? "reading-not-ended" : "open";
}
function liveArtifact(state: LessonState, lesson: LessonDocument, artifactId: string): LessonArtifact {
  sameLesson(state, lesson);
  const artifact = findArtifact(state, artifactId), access = lessonAccess(state, lesson, artifact);
  if (access === "old-version") throw new Error("자료 판이 바뀌어 이 기록은 읽기만 합니다. 판정과 AI 전송은 하지 않습니다.");
  if (access === "reading-not-ended") throw new Error("읽기를 마친 뒤에 문제를 엽니다.");
  return artifact;
}
function fitsQuestion(attempt: LessonAttempt, question: LessonQuestion) {
  return "options" in question ? attempt.kind === "choose" && attempt.choice < question.options.length : attempt.kind === "fill" && attempt.inputs.length === question.drill.blanks;
}
function sameAttempt(a: LessonAttempt, b: LessonAttempt) {
  return a.kind === "choose" ? b.kind === "choose" && a.choice === b.choice : b.kind === "fill" && a.inputs.length === b.inputs.length && a.inputs.every((input, index) => input === b.inputs[index]);
}
function fitsJudgement(attempt: LessonAttempt, response: JudgementResponse, question: LessonQuestion) {
  return attempt.kind === "choose" ? response.kind === "choose" && response.choice === attempt.choice && "options" in question && response.answerIndex < question.options.length : response.kind === "fill" && response.matches.length === attempt.inputs.length;
}

/**
 * The first answer is never replaced: a revision is a new attempt after the previous one was judged.
 * A story question has no revision because its judgement already shows the answer.
 */
export function submitLessonAttempt(state: LessonState, lesson: LessonDocument, artifactId: string, attempt: LessonAttempt): LessonState {
  const artifact = liveArtifact(state, lesson, artifactId), last = artifact.attempts.at(-1);
  if (!isLessonAttempt(attempt) || !fitsQuestion(attempt, artifact.question)) throw new Error("문항에 맞는 답을 확인합니다.");
  if (last && ("options" in artifact.question || artifact.attempts.length > learningChatLimits.revisions)) throw new Error("처음 제출한 답은 바꾸지 않습니다. 이 문항에는 더 수정하지 않습니다.");
  if (last && !last.check) throw new Error("직전 답의 판정을 받은 뒤 수정합니다.");
  const index = artifact.attempts.length;
  const next = updateArtifact(state, artifactId, item => ({ ...item, attempts: [...item.attempts, { attempt: structuredClone(attempt), check: null }] }));
  return { ...next, events: [...next.events, index === 0 ? { id: newId(), kind: "initial", artifactId } : { id: newId(), kind: "revision", artifactId, index }] };
}
const requestIdentity = (requestId: string) => { if (!identity(requestId)) throw new Error("요청 식별자를 확인합니다."); };
/** Builds the request for the newest attempt that has no judgement. Sending the same request again is safe because judging is idempotent. */
export function buildLessonCheckRequest(state: LessonState, lesson: LessonDocument, artifactId: string, requestId: string): LessonCheckRequest {
  const artifact = liveArtifact(state, lesson, artifactId), last = artifact.attempts.at(-1);
  requestIdentity(requestId);
  if (!last || last.check) throw new Error("판정을 받지 않은 답이 없습니다.");
  return { action: "check", lessonId: lesson.lessonId, questionId: artifact.question.questionId, contentVersion: artifact.contentVersion, artifactId, requestId, attempt: structuredClone(last.attempt) };
}
/** '답 보기' is only for a card that already has a first answer. The first answer is the input the server needs. */
export function buildLessonRevealRequest(state: LessonState, lesson: LessonDocument, artifactId: string, requestId: string): LessonCheckRequest {
  const artifact = liveArtifact(state, lesson, artifactId), first = artifact.attempts[0];
  requestIdentity(requestId);
  if (!first || "options" in artifact.question) throw new Error("첫 답을 낸 카드에서만 답을 봅니다.");
  if (artifact.reveal) throw new Error("이미 답을 봤습니다.");
  return { action: "reveal", lessonId: lesson.lessonId, questionId: artifact.question.questionId, contentVersion: artifact.contentVersion, artifactId, requestId, attempt: structuredClone(first.attempt) };
}
function targetArtifact(state: LessonState, request: LessonCheckRequest, response: LessonCheckResponse) {
  const artifact = state.artifacts.find(item => item.artifactId === request.artifactId);
  const same = state.lessonId === request.lessonId && response.requestId === request.requestId && response.lessonId === request.lessonId && response.artifactId === request.artifactId && response.questionId === request.questionId && response.contentVersion === request.contentVersion;
  return same && isLessonCheckResponse(response) && artifact && artifact.question.questionId === request.questionId && artifact.contentVersion === request.contentVersion ? artifact : null;
}
/** A judgement is adopted only for the request that asked for it and only while its attempt is still the unjudged one. Otherwise the state is returned unchanged. */
export function acceptLessonCheck(state: LessonState, request: LessonCheckRequest, response: LessonCheckResponse): LessonState {
  const artifact = request.action === "check" && response.kind !== "reveal" ? targetArtifact(state, request, response) : null;
  const index = artifact ? artifact.attempts.length - 1 : -1, last = artifact?.attempts[index];
  if (!artifact || !last || last.check || response.kind === "reveal" || !sameAttempt(last.attempt, request.attempt) || !fitsJudgement(last.attempt, response, artifact.question)) return state;
  const next = updateArtifact(state, artifact.artifactId, item => ({ ...item, attempts: item.attempts.map((entry, at) => at === index ? { ...entry, check: structuredClone(response) } : entry) }));
  return { ...next, events: [...next.events, { id: newId(), kind: "check", artifactId: artifact.artifactId, index, requestId: request.requestId }] };
}
/** The answers are adopted only after a first answer exists, and only once. */
export function acceptLessonReveal(state: LessonState, request: LessonCheckRequest, response: LessonCheckResponse): LessonState {
  const artifact = request.action === "reveal" && response.kind === "reveal" ? targetArtifact(state, request, response) : null;
  const first = artifact?.attempts[0];
  if (!artifact || !first || artifact.reveal || response.kind !== "reveal" || first.attempt.kind !== "fill" || !sameAttempt(first.attempt, request.attempt) || response.answers.length !== first.attempt.inputs.length) return state;
  const next = updateArtifact(state, artifact.artifactId, item => ({ ...item, reveal: { response: structuredClone(response), afterAttempts: item.attempts.length } }));
  return { ...next, events: [...next.events, { id: newId(), kind: "reveal", artifactId: artifact.artifactId, requestId: request.requestId }] };
}

/** Sending a question needs a live artifact, so an old content version or an unfinished reading cannot start a request. */
export function beginLessonTurn(state: LessonState, lesson: LessonDocument, artifactId: string, turn: WorkspaceTurn): LessonState {
  liveArtifact(state, lesson, artifactId);
  return beginTurn(state, artifactId, turn);
}
export function retryLessonTurn(state: LessonState, lesson: LessonDocument, artifactId: string, threadId: string, turnId: string, requestId: string): LessonState {
  liveArtifact(state, lesson, artifactId);
  return retryTurn(state, artifactId, threadId, turnId, requestId);
}
/** A reply must repeat the lesson as well as the artifact, question, version and request it answers. */
export function acceptLessonReply(state: LessonState, response: LessonReply): LessonState {
  return response.lessonId === state.lessonId ? acceptReply(state, response) : state;
}

function validQuestion(value: unknown, entry: LessonEntryWithQuestions): value is LessonQuestion {
  if (!object(value) || !identity(value.questionId) || !entry.questionIds.includes(value.questionId)) return false;
  if (entry.kind === "story") {
    return publicKeys(value, ["questionId", "kind", "question", "options", "card"]) && ["kind", "question", "options"].every(key => Object.hasOwn(value, key)) && ["content", "sense", "expression"].includes(value.kind as string) && text(value.question, 10000, true)
      && Array.isArray(value.options) && value.options.length === lessonCheckLimits.choices && value.options.every(option => text(option, 5000, true)) && (value.card === undefined || identity(value.card));
  }
  const place = (item: unknown, keys: string[]) => object(item) && (Object.hasOwn(item, "part") ? Number.isInteger(item.part) && Number(item.part) >= 0 && exact(item, ["part", ...keys]) : text(item.time, 50, true) && exact(item, ["time", ...keys]));
  if (!publicKeys(value, ["questionId", "expression", "count", "countInPart", "meaning", "sense", "basis", "example", "drill"]) || !["expression", "count", "meaning", "sense", "basis", "example", "drill"].every(key => Object.hasOwn(value, key))) return false;
  return text(value.expression, 500, true) && Number.isInteger(value.count) && Number(value.count) >= 0 && (value.countInPart === undefined || (Number.isInteger(value.countInPart) && Number(value.countInPart) >= 0)) && text(value.meaning, 5000, true) && text(value.sense, 5000, true) && text(value.basis, 5000, true)
    && place(value.example, ["text"]) && text((value.example as Record<string, unknown>).text, 5000, true)
    && place(value.drill, ["sentence", "hint", "blanks"]) && text((value.drill as Record<string, unknown>).sentence, 5000, true) && text((value.drill as Record<string, unknown>).hint, 1000) && Number.isInteger((value.drill as Record<string, unknown>).blanks) && Number((value.drill as Record<string, unknown>).blanks) >= 1 && Number((value.drill as Record<string, unknown>).blanks) <= lessonCheckLimits.blanks;
}
function validArtifact(value: unknown, entry: LessonEntryWithQuestions): value is LessonArtifact {
  if (!object(value) || !exact(value, ["artifactId", "lessonId", "contentVersion", "question", "choice", "inputs", "messageDraft", "attempts", "reveal", "threads", "activeThreadId"]) || !identity(value.artifactId) || value.lessonId !== entry.lessonId || typeof value.contentVersion !== "string" || !/^[a-f0-9]{64}$/.test(value.contentVersion) || !validQuestion(value.question, entry)) return false;
  const question = value.question as LessonQuestion;
  if (!text(value.messageDraft, learningChatLimits.message) || !Array.isArray(value.inputs) || !Array.isArray(value.attempts)) return false;
  if ("options" in question) {
    if (value.inputs.length || !(value.choice === null || (Number.isInteger(value.choice) && Number(value.choice) >= 0 && Number(value.choice) < question.options.length))) return false;
  } else if (value.choice !== null || value.inputs.length !== question.drill.blanks || !value.inputs.every(input => text(input, lessonCheckLimits.input))) return false;
  const attempts = value.attempts as unknown[];
  if (attempts.length > 1 + learningChatLimits.revisions || ("options" in question && attempts.length > 1)) return false;
  const valid = attempts.every((entryValue, index) => {
    if (!object(entryValue) || !exact(entryValue, ["attempt", "check"]) || !isLessonAttempt(entryValue.attempt) || !fitsQuestion(entryValue.attempt, question)) return false;
    // A revision starts only after the previous attempt was judged.
    if (entryValue.check === null) return index === attempts.length - 1;
    const check = entryValue.check;
    return isLessonCheckResponse(check) && check.kind !== "reveal" && check.lessonId === value.lessonId && check.artifactId === value.artifactId && check.questionId === question.questionId && check.contentVersion === value.contentVersion && fitsJudgement(entryValue.attempt, check, question);
  });
  if (!valid) return false;
  if (value.reveal !== null) {
    const reveal = value.reveal;
    if ("options" in question || !object(reveal) || !exact(reveal, ["response", "afterAttempts"]) || !Number.isInteger(reveal.afterAttempts) || Number(reveal.afterAttempts) < 1 || Number(reveal.afterAttempts) > attempts.length || !isLessonCheckResponse(reveal.response)) return false;
    const response = reveal.response;
    if (response.kind !== "reveal" || response.lessonId !== value.lessonId || response.artifactId !== value.artifactId || response.questionId !== question.questionId || response.contentVersion !== value.contentVersion || response.answers.length !== question.drill.blanks) return false;
  }
  // The same thread contract as learning v3: unique identities, a known active thread, valid turns.
  return Array.isArray(value.threads) && value.threads.length > 0 && value.threads.every(thread => object(thread) && identity(thread.id) && Array.isArray(thread.turns) && thread.turns.every(validTurn) && (thread.draft === undefined || text(thread.draft, learningChatLimits.message))) && new Set(value.threads.map(thread => thread.id)).size === value.threads.length && value.threads.some(thread => thread.id === value.activeThreadId);
}

export function isLessonState(value: unknown): value is LessonState {
  if (!object(value) || !exact(value, ["version", "lessonId", "artifacts", "selectedQuestionId", "events"]) || value.version !== 4) return false;
  const entry = getLessonEntry(value.lessonId);
  if (!entry || entry.kind === "scene" || !Array.isArray(value.artifacts) || value.artifacts.length > entry.questionIds.length || !value.artifacts.every(artifact => validArtifact(artifact, entry)) || !Array.isArray(value.events)) return false;
  if (value.selectedQuestionId !== null && (typeof value.selectedQuestionId !== "string" || !entry.questionIds.includes(value.selectedQuestionId))) return false;
  const artifacts = value.artifacts as LessonArtifact[], events = value.events as unknown[];
  if (new Set(artifacts.map(item => item.artifactId)).size !== artifacts.length || new Set(artifacts.map(item => item.question.questionId)).size !== artifacts.length) return false;
  const ids = new Set<string>(), seen = new Map(artifacts.map(item => [item.artifactId, { attempts: 0, checks: new Set<number>(), reveals: 0 }]));
  let start: Extract<LessonEvent, { kind: "reading-start" }> | undefined, ended = false;
  const gated = ["initial", "revision", "check", "reveal", "request", "retry"];
  const valid = events.every(raw => {
    if (!object(raw) || !identity(raw.id) || ids.has(raw.id)) return false;
    ids.add(raw.id);
    if (raw.kind === "reading-start") {
      if (entry.kind !== "story" || start || !exact(raw, ["id", "kind", "readingId", "startedAt", "limitSeconds"]) || !identity(raw.readingId) || !validTime(raw.startedAt) || !Number.isInteger(raw.limitSeconds) || Number(raw.limitSeconds) < 1 || Number(raw.limitSeconds) > readingLimitSeconds) return false;
      start = raw as Extract<LessonEvent, { kind: "reading-start" }>;
      return true;
    }
    if (raw.kind === "reading-end") {
      if (!start || ended || !exact(raw, ["id", "kind", "readingId", "endedAt", "by"]) || raw.readingId !== start.readingId || !validTime(raw.endedAt) || !["time", "user"].includes(raw.by as string)) return false;
      const deadline = start.startedAt + start.limitSeconds * 1000;
      ended = true;
      return raw.by === "time" ? raw.endedAt === deadline : Number(raw.endedAt) >= start.startedAt && Number(raw.endedAt) <= deadline;
    }
    // A story question opens only after its reading ended; a record that answers earlier is not one this app wrote.
    if (entry.kind === "story" && gated.includes(raw.kind as string) && !ended) return false;
    const artifact = artifacts.find(item => item.artifactId === raw.artifactId), count = seen.get(raw.artifactId as string);
    if (!artifact || !count) return false;
    if (raw.kind === "initial" || raw.kind === "revision") {
      // Attempt events appear in order: the initial event first, then one revision per later attempt.
      const first = raw.kind === "initial";
      if (!exact(raw, first ? ["id", "kind", "artifactId"] : ["id", "kind", "artifactId", "index"]) || (first ? count.attempts !== 0 : raw.index !== count.attempts || count.attempts < 1) || count.attempts >= artifact.attempts.length) return false;
      count.attempts++;
      return true;
    }
    if (raw.kind === "check") {
      const index = raw.index as number, check = artifact.attempts[index]?.check;
      if (!exact(raw, ["id", "kind", "artifactId", "index", "requestId"]) || !Number.isInteger(index) || index >= count.attempts || count.checks.has(index) || !check || check.requestId !== raw.requestId) return false;
      count.checks.add(index);
      return true;
    }
    if (raw.kind === "reveal") {
      if (!exact(raw, ["id", "kind", "artifactId", "requestId"]) || count.reveals > 0 || !artifact.reveal || artifact.reveal.response.requestId !== raw.requestId || artifact.reveal.afterAttempts !== count.attempts) return false;
      count.reveals++;
      return true;
    }
    const thread = artifact.threads.find(item => item.id === raw.threadId);
    if (!thread) return false;
    if (raw.kind === "thread") return exact(raw, ["id", "kind", "artifactId", "threadId"]);
    if (!["request", "retry", "reply"].includes(raw.kind as string) || !exact(raw, ["id", "kind", "artifactId", "threadId", "turnId", "requestId"]) || !identity(raw.requestId)) return false;
    const turn = thread.turns.find(item => item.id === raw.turnId);
    return !!turn && (raw.kind !== "reply" || (turn.status === "complete" && turn.requestId === raw.requestId));
  });
  if (!valid) return false;
  const typed = events as LessonEvent[];
  return artifacts.every(artifact => {
    const count = seen.get(artifact.artifactId)!, own = typed.filter((event): event is Exclude<LessonEvent, { kind: "reading-start" | "reading-end" }> => "artifactId" in event && event.artifactId === artifact.artifactId);
    if (count.attempts !== artifact.attempts.length || artifact.attempts.some((entry, index) => !!entry.check !== count.checks.has(index)) || count.reveals !== (artifact.reveal ? 1 : 0)) return false;
    return artifact.threads.every(thread => {
      if (thread.id !== `${artifact.artifactId}-t1` && !own.some(event => event.kind === "thread" && event.threadId === thread.id)) return false;
      if (new Set(thread.turns.map(turn => turn.id)).size !== thread.turns.length) return false;
      return thread.turns.every(turn => own.some(event => event.kind === "request" && event.threadId === thread.id && event.turnId === turn.id) && (turn.status !== "complete" || own.some(event => event.kind === "reply" && event.threadId === thread.id && event.turnId === turn.id && event.requestId === turn.requestId)));
    });
  });
}

/**
 * Restoring never sends a request: a pending turn becomes cancelled, and a reading whose deadline passed ends by time.
 * A corrupt record or a record for another lesson throws and is left in storage untouched.
 * An artifact of another content version is kept as it is and reads as old-version.
 */
export function restoreLessonState(raw: string | null, lesson: LessonDocument, now: number): LessonState {
  if (raw === null) return createLessonState(lesson);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("임시 기록을 읽지 못했습니다. 원본을 보존합니다."); }
  if (!isLessonState(value)) throw new Error("임시 기록의 내용이나 연결을 읽지 못했습니다. 원본을 보존합니다.");
  sameLesson(value, lesson);
  for (const artifact of value.artifacts) {
    if (artifact.contentVersion !== lesson.contentVersion) continue;
    const question = lessonQuestions(lesson).find(item => item.questionId === artifact.question.questionId);
    if (!question || canonical(question) !== canonical(artifact.question)) throw new Error("기록의 자료 판과 문항 내용이 맞지 않습니다. 원본을 보존하고 연결하지 않았습니다.");
  }
  const restored: LessonState = { ...value, artifacts: value.artifacts.map(artifact => ({ ...artifact, threads: artifact.threads.map(thread => ({ ...thread, turns: restoredTurns(thread.turns) })) })) };
  return syncReading(restored, now);
}
/** Reads one lesson's own key. A corrupt record blocks only that lesson because no other lesson shares the key. */
export function loadLessonRecord(read: (key: string) => string | null, lesson: LessonDocument, now: number): LessonLoad {
  const key = lessonStorageKeys(lesson.lessonId).record;
  try { return { ok: true, key, state: restoreLessonState(read(key), lesson, now) }; } catch (error) { return { ok: false, key, message: error instanceof Error ? error.message : "임시 기록을 읽지 못했습니다. 원본을 보존합니다." }; }
}
