import assert from "node:assert/strict";
import { test } from "node:test";
import { DOCUMENT_UI_STORAGE_KEY } from "../lib/document-workspace-state";
import { ARTIFACT_LESSON_ID } from "../lib/learning-catalog";
import { acceptReply as v3AcceptReply, beginTurn as v3BeginTurn, startThread as v3StartThread, WORKSPACE_STORAGE_KEYS } from "../lib/learning-workspace-state";
import { acceptReply, activeThread, beginTurn, findArtifact, historyFor, markTurn, startThread, type WorkspaceTurn } from "../lib/learning-thread";
import type { LessonCheckRequest, LessonCheckResponse } from "../lib/lesson-contract";
import { LESSONS } from "../lib/lesson-registry";
import {
  acceptLessonCheck, acceptLessonReply, acceptLessonReveal, beginLessonTurn, buildLessonCheckRequest, buildLessonRevealRequest, createLessonState, endReading,
  isLessonState, lessonAccess, lessonStorageKeys, loadLessonRecord, projectLessonArtifacts, readingStatus, registerLessonArtifact, restoreLessonState, retryLessonTurn,
  selectLessonQuestion, startReading, submitLessonAttempt, syncReading, LESSON_STORAGE_PREFIX, type LessonDocument, type LessonReply, type LessonState,
} from "../lib/lesson-workspace-state";
import { getPublicLesson } from "../lib/server/lesson-catalog";
import { handleLessonCheck } from "../lib/server/lesson-check";
import { WORKSPACE_LAYOUT_STORAGE_KEY } from "../lib/workspace-layout-state";

const copy = <T>(value: T): T => structuredClone(value);
const lesson = async (id: string) => (await getPublicLesson(id)) as LessonDocument;
const story = () => lesson("green-umbrella");
const cards = () => lesson("wonder-unit-0");
const T0 = 1_800_000_000_000;

function checked(state: LessonState): LessonState {
  assert.equal(isLessonState(state), true, "every transition must satisfy the record contract");
  const restored: unknown = JSON.parse(JSON.stringify(state));
  assert.equal(isLessonState(restored), true, "JSON round trips keep every required reference");
  assert.equal(JSON.stringify(restored), JSON.stringify(state), "serialization keeps the persisted representation stable");
  return state;
}
/** The real handler judges, so a stored judgement is exactly what the server returns. */
async function respond(request: LessonCheckRequest): Promise<LessonCheckResponse> {
  const response = await handleLessonCheck(new Request("https://english.example/api/lesson-check/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
  assert.equal(response.status, 200);
  return await response.json() as LessonCheckResponse;
}
function turn(id: string, requestId = `${id}-request`): WorkspaceTurn { return { id, requestId, user: `Question ${id}`, origin: "question", status: "pending" }; }
/** A story lesson whose reading already ended, with one registered artifact per question. */
async function readStory(): Promise<{ doc: LessonDocument; state: LessonState }> {
  const doc = await story();
  let state = checked(createLessonState(doc));
  state = checked(startReading(state, doc, T0));
  state = checked(endReading(state, T0 + 5000));
  return { doc, state };
}
async function openCard(index = 0): Promise<{ doc: LessonDocument; state: LessonState; id: string }> {
  const doc = await cards();
  const questionId = (doc.kind === "cards" ? doc.cards : [])[index].questionId;
  const state = checked(registerLessonArtifact(createLessonState(doc), doc, questionId));
  return { doc, state, id: state.artifacts[0].artifactId };
}
const allBlank = (blanks: number, text = "wrong") => Array.from({ length: blanks }, () => text);
const blanksOf = (artifact: { question: object }) => ("drill" in artifact.question ? (artifact.question as { drill: { blanks: number } }).drill.blanks : 0);

test("storage keys are per lesson, never collide, and leave have on its existing v3 and global keys", () => {
  assert.deepEqual(lessonStorageKeys(ARTIFACT_LESSON_ID), { recordVersion: 3, record: WORKSPACE_STORAGE_KEYS.v3, document: DOCUMENT_UI_STORAGE_KEY, layout: WORKSPACE_LAYOUT_STORAGE_KEY });
  const others = LESSONS.filter(entry => entry.lessonId !== ARTIFACT_LESSON_ID);
  assert.equal(others.length, 28);
  const all = [...Object.values(WORKSPACE_STORAGE_KEYS), DOCUMENT_UI_STORAGE_KEY, WORKSPACE_LAYOUT_STORAGE_KEY, ...others.flatMap(entry => { const keys = lessonStorageKeys(entry.lessonId); return [keys.record, keys.document, keys.layout]; })];
  assert.equal(new Set(all).size, all.length, "no key is shared between lessons or with the v1, v2, v3, document and layout keys");
  assert.equal(lessonStorageKeys("green-umbrella").record, `${LESSON_STORAGE_PREFIX}green-umbrella`);
  assert.equal(LESSON_STORAGE_PREFIX, "english-sense-lesson-v4:");
  assert.equal(lessonStorageKeys("wonder-unit-0").document, `${DOCUMENT_UI_STORAGE_KEY}:wonder-unit-0`);
  assert.equal(lessonStorageKeys("wonder-unit-0").layout, `${WORKSPACE_LAYOUT_STORAGE_KEY}:wonder-unit-0`);
  assert.throws(() => lessonStorageKeys("__proto__"));
  assert.throws(() => lessonStorageKeys("unknown-lesson"));
});

test("the conversation reducers are the same functions for v3 and v4", () => {
  assert.equal(v3BeginTurn, beginTurn);
  assert.equal(v3AcceptReply, acceptReply);
  assert.equal(v3StartThread, startThread);
});

test("reading the whole lesson and selecting questions in any order register no event, artifact or request", async () => {
  for (const doc of [await story(), await cards()]) {
    let state = checked(createLessonState(doc));
    const questions = doc.kind === "story" ? doc.questions : doc.cards, raw = JSON.stringify(state);
    const projected = projectLessonArtifacts(state, doc);
    assert.deepEqual(projected.map(item => item.question.questionId), questions.map(item => item.questionId));
    assert.equal(new Set(projected.map(item => item.artifactId)).size, questions.length);
    assert.equal(JSON.stringify(state), raw, "projection does not touch the record");
    state = checked(selectLessonQuestion(state, doc, questions.at(-1)!.questionId));
    state = checked(selectLessonQuestion(state, doc, questions[1].questionId));
    assert.equal(state.selectedQuestionId, questions[1].questionId);
    assert.deepEqual(state.artifacts, []);
    assert.deepEqual(state.events, []);
    assert.equal(selectLessonQuestion(state, doc, questions[1].questionId), state, "reselecting returns the same record");
    assert.throws(() => selectLessonQuestion(state, doc, "unknown-question"));
    assert.throws(() => selectLessonQuestion(state, { ...doc, lessonId: "bus-dog" }, questions[0].questionId), /다른 수업/);
    projected[0].question.questionId = "changed";
    assert.equal(projectLessonArtifacts(state, doc)[0].question.questionId, questions[0].questionId, "projections do not share mutable snapshots");
  }
});

test("registering an artifact keeps the drafts and thread without any event", async () => {
  const { doc, state } = await openCard();
  assert.equal(state.artifacts.length, 1);
  assert.deepEqual(state.events, []);
  assert.equal(registerLessonArtifact(state, doc, state.artifacts[0].question.questionId), state);
  assert.equal(state.artifacts[0].inputs.length, blanksOf(state.artifacts[0]));
  assert.equal(activeThread(state.artifacts[0]).id, `${state.artifacts[0].artifactId}-t1`);
});

test("every lesson of the registry can register all its questions with valid identities, 22-card and four-option lessons included", async () => {
  const sizes: number[] = [];
  for (const entry of LESSONS.filter(item => item.kind !== "scene")) {
    const doc = await lesson(entry.lessonId);
    let state = createLessonState(doc);
    for (const questionId of entry.questionIds) state = registerLessonArtifact(state, doc, questionId);
    assert.equal(state.artifacts.length, entry.questionIds.length);
    assert.equal(isLessonState(state), true, `${entry.lessonId} with all questions registered`);
    assert.ok(state.artifacts.every(artifact => artifact.artifactId.length + 3 <= 80));
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(state))), JSON.stringify(state));
    sizes.push(entry.questionIds.length);
  }
  assert.ok(sizes.includes(22), "a 22-card lesson is covered");
  const doc = await story();
  assert.ok(doc.kind === "story" && doc.questions.every(question => question.options.length === 4));
});

