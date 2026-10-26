import assert from "node:assert/strict";
import { test } from "node:test";
import { getPublicLearningCatalog } from "../lib/server/learning-catalog";
import { LEGACY_HAVE_CONTENT_VERSION, type PublicLearningCatalog } from "../lib/learning-catalog";
import type { ArtifactLearningChatResponse } from "../lib/learning-chat-contract";
import {
  acceptReply, activeThread, addNextArtifact, addRevision, beginTurn, createWorkspace,
  findArtifact, historyFor, isWorkspaceState, markTurn, restoreWorkspace, retryTurn,
  selectArtifact, startThread, submitInitial, updateArtifact, WORKSPACE_STORAGE_KEYS,
  type QuizArtifact, type WorkspaceState, type WorkspaceTurn,
} from "../lib/learning-workspace-state";

const catalogPromise = getPublicLearningCatalog();
const copy = <T>(value: T): T => structuredClone(value);
function checked(state: WorkspaceState): WorkspaceState {
  assert.equal(isWorkspaceState(state), true, "every persisted transition must satisfy the state contract");
  const restored: unknown = JSON.parse(JSON.stringify(state));
  assert.equal(isWorkspaceState(restored), true, "JSON round trips retain every required reference");
  assert.equal(JSON.stringify(restored), JSON.stringify(state), "serialization keeps the persisted representation stable");
  return state;
}
function turn(id: string, requestId = `${id}-request`): WorkspaceTurn {
  return { id, requestId, user: `Question ${id}`, origin: "question", status: "pending" };
}
function reply(artifact: QuizArtifact, requestId: string, change: Partial<ArtifactLearningChatResponse> = {}): ArtifactLearningChatResponse {
  return { artifactId: artifact.artifactId, questionId: artifact.question.questionId, contentVersion: artifact.contentVersion, requestId, reply: "Mock tutor reply", mode: "ai", ...change };
}
function answer(state: WorkspaceState, id = state.selectedArtifactId): WorkspaceState {
  const artifact = findArtifact(state, id);
  return checked(submitInitial(state, id, artifact.question.type === "choose"
    ? { kind: "choose", choice: 1, reason: "Test reasoning" }
    : { kind: "produce", text: "A test learner sentence." }));
}
function restore(state: WorkspaceState, catalog: PublicLearningCatalog): WorkspaceState {
  return checked(restoreWorkspace({ v3: JSON.stringify(state), v2: null, v1: null }, catalog));
}

test("cards keep independent drafts and target while actual cross-card events remain ordered", async () => {
  const catalog = await catalogPromise;
  let state = checked(createWorkspace(catalog));
  const first = state.selectedArtifactId;
  state = checked(updateArtifact(state, first, item => ({ ...item, choice: "1", reason: "First draft", messageDraft: "Unsent first question", revisionDraft: "Unsent first revision" })));
  state = answer(state);
  state = checked(addNextArtifact(state, catalog));
  const second = state.selectedArtifactId;
  state = checked(updateArtifact(state, second, item => ({ ...item, messageDraft: "Unsent second question", reason: "Second draft" })));
  state = answer(state);
  state = checked(selectArtifact(state, first));
  state = checked(addRevision(state, first, "A later revision of the first card"));
  const pending = turn("cross-card");
  state = checked(beginTurn(state, first, pending));
  state = checked(selectArtifact(state, second));
  state = checked(acceptReply(state, reply(findArtifact(state, first), pending.requestId)));
  assert.equal(state.selectedArtifactId, second);
  assert.equal(findArtifact(state, first).messageDraft, "Unsent first question");
  assert.equal(findArtifact(state, second).messageDraft, "Unsent second question");
  assert.equal(findArtifact(state, second).reason, "Second draft");
  assert.deepEqual(state.events.map(event => [event.artifactId, event.kind]), [
    [first, "card"], [first, "initial"], [second, "card"], [second, "initial"],
    [first, "revision"], [first, "request"], [first, "reply"],
  ]);
  assert.deepEqual(findArtifact(state, second).revisions, []);
  assert.equal(activeThread(findArtifact(state, second)).turns.length, 0);
});