test("a story reading ends once, by the wall clock, and an expired reading restores as ended by time", async () => {
  const doc = await story();
  assert.ok(doc.kind === "story");
  const limit = doc.limitSeconds * 1000;
  let state = checked(createLessonState(doc));
  assert.deepEqual(readingStatus(state, T0), { phase: "before" });
  state = checked(startReading(state, doc, T0));
  assert.deepEqual(state.events.map(event => event.kind), ["reading-start"]);
  const start = state.events[0] as Extract<typeof state.events[number], { kind: "reading-start" }>;
  assert.deepEqual([start.startedAt, start.limitSeconds], [T0, doc.limitSeconds]);
  assert.throws(() => startReading(state, doc, T0 + 1), /한 번만/);
  const middle = readingStatus(state, T0 + 10_000);
  assert.deepEqual([middle.phase, "remainingMs" in middle && middle.remainingMs], ["reading", limit - 10_000]);
  assert.equal(syncReading(state, T0 + limit - 1), state, "before the deadline, ticks write nothing");
  assert.equal(readingStatus(state, T0 + limit + 99_999).phase, "ended", "the display follows the clock even before the end event exists");

  // a tab that slept far past the deadline still ends at the deadline, once
  const late = checked(syncReading(state, T0 + limit + 600_000));
  const ends = late.events.filter(event => event.kind === "reading-end");
  assert.equal(ends.length, 1);
  assert.deepEqual(ends[0], { id: ends[0].id, kind: "reading-end", readingId: start.readingId, endedAt: T0 + limit, by: "time", elapsedMs: limit });
  assert.equal(syncReading(late, T0 + limit + 700_000), late);
  assert.equal(endReading(late, T0 + limit + 700_000), late, "ending an ended reading adds nothing");
  assert.deepEqual(readingStatus(late, T0 + limit + 700_000), { phase: "ended", readingId: start.readingId, startedAt: T0, endedAt: T0 + limit, by: "time", readMs: limit });

  // a user end after the deadline is still a time end at the deadline
  const slowClick = checked(endReading(state, T0 + limit + 5));
  assert.deepEqual((slowClick.events[1] as { endedAt: number; by: string }).endedAt, T0 + limit);
  assert.equal((slowClick.events[1] as { by: string }).by, "time");
  const early = checked(endReading(state, T0 + 161_000));
  assert.deepEqual([(early.events[1] as { endedAt: number }).endedAt, (early.events[1] as { by: string }).by], [T0 + 161_000, "user"]);
  assert.equal(readingStatus(early, T0 + 999_999_999).phase, "ended");
  assert.throws(() => endReading(checked(createLessonState(doc)), T0), /시작한 뒤/);

  // restoring after the deadline writes exactly one time end, also on a second restore
  const raw = JSON.stringify(state);
  const restored = checked(restoreLessonState(raw, doc, T0 + limit + 3_600_000));
  assert.equal(restored.events.filter(event => event.kind === "reading-end").length, 1);
  assert.deepEqual(readingStatus(restored, T0 + limit + 3_600_000), { phase: "ended", readingId: start.readingId, startedAt: T0, endedAt: T0 + limit, by: "time", readMs: limit });
  const again = restoreLessonState(JSON.stringify(restored), doc, T0 + limit + 7_200_000);
  assert.deepEqual(again, restored);
  // restoring inside the deadline keeps the remaining time and writes no event
  const inside = restoreLessonState(raw, doc, T0 + 61_000);
  assert.deepEqual(inside.events, state.events);
  assert.equal((readingStatus(inside, T0 + 61_000) as { remainingMs: number }).remainingMs, limit - 61_000);
});

test("a reading keeps its level and the limit that level gave, and its end keeps how it ended and how long it took", async () => {
  const doc = await story();
  assert.ok(doc.kind === "story");
  for (const [level, seconds] of [["relaxed", 270], ["normal", 220], ["fast", 180]] as const) {
    const state = checked(startReading(createLessonState(doc), doc, T0, level));
    const start = state.events[0] as Extract<typeof state.events[number], { kind: "reading-start" }>;
    assert.deepEqual([start.level, start.limitSeconds], [level, seconds]);
    const status = readingStatus(state, T0 + 10_000);
    assert.deepEqual([status.phase, "level" in status && status.level, "elapsedMs" in status && status.elapsedMs, "remainingMs" in status && status.remainingMs], ["reading", level, 10_000, seconds * 1000 - 10_000]);
    const early = (seconds - 8) * 1000;
    const user = checked(endReading(state, T0 + early));
    assert.deepEqual(user.events[1], { id: user.events[1].id, kind: "reading-end", readingId: start.readingId, endedAt: T0 + early, by: "user", elapsedMs: early });
    const time = checked(syncReading(state, T0 + 999_000_000));
    assert.deepEqual(time.events[1], { id: time.events[1].id, kind: "reading-end", readingId: start.readingId, endedAt: T0 + seconds * 1000, by: "time", elapsedMs: seconds * 1000 });
    assert.deepEqual(readingStatus(user, T0 + 999_000_000), { phase: "ended", readingId: start.readingId, startedAt: T0, endedAt: T0 + early, by: "user", readMs: early, level });
  }
  assert.throws(() => startReading(createLessonState(doc), doc, T0, "turbo" as never), /읽기 수준/);
});

test("a record written before levels existed is restored as it is, and the new fields are validated without loosening the old checks", async () => {
  const { doc, state } = await readStory();
  // `readStory` starts without a level: the lesson's own limit, no level, and an end that carries its elapsed time.
  const [start, end] = state.events as unknown as Record<string, unknown>[];
  assert.equal(Object.hasOwn(start, "level"), false);
  const legacyEnd = { ...end }; delete legacyEnd.elapsedMs;
  const variant = (events: unknown[]) => isLessonState({ ...copy(state), events });
  assert.equal(variant([start, legacyEnd]), true, "a v4 record without the new fields stays valid");
  const restored = restoreLessonState(JSON.stringify({ ...copy(state), events: [start, legacyEnd] }), doc, T0 + 999_000_000);
  assert.deepEqual(restored.events, [start, legacyEnd], "restoring writes nothing into an old record");
  assert.deepEqual(readingStatus(restored, T0 + 999_000_000), { phase: "ended", readingId: start.readingId, startedAt: T0, endedAt: T0 + 5000, by: "user", readMs: 5000 });
  // an old record whose deadline passed still ends by time exactly as before (the new end carries elapsedMs, the old one does not need it)
  const oldStart = { ...start, startedAt: T0 };
  const expired = restoreLessonState(JSON.stringify({ ...copy(state), events: [oldStart] }), doc, T0 + 999_000_000);
  assert.equal(expired.events.filter(event => event.kind === "reading-end").length, 1);
  // the new fields
  assert.equal(variant([{ ...start, level: "normal" }, end]), true);
  assert.equal(variant([{ ...start, level: "turbo" }, end]), false, "an unknown level");
  assert.equal(variant([{ ...start, level: undefined }, end]), false, "a level key without a level");
  assert.equal(variant([{ ...start, level: 2 }, end]), false);
  assert.equal(variant([start, { ...end, elapsedMs: 4999 }]), false, "an elapsed time that is not end minus start");
  assert.equal(variant([start, { ...end, elapsedMs: "5000" }]), false);
  assert.equal(variant([start, { ...end, extra: 1 }]), false, "other keys are still refused");
  assert.equal(variant([{ ...start, startedAt: 1.5 }, end]), false, "the old checks are unchanged");
  assert.equal(variant([{ ...start, limitSeconds: 0 }, end]), false);
});