test("initial answers are immutable and snapshots do not follow later catalog mutation", async () => {
  const catalog = copy(await catalogPromise);
  let state = checked(createWorkspace(catalog));
  const first = state.artifacts[0], snapshot = copy(first.question), source = copy(first.source);
  catalog.questions[0].scene = "Changed current material";
  catalog.questions[0].opts![0].t = "Changed option";
  catalog.source.title = "Changed title";
  assert.deepEqual(first.question, snapshot);
  assert.deepEqual(first.source, source);
  state = answer(state);
  const initial = copy(findArtifact(state, first.artifactId).initialAttempt);
  assert.throws(() => submitInitial(state, first.artifactId, { kind: "choose", choice: 2, reason: "Overwrite" }));
  state = checked(addRevision(state, first.artifactId, "A separate revision"));
  assert.deepEqual(findArtifact(state, first.artifactId).initialAttempt, initial);
  assert.deepEqual(state.artifacts[0].question, snapshot);
});

test("all seven cards support their real choose or produce input without changing earlier work", async () => {
  const catalog = await catalogPromise;
  let state = checked(createWorkspace(catalog));
  const originals: unknown[] = [];
  let produceCount = 0;
  for (let index = 0; index < catalog.questions.length; index++) {
    const artifact = findArtifact(state, state.selectedArtifactId);
    if (artifact.question.type === "produce") {
      produceCount++;
      assert.throws(() => submitInitial(state, artifact.artifactId, { kind: "choose", choice: 0, reason: "Wrong input kind" }));
      assert.throws(() => submitInitial(state, artifact.artifactId, { kind: "produce", text: " " }));
    } else {
      assert.throws(() => submitInitial(state, artifact.artifactId, { kind: "produce", text: "Wrong input kind" }));
    }
    state = answer(state);
    originals.push(copy(findArtifact(state, artifact.artifactId).initialAttempt));
    state = checked(addNextArtifact(state, catalog));
  }
  assert.equal(produceCount, 2);
  assert.equal(state.artifacts.length, 7);
  assert.deepEqual(state.artifacts.map(item => item.initialAttempt), originals);
  assert.equal(state.events.filter(event => event.kind === "card").length, 7);
  const fresh = createWorkspace(catalog);
  assert.throws(() => addNextArtifact(fresh, catalog));
  assert.throws(() => selectArtifact(state, "missing-card"));
});

test("replies require all four request identities and never follow the current selection", async () => {
  const catalog = await catalogPromise;
  let state = answer(checked(createWorkspace(catalog)));
  const first = state.selectedArtifactId, pending = turn("four-identities");
  state = checked(beginTurn(state, first, pending));
  state = checked(addNextArtifact(state, catalog));
  const second = state.selectedArtifactId, artifact = findArtifact(state, first);
  for (const change of [
    { artifactId: "unknown-card" }, { questionId: catalog.questions[1].questionId },
    { contentVersion: "f".repeat(64) }, { requestId: "unknown-request" },
  ]) assert.equal(acceptReply(state, reply(artifact, pending.requestId, change)), state);
  state = checked(acceptReply(state, reply(artifact, pending.requestId)));
  assert.equal(state.selectedArtifactId, second);
  assert.equal(activeThread(findArtifact(state, first)).turns[0].status, "complete");
  assert.equal(activeThread(findArtifact(state, second)).turns.length, 0);
  assert.equal(acceptReply(state, reply(artifact, pending.requestId)), state, "duplicate responses do not add events");
});

test("cancel, failed retry and thread replacement reject old responses and preserve a single user turn", async () => {
  let state = answer(checked(createWorkspace(await catalogPromise)));
  const id = state.selectedArtifactId, original = turn("retryable"), threadId = activeThread(findArtifact(state, id)).id;
  state = checked(beginTurn(state, id, original));
  state = checked(markTurn(state, id, threadId, original.id, original.requestId, "cancelled", "Stopped"));
  assert.equal(acceptReply(state, reply(findArtifact(state, id), original.requestId)), state);
  const failed = turn("failed-request");
  state = checked(beginTurn(state, id, failed));
  state = checked(markTurn(state, id, threadId, failed.id, failed.requestId, "failed", "Network failed"));
  state = checked(retryTurn(state, id, threadId, failed.id, "new-request"));
  assert.equal(acceptReply(state, reply(findArtifact(state, id), failed.requestId)), state);
  state = checked(acceptReply(state, reply(findArtifact(state, id), "new-request")));
  assert.equal(activeThread(findArtifact(state, id)).turns.filter(item => item.id === failed.id).length, 1);
  assert.deepEqual(historyFor(activeThread(findArtifact(state, id))), [
    { role: "user", content: failed.user }, { role: "assistant", content: "Mock tutor reply" },
  ]);
  assert.deepEqual(state.events.map(event => event.kind), ["card", "initial", "request", "request", "retry", "reply"]);
});