test("a card lesson has no reading and rejects reading events", async () => {
  const { doc, state } = await openCard();
  assert.throws(() => startReading(state, doc, T0), /시간 제한 읽기/);
  const forged = { ...copy(state), events: [{ id: "e1", kind: "reading-start", readingId: "r1", startedAt: T0, limitSeconds: 180 }] };
  assert.equal(isLessonState(forged), false);
});

test("reading events are validated for shape, uniqueness and the deadline", async () => {
  const { state } = await readStory();
  const [start, end] = state.events as unknown as Record<string, unknown>[];
  const variant = (events: unknown[]) => isLessonState({ ...copy(state), events });
  assert.equal(variant([start, end]), true);
  assert.equal(variant([end]), false, "an end without a start");
  assert.equal(variant([start, end, { ...end, id: "e-second-end" }]), false, "a second end event for one reading");
  assert.equal(variant([start, { ...start, id: "e-second-start" }, end]), false, "a second reading");
  assert.equal(variant([start, { ...end, readingId: "other" }]), false);
  assert.equal(variant([start, { ...end, by: "time", endedAt: (end.endedAt as number) }]), false, "a time end must be at the deadline");
  assert.equal(variant([start, { ...end, endedAt: (start.startedAt as number) - 1 }]), false, "an end before the start");
  assert.equal(variant([start, { ...end, endedAt: (start.startedAt as number) + (start.limitSeconds as number) * 1000 + 1 }]), false, "a user end past the deadline");
  assert.equal(variant([start, { ...end, by: "never" }]), false);
  assert.equal(variant([{ ...start, limitSeconds: 0 }, end]), false);
  assert.equal(variant([{ ...start, startedAt: 1.5 }, end]), false);
  assert.equal(variant([{ ...start, extra: 1 }, end]), false);
});

test("a story question needs the reading to end first, both when answering and when asking", async () => {
  const doc = await story();
  assert.ok(doc.kind === "story");
  let state = checked(registerLessonArtifact(createLessonState(doc), doc, doc.questions[0].questionId));
  const id = state.artifacts[0].artifactId;
  assert.equal(lessonAccess(state, doc, state.artifacts[0]), "reading-not-ended");
  assert.throws(() => submitLessonAttempt(state, doc, id, { kind: "choose", choice: 0 }), /읽기를 마친/);
  assert.throws(() => beginLessonTurn(state, doc, id, turn("t1")), /읽기를 마친/);
  assert.throws(() => buildLessonCheckRequest(state, doc, id, "r1"), /읽기를 마친/);
  state = checked(endReading(startReading(state, doc, T0), T0 + 1));
  assert.equal(lessonAccess(state, doc, state.artifacts[0]), "open");
  state = checked(submitLessonAttempt(state, doc, id, { kind: "choose", choice: 0 }));
  // a record that answered before its reading ended is not one this app wrote
  const forged = copy(state);
  forged.events = [forged.events[1], forged.events[0], ...forged.events.slice(2)];
  assert.equal(isLessonState(forged), false);
});

test("a story answer is judged once, keeps its judgement, and cannot be revised", async () => {
  const { doc, state: read } = await readStory();
  assert.ok(doc.kind === "story");
  let state = checked(registerLessonArtifact(read, doc, doc.questions[0].questionId));
  const id = state.artifacts[0].artifactId;
  for (const bad of [{ kind: "choose", choice: 4 }, { kind: "choose", choice: -1 }, { kind: "choose", choice: 1.5 }, { kind: "fill", inputs: ["a"] }, { kind: "choose" }, { kind: "choose", choice: 1, reason: "x" }]) {
    assert.throws(() => submitLessonAttempt(state, doc, id, bad as never), /문항에 맞는 답/);
  }
  assert.throws(() => buildLessonCheckRequest(state, doc, id, "r1"), /판정을 받지 않은 답이 없습니다/);
  assert.throws(() => buildLessonRevealRequest(state, doc, id, "r1"), /첫 답을 낸 카드/);
  const before = state.events.length;
  state = checked(selectLessonQuestion(state, doc, doc.questions[0].questionId));
  assert.equal(state.events.length, before, "selection is not an event");
  state = checked(submitLessonAttempt(state, doc, id, { kind: "choose", choice: 3 }));
  assert.deepEqual(state.events.slice(before).map(event => event.kind), ["initial"]);
  assert.throws(() => submitLessonAttempt(state, doc, id, { kind: "choose", choice: 2 }), /바꾸지 않습니다/);
  const request = buildLessonCheckRequest(state, doc, id, "check-1");
  assert.deepEqual([request.action, request.lessonId, request.questionId, request.artifactId, request.requestId, request.contentVersion], ["check", "green-umbrella", doc.questions[0].questionId, id, "check-1", doc.contentVersion]);
  const response = await respond(request);
  state = checked(acceptLessonCheck(state, request, response));
  const stored = state.artifacts[0].attempts[0];
  assert.deepEqual(stored.attempt, { kind: "choose", choice: 3 });
  assert.deepEqual(stored.check, response);
  assert.equal(stored.check?.contentVersion, doc.contentVersion);
  assert.deepEqual(state.events.slice(before).map(event => event.kind), ["initial", "check"]);
  assert.throws(() => submitLessonAttempt(state, doc, id, { kind: "choose", choice: 0 }), /바꾸지 않습니다/);
  assert.throws(() => buildLessonRevealRequest(state, doc, id, "r2"), /첫 답을 낸 카드/);
});

test("a card revision never replaces the first attempt, and a revision waits for the previous judgement", async () => {
  const { doc, state: opened, id } = await openCard(11); // wonder-0-12: two blanks
  let state = opened;
  const blanks = blanksOf(state.artifacts[0]);
  assert.equal(blanks, 2);
  for (const bad of [{ kind: "fill", inputs: ["only one"] }, { kind: "fill", inputs: ["", ""] }, { kind: "fill", inputs: ["a", "b", "c"] }, { kind: "choose", choice: 0 }, { kind: "fill", inputs: ["a", "x".repeat(101)] }]) {
    assert.throws(() => submitLessonAttempt(state, doc, id, bad as never), /문항에 맞는 답/);
  }
  const first = { kind: "fill" as const, inputs: ["pick", "down"] };
  state = checked(submitLessonAttempt(state, doc, id, first));
  assert.throws(() => submitLessonAttempt(state, doc, id, { kind: "fill", inputs: ["pick", "up"] }), /판정을 받은 뒤/);
  let request = buildLessonCheckRequest(state, doc, id, "req-a");
  const firstResponse = await respond(request);
  assert.deepEqual([firstResponse.kind === "fill" && firstResponse.matches, firstResponse.kind === "fill" && firstResponse.allMatch], [[true, false], false]);
  state = checked(acceptLessonCheck(state, request, firstResponse));
  const firstSnapshot = copy(state.artifacts[0].attempts[0]);
  state = checked(submitLessonAttempt(state, doc, id, { kind: "fill", inputs: ["pick", "up"] }));
  request = buildLessonCheckRequest(state, doc, id, "req-b");
  state = checked(acceptLessonCheck(state, request, await respond(request)));
  assert.deepEqual(state.artifacts[0].attempts[0], firstSnapshot, "the first attempt and its judgement are unchanged");
  assert.deepEqual(state.artifacts[0].attempts.map(item => item.attempt), [first, { kind: "fill", inputs: ["pick", "up"] }]);
  assert.deepEqual(state.artifacts[0].attempts.map(item => item.check?.kind === "fill" && item.check.allMatch), [false, true]);
  assert.deepEqual(state.events.map(event => event.kind), ["initial", "check", "revision", "check"]);
  assert.deepEqual(state.events.filter(event => event.kind === "revision").map(event => (event as { index: number }).index), [1]);
  // the revision limit is the existing six
  for (let index = 0; index < 5; index++) {
    state = checked(submitLessonAttempt(state, doc, id, { kind: "fill", inputs: ["pick", `try${index}`] }));
    request = buildLessonCheckRequest(state, doc, id, `req-r${index}`);
    state = checked(acceptLessonCheck(state, request, await respond(request)));
  }
  assert.equal(state.artifacts[0].attempts.length, 7);
  assert.throws(() => submitLessonAttempt(state, doc, id, { kind: "fill", inputs: ["pick", "up"] }), /더 수정하지 않습니다/);
});

test("a judgement that differs from the request target in any identity is not adopted", async () => {
  const { doc, state: opened, id } = await openCard(11);
  let state = checked(submitLessonAttempt(opened, doc, id, { kind: "fill", inputs: ["pick", "down"] }));
  const request = buildLessonCheckRequest(state, doc, id, "req-1");
  const response = await respond(request);
  const mutations: Partial<LessonCheckResponse>[] = [
    { requestId: "req-2" }, { lessonId: "wonder-unit-1" }, { artifactId: "other-artifact" }, { questionId: "wonder-0-01" }, { contentVersion: "0".repeat(64) },
  ];
  for (const change of mutations) assert.equal(acceptLessonCheck(state, request, { ...response, ...change } as LessonCheckResponse), state, `${Object.keys(change)[0]} differs`);
  assert.equal(acceptLessonCheck(state, request, { ...response, matches: [true], allMatch: true } as LessonCheckResponse), state, "a response that does not fit the attempt");
  assert.equal(acceptLessonCheck(state, request, { ...response, kind: "choose" } as never), state, "a malformed response");
  assert.equal(acceptLessonCheck(state, { ...request, attempt: { kind: "fill", inputs: ["pick", "up"] } }, response), state, "a request for another attempt");
  assert.equal(acceptLessonCheck(state, { ...request, action: "reveal" }, response), state);
  assert.equal(acceptLessonCheck(state, { ...request, lessonId: "wonder-unit-1" }, { ...response, lessonId: "wonder-unit-1" }), state, "another lesson's request");
  // the same response may be sent again after an unknown result, but is adopted once
  state = checked(acceptLessonCheck(state, request, response));
  assert.equal(acceptLessonCheck(state, request, response), state);
  assert.equal(state.events.filter(event => event.kind === "check").length, 1);
});