test("a new thread retains its prior draft and pending request while leaving other cards untouched", async () => {
  const catalog = await catalogPromise;
  let state = answer(checked(createWorkspace(catalog)));
  const first = state.selectedArtifactId;
  state = checked(addNextArtifact(state, catalog));
  const second = state.selectedArtifactId, other = copy(findArtifact(state, second));
  const pending = turn("archived-pending");
  state = checked(updateArtifact(state, first, artifact => ({ ...artifact, messageDraft: "Not sent yet" })));
  state = checked(beginTurn(state, first, pending));
  state = checked(startThread(state, first));
  const artifact = findArtifact(state, first);
  assert.equal(artifact.threads.length, 2);
  assert.equal(artifact.threads[0].draft, "Not sent yet");
  assert.equal(artifact.threads[0].turns[0].status, "cancelled");
  assert.equal(artifact.messageDraft, "");
  assert.deepEqual(activeThread(artifact).turns, []);
  assert.deepEqual(findArtifact(state, second), other);
  assert.equal(state.selectedArtifactId, second);
  assert.equal(acceptReply(state, reply(artifact, pending.requestId)), state);
});

test("pending restoration is cancelled without replay and historical snapshots survive a new content version", async () => {
  const catalog = await catalogPromise;
  let state = answer(checked(createWorkspace(catalog)));
  const id = state.selectedArtifactId, pending = turn("reload-pending");
  state = checked(beginTurn(state, id, pending));
  const newCatalog = { ...copy(catalog), contentVersion: "f".repeat(64) };
  newCatalog.questions[0].scene = "New revision of scene";
  const restored = restore(state, newCatalog), artifact = findArtifact(restored, id);
  assert.equal(activeThread(artifact).turns[0].status, "cancelled");
  assert.deepEqual(restored.events, state.events, "restoration does not create a request or reply");
  assert.deepEqual(artifact.question, state.artifacts[0].question);
  assert.equal(artifact.contentVersion, catalog.contentVersion);
  assert.equal(acceptReply(restored, reply(artifact, pending.requestId)), restored);
  assert.throws(() => addNextArtifact(restored, newCatalog));
});

test("a current-version snapshot must match its catalog while a historical snapshot remains readable", async () => {
  const catalog = await catalogPromise;
  const altered = answer(checked(createWorkspace(catalog)));
  altered.artifacts[0].question.ask = "A changed question with the unchanged current content hash";
  const raw = JSON.stringify(altered), originalBytes = raw;
  assert.throws(() => restoreWorkspace({ v3: raw, v2: null, v1: null }, catalog));
  assert.equal(raw, originalBytes, "rejected snapshots remain available in the original raw record");
  assert.deepEqual(JSON.parse(raw), altered, "the rejected raw payload is neither repaired nor reassigned");
  const historical = copy(altered);
  historical.artifacts[0].contentVersion = "f".repeat(64);
  const restored = restore(historical, catalog);
  assert.equal(restored.artifacts[0].question.ask, historical.artifacts[0].question.ask);
  assert.equal(restored.artifacts[0].contentVersion, "f".repeat(64));
});

function legacy(version: 1 | 2) {
  const current = { ...turn("legacy-current"), status: "complete" as const, reply: "Earlier reply", mode: "ai" as const };
  const archived = { ...turn("legacy-archive"), status: "complete" as const, reply: "Archived reply", mode: "ai" as const };
  const base = {
    version, lessonId: "titanic-have-1", choice: "1", reason: "Original draft",
    initialAttempt: { choice: 1, reason: "Original first reason" }, revisions: [{ text: "Original revision" }],
    revisionDraft: "Unsent revision", messageDraft: "Unsent question", turns: [current],
    archives: [{ id: "old-archive", turns: [archived], draft: "Old unsent draft", ...(version === 2 ? { events: [
      { id: "archive-request", kind: "request", turnId: archived.id, requestId: archived.requestId },
      { id: "archive-reply", kind: "reply", turnId: archived.id, requestId: archived.requestId },
    ] } : {}) }],
  };
  const result: typeof base & { pane?: string; revisionOpen?: boolean; events?: { id: string; kind: string; turnId?: string; requestId?: string; index?: number }[] } = { ...base };
  if (version === 1) result.pane = "chat";
  else { result.revisionOpen = true; result.events = [
    { id: "first", kind: "initial" },
    { id: "request", kind: "request", turnId: current.id, requestId: current.requestId },
    { id: "revision", kind: "revision", index: 0 },
    { id: "reply", kind: "reply", turnId: current.id, requestId: current.requestId },
  ]; }
  return result;
}