test("'show the answers' opens only after a first answer, once, and later attempts are marked as made after it", async () => {
  const { doc, state: opened, id } = await openCard(11);
  const blanks = blanksOf(opened.artifacts[0]);
  assert.throws(() => buildLessonRevealRequest(opened, doc, id, "rev-1"), /첫 답을 낸 카드/);
  // a forged request before any first answer is not adopted either
  const forged: LessonCheckRequest = { action: "reveal", lessonId: doc.lessonId, questionId: opened.artifacts[0].question.questionId, contentVersion: doc.contentVersion, artifactId: id, requestId: "rev-1", attempt: { kind: "fill", inputs: ["pick", "up"] } };
  const forgedResponse = await respond(forged);
  assert.equal(forgedResponse.kind, "reveal");
  assert.equal(acceptLessonReveal(opened, forged, forgedResponse), opened, "no first answer, no reveal");
  let state = checked(submitLessonAttempt(opened, doc, id, { kind: "fill", inputs: allBlank(blanks) }));
  const reveal = buildLessonRevealRequest(state, doc, id, "rev-2");
  assert.deepEqual(reveal.attempt, { kind: "fill", inputs: allBlank(blanks) });
  const response = await respond(reveal);
  assert.equal(acceptLessonReveal(state, { ...reveal, requestId: "rev-x" }, response), state, "request id differs");
  assert.equal(acceptLessonReveal(state, reveal, { ...response, artifactId: "x" }), state);
  assert.equal(acceptLessonReveal(state, reveal, { ...response, answers: ["only"] } as LessonCheckResponse), state, "answers must match the blanks");
  state = checked(acceptLessonReveal(state, reveal, response));
  assert.deepEqual(state.artifacts[0].reveal, { response, afterAttempts: 1 });
  assert.equal(acceptLessonReveal(state, reveal, response), state, "answers open once");
  assert.throws(() => buildLessonRevealRequest(state, doc, id, "rev-3"), /이미 답을 봤습니다/);
  const check = buildLessonCheckRequest(state, doc, id, "chk-1");
  state = checked(acceptLessonCheck(state, check, await respond(check)));
  state = checked(submitLessonAttempt(state, doc, id, { kind: "fill", inputs: ["pick", "up"] }));
  const revisionRequest = buildLessonCheckRequest(state, doc, id, "chk-2");
  state = checked(acceptLessonCheck(state, revisionRequest, await respond(revisionRequest)));
  const { attempts, reveal: stored } = state.artifacts[0];
  assert.deepEqual(attempts.map((_, index) => index >= stored!.afterAttempts), [false, true], "only the attempt after the answers carries the mark");
  assert.deepEqual(state.events.map(event => event.kind), ["initial", "reveal", "check", "revision", "check"]);
  // the order of the reveal among the attempts is part of the record
  const swapped = copy(state);
  swapped.artifacts[0].reveal!.afterAttempts = 2;
  assert.equal(isLessonState(swapped), false);
});

test("the record rejects malformed or inconsistent v4 content and never accepts a v3 or scene record", async () => {
  const { doc, state: opened, id } = await openCard(11);
  let state = checked(submitLessonAttempt(opened, doc, id, { kind: "fill", inputs: ["pick", "down"] }));
  const request = buildLessonCheckRequest(state, doc, id, "req-1");
  state = checked(acceptLessonCheck(state, request, await respond(request)));
  const reveal = buildLessonRevealRequest(state, doc, id, "rev-1");
  state = checked(acceptLessonReveal(state, reveal, await respond(reveal)));
  state = checked(selectLessonQuestion(state, doc, state.artifacts[0].question.questionId));
  assert.equal(isLessonState(state), true);
  const bad: [string, (draft: any) => void][] = [
    ["version 3", draft => { draft.version = 3; }],
    ["extra top-level key", draft => { draft.progress = 1; }],
    ["scene lesson", draft => { draft.lessonId = ARTIFACT_LESSON_ID; }],
    ["unknown lesson", draft => { draft.lessonId = "nope"; }],
    ["unknown selected question", draft => { draft.selectedQuestionId = "nope"; }],
    ["question outside the lesson", draft => { draft.artifacts[0].question.questionId = "wonder-1-01"; }],
    ["extra artifact key", draft => { draft.artifacts[0].done = true; }],
    ["wrong inputs length", draft => { draft.artifacts[0].inputs = ["a"]; }],
    ["a choice on a card", draft => { draft.artifacts[0].choice = 1; }],
    ["attempt of the wrong kind", draft => { draft.artifacts[0].attempts[0].attempt = { kind: "choose", choice: 0 }; }],
    ["attempt with empty inputs", draft => { draft.artifacts[0].attempts[0].attempt = { kind: "fill", inputs: ["", ""] }; }],
    ["attempt with a reason", draft => { draft.artifacts[0].attempts[0].attempt.reason = "x"; }],
    ["judgement of another artifact", draft => { draft.artifacts[0].attempts[0].check.artifactId = "other"; }],
    ["judgement of another version", draft => { draft.artifacts[0].attempts[0].check.contentVersion = "0".repeat(64); }],
    ["judgement that does not fit the attempt", draft => { draft.artifacts[0].attempts[0].check.matches = [true]; draft.artifacts[0].attempts[0].check.allMatch = true; }],
    ["a reveal stored as a judgement", draft => { draft.artifacts[0].attempts[0].check = draft.artifacts[0].reveal.response; }],
    ["reveal with a wrong answer count", draft => { draft.artifacts[0].reveal.response.answers = ["x"]; }],
    ["reveal before any attempt", draft => { draft.artifacts[0].reveal.afterAttempts = 0; }],
    ["no initial event", draft => { draft.events = draft.events.filter((event: any) => event.kind !== "initial"); }],
    ["a check event without its judgement", draft => { draft.artifacts[0].attempts[0].check = null; }],
    ["a judgement without its event", draft => { draft.events = draft.events.filter((event: any) => event.kind !== "check"); }],
    ["duplicate event id", draft => { draft.events[1].id = draft.events[0].id; }],
    ["a check event for another request", draft => { draft.events.find((event: any) => event.kind === "check").requestId = "other"; }],
    ["a second reveal event", draft => { draft.events.push({ ...draft.events.find((event: any) => event.kind === "reveal"), id: "again" }); }],
    ["an event of an unknown kind", draft => { draft.events.push({ id: "e-x", kind: "progress", artifactId: draft.artifacts[0].artifactId }); }],
    ["an event of an unknown artifact", draft => { draft.events.push({ id: "e-y", kind: "initial", artifactId: "missing" }); }],
    ["a request event without its turn", draft => { draft.events.push({ id: "e-z", kind: "request", artifactId: draft.artifacts[0].artifactId, threadId: draft.artifacts[0].activeThreadId, turnId: "missing", requestId: "r" }); }],
    ["too many artifacts", draft => { draft.artifacts = Array.from({ length: 30 }, () => draft.artifacts[0]); }],
    ["a thread without its event", draft => { draft.artifacts[0].threads.push({ id: "extra", turns: [] }); }],
  ];
  for (const [label, change] of bad) {
    const draft = copy(state) as any;
    change(draft);
    assert.equal(isLessonState(draft), false, label);
  }
  assert.equal(isLessonState(null), false);
  assert.equal(isLessonState([]), false);
  assert.equal(isLessonState({}), false);
});

test("a corrupt record blocks only its own lesson and is never overwritten by loading", async () => {
  const docs = [await story(), await cards(), await lesson("bus-dog")];
  const storage = new Map<string, string>();
  const read = (key: string) => storage.get(key) ?? null;
  const have = JSON.stringify({ version: 3, anything: "have" });
  storage.set(WORKSPACE_STORAGE_KEYS.v3, have);
  storage.set(DOCUMENT_UI_STORAGE_KEY, "{broken-document");
  storage.set(WORKSPACE_LAYOUT_STORAGE_KEY, "{broken-layout");
  // each lesson saves its own valid record
  for (const doc of docs) {
    let state = createLessonState(doc);
    state = registerLessonArtifact(state, doc, (doc.kind === "story" ? doc.questions : doc.cards)[0].questionId);
    storage.set(lessonStorageKeys(doc.lessonId).record, JSON.stringify(checked(state)));
  }
  const corruptKey = lessonStorageKeys("green-umbrella").record, corrupt = "{not json";
  storage.set(corruptKey, corrupt);
  const loads = docs.map(doc => loadLessonRecord(read, doc, T0));
  assert.deepEqual(loads.map(item => item.ok), [false, true, true]);
  assert.equal(loads[0].ok === false && loads[0].key, corruptKey);
  assert.match((loads[0] as { message: string }).message, /원본을 보존/);
  assert.equal(storage.get(corruptKey), corrupt, "loading leaves the original in place");
  assert.equal(storage.get(WORKSPACE_STORAGE_KEYS.v3), have, "loading a v4 lesson never touches the have record");
  // valid JSON of the wrong shape, and another lesson's record under this key, are corrupt too
  storage.set(corruptKey, JSON.stringify({ version: 4, lessonId: "green-umbrella" }));
  assert.equal(loadLessonRecord(read, docs[0], T0).ok, false);
  storage.set(corruptKey, storage.get(lessonStorageKeys("wonder-unit-0").record)!);
  assert.equal(loadLessonRecord(read, docs[0], T0).ok, false, "a record that belongs to another lesson");
  assert.equal(loadLessonRecord(read, docs[1], T0).ok, true);
  // nothing stored means a fresh record
  storage.delete(corruptKey);
  const fresh = loadLessonRecord(read, docs[0], T0);
  assert.deepEqual(fresh.ok && fresh.state, createLessonState(docs[0]));
});

test("an older content version is kept read-only: it can be read but never judged, revealed or sent to the AI", async () => {
  const { doc, state: opened, id } = await openCard(11);
  let state = checked(submitLessonAttempt(opened, doc, id, { kind: "fill", inputs: ["pick", "down"] }));
  const request = buildLessonCheckRequest(state, doc, id, "req-1");
  state = checked(acceptLessonCheck(state, request, await respond(request)));
  state = checked(beginLessonTurn(state, doc, id, turn("t1")));
  const changed: LessonDocument = { ...copy(doc), contentVersion: "f".repeat(64) };
  const restored = checked(restoreLessonState(JSON.stringify(state), changed, T0));
  assert.equal(restored.artifacts[0].contentVersion, doc.contentVersion, "the old record is preserved, not rewritten to the new version");
  assert.deepEqual(restored.artifacts[0].attempts, state.artifacts[0].attempts);
  assert.equal(lessonAccess(restored, changed, restored.artifacts[0]), "old-version");
  const rid = restored.artifacts[0].artifactId;
  assert.throws(() => submitLessonAttempt(restored, changed, rid, { kind: "fill", inputs: ["pick", "up"] }), /읽기만/);
  assert.throws(() => buildLessonCheckRequest(restored, changed, rid, "r2"), /읽기만/);
  assert.throws(() => buildLessonRevealRequest(restored, changed, rid, "r3"), /읽기만/);
  assert.throws(() => beginLessonTurn(restored, changed, rid, turn("t2")), /읽기만/);
  assert.throws(() => retryLessonTurn(restored, changed, rid, activeThread(restored.artifacts[0]).id, "t1", "x"), /읽기만/);
  assert.equal(projectLessonArtifacts(restored, changed).find(item => item.question.questionId === restored.artifacts[0].question.questionId)!.contentVersion, doc.contentVersion, "the document still shows the saved record for that question");
  // a judgement answering an old-version request is not adopted by a state that already moved on
  const lateRequest: LessonCheckRequest = { ...request, contentVersion: changed.contentVersion };
  assert.equal(acceptLessonCheck(restored, lateRequest, { ...(await respond(request)), contentVersion: changed.contentVersion } as LessonCheckResponse), restored);
  // a record of the current version must still match the current question text
  const tampered = copy(state);
  (tampered.artifacts[0].question as { sense: string }).sense = "changed";
  assert.throws(() => restoreLessonState(JSON.stringify(tampered), doc, T0), /맞지 않습니다/);
});