test("v1 and v2 migrations preserve original records and use one explicitly legacy event", async () => {
  const catalog = await catalogPromise;
  assert.equal(catalog.contentVersion, LEGACY_HAVE_CONTENT_VERSION);
  assert.equal(new Set(Object.values(WORKSPACE_STORAGE_KEYS)).size, 3);
  for (const version of [1, 2] as const) {
    const original = legacy(version), raw = JSON.stringify(original), before = copy(original);
    const state = checked(restoreWorkspace({ v3: null, v2: version === 2 ? raw : null, v1: version === 1 ? raw : null }, catalog));
    assert.deepEqual(original, before);
    assert.deepEqual(JSON.parse(raw), before);
    const artifact = state.artifacts[0];
    assert.deepEqual(artifact.legacyImport?.record, before, "the source keeps v1 unknown order or v2 known events");
    assert.equal(artifact.legacyImport?.version, version);
    assert.deepEqual(state.events.map(event => event.kind), ["card", "legacy"], "migration does not invent cross-type chronology");
    assert.deepEqual(artifact.initialAttempt, { kind: "choose", ...before.initialAttempt });
    assert.deepEqual(artifact.revisions, before.revisions);
    assert.equal(artifact.threads[0].draft, "Old unsent draft");
    assert.equal(activeThread(artifact).turns[0].reply, "Earlier reply");
    assert.equal(artifact.messageDraft, "Unsent question");
    checked(startThread(state, artifact.artifactId));
    assert.deepEqual(restore(state, catalog).artifacts[0].legacyImport?.record, before);
  }
});

test("legacy migration refuses unknown material versions and malformed archived event coverage", async () => {
  const catalog = await catalogPromise;
  for (const version of [1, 2] as const) {
    const raw = JSON.stringify(legacy(version));
    assert.throws(() => restoreWorkspace({ v3: null, v2: version === 2 ? raw : null, v1: version === 1 ? raw : null }, { ...catalog, contentVersion: "f".repeat(64) }));
  }
  const corrupt = legacy(2);
  corrupt.archives[0].events = [];
  assert.throws(() => restoreWorkspace({ v3: null, v2: JSON.stringify(corrupt), v1: null }, catalog));
  const missingReply = legacy(2);
  missingReply.events = missingReply.events!.filter(event => event.kind !== "reply");
  assert.throws(() => restoreWorkspace({ v3: null, v2: JSON.stringify(missingReply), v1: null }, catalog));
});

test("v3 corruption fails closed for current and archived threads instead of hiding lost content", async () => {
  const catalog = await catalogPromise;
  let complete = answer(checked(createWorkspace(catalog)));
  const id = complete.selectedArtifactId, pending = turn("coverage");
  complete = checked(beginTurn(complete, id, pending));
  complete = checked(acceptReply(complete, reply(findArtifact(complete, id), pending.requestId)));
  const archived = checked(startThread(complete, id));
  const corruptions: WorkspaceState[] = [];
  for (const kind of ["card", "initial", "request", "reply"] as const) {
    const changed = copy(complete); changed.events = changed.events.filter(event => event.kind !== kind); corruptions.push(changed);
  }
  const hiddenArchive = copy(archived); hiddenArchive.events = hiddenArchive.events.filter(event => event.kind !== "reply"); corruptions.push(hiddenArchive);
  const duplicate = copy(complete); duplicate.events.push(copy(duplicate.events[0])); corruptions.push(duplicate);
  const wrongTarget = copy(complete); wrongTarget.selectedArtifactId = "unknown"; corruptions.push(wrongTarget);
  const dangling = copy(complete); dangling.events[0].artifactId = "unknown"; corruptions.push(dangling);
  const answerInSnapshot = copy(complete); Object.assign(answerInSnapshot.artifacts[0].question, { feel: "Not a public snapshot" }); corruptions.push(answerInSnapshot);
  for (const bad of corruptions) {
    assert.equal(isWorkspaceState(bad), false);
    assert.throws(() => restoreWorkspace({ v3: JSON.stringify(bad), v2: JSON.stringify(legacy(2)), v1: null }, catalog), "bad v3 never silently falls back to an older record");
  }
});