test("restoring never replays a request: a pending question becomes cancelled and no event is added", async () => {
  const { doc, state: opened, id } = await openCard();
  let state = checked(beginLessonTurn(opened, doc, id, turn("t1")));
  const events = copy(state.events);
  const restored = checked(restoreLessonState(JSON.stringify(state), doc, T0));
  assert.deepEqual(restored.events, events, "restoring adds no request or retry event");
  const restoredTurn = activeThread(restored.artifacts[0]).turns[0];
  assert.deepEqual([restoredTurn.status, restoredTurn.requestId], ["cancelled", "t1-request"]);
  assert.match(restoredTurn.error!, /자동으로 다시 전송하지 않습니다/);
  // a late reply for the cancelled request is not adopted
  const reply: LessonReply = { lessonId: doc.lessonId, artifactId: id, questionId: restored.artifacts[0].question.questionId, contentVersion: doc.contentVersion, requestId: "t1-request", reply: "late", mode: "ai" };
  assert.equal(acceptLessonReply(restored, reply), restored);
  assert.equal(JSON.stringify(restoreLessonState(null, doc, T0)), JSON.stringify(createLessonState(doc)));
  state = restored;
  assert.equal(state.artifacts[0].messageDraft, "");
});

test("a reply is adopted only for the request it answers, including the lesson, and stays with its own question", async () => {
  const { doc, state: opened, id } = await openCard();
  const questions = doc.kind === "cards" ? doc.cards : [];
  let state = registerLessonArtifact(opened, doc, questions[1].questionId);
  state = checked(beginLessonTurn(state, doc, id, turn("t1")));
  const artifact = findArtifact(state, id);
  const reply: LessonReply = { lessonId: doc.lessonId, artifactId: id, questionId: artifact.question.questionId, contentVersion: artifact.contentVersion, requestId: "t1-request", reply: "Mock tutor reply", mode: "ai" };
  state = selectLessonQuestion(state, doc, questions[1].questionId);
  for (const change of [{ lessonId: "wonder-unit-1" }, { artifactId: state.artifacts[1].artifactId }, { questionId: questions[1].questionId }, { contentVersion: "0".repeat(64) }, { requestId: "other" }]) {
    assert.equal(acceptLessonReply(state, { ...reply, ...change }), state, Object.keys(change)[0]);
  }
  const next = checked(acceptLessonReply(state, reply));
  assert.equal(findArtifact(next, id).threads[0].turns[0].status, "complete");
  assert.deepEqual(historyFor(activeThread(findArtifact(next, id))).map(message => message.content), ["Question t1", "Mock tutor reply"]);
  assert.equal(next.selectedQuestionId, questions[1].questionId, "the reply did not move the selection");
  assert.deepEqual(findArtifact(next, state.artifacts[1].artifactId), state.artifacts[1]);
  assert.equal(next.events.at(-1)?.kind, "reply");
  assert.equal(acceptLessonReply(next, reply), next, "adopted once");
});

test("failed turns, retries and new threads use the shared lifecycle on a v4 record", async () => {
  const { doc, state: opened, id } = await openCard();
  let state = checked(beginLessonTurn(opened, doc, id, turn("t1")));
  assert.throws(() => beginLessonTurn(state, doc, id, turn("t2")), /처리 중이거나 실패한/);
  const threadId = activeThread(findArtifact(state, id)).id;
  state = checked(markTurn(state, id, threadId, "t1", "t1-request", "failed", "boom"));
  state = checked(retryLessonTurn(state, doc, id, threadId, "t1", "t1-retry"));
  assert.deepEqual(state.events.map(event => event.kind), ["request", "retry"]);
  state = checked(startThread(state, id));
  assert.equal(findArtifact(state, id).threads.length, 2);
  assert.equal(findArtifact(state, id).threads[0].turns[0].status, "cancelled");
  assert.equal(state.events.at(-1)?.kind, "thread");
});

test("the record states facts only: no completion, mastery or progress field anywhere", async () => {
  const { doc, state: opened, id } = await openCard(11);
  let state = checked(submitLessonAttempt(opened, doc, id, { kind: "fill", inputs: ["pick", "up"] }));
  const request = buildLessonCheckRequest(state, doc, id, "req-1");
  state = checked(acceptLessonCheck(state, request, await respond(request)));
  const keys = new Set<string>();
  JSON.stringify(state, (key, value) => { if (key) keys.add(key); return value; });
  assert.deepEqual([...keys].filter(key => /progress|mastery|master|score|streak|percent|done|finished|completed/i.test(key)), []);
  assert.deepEqual([...keys].filter(key => /complete/i.test(key)), []);
});
