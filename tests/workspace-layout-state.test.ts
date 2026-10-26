import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatRestorePosition, createLayoutState, isLayoutState, restoreLayoutState,
  WORKSPACE_LAYOUT_STORAGE_KEY, type WorkspaceLayoutState,
} from "../lib/workspace-layout-state";
import {
  addReference, createDocumentState, DOCUMENT_UI_STORAGE_KEY,
} from "../lib/document-workspace-state";
import {
  beginTurn, createWorkspace, isWorkspaceState, submitInitial, updateArtifact,
  WORKSPACE_STORAGE_KEYS,
} from "../lib/learning-workspace-state";
import { getPublicLearningCatalog } from "../lib/server/learning-catalog";

function roundTrip(state: WorkspaceLayoutState): WorkspaceLayoutState {
  assert.equal(isLayoutState(state), true);
  const restored = restoreLayoutState(JSON.stringify(state));
  assert.equal(restored.recovered, false);
  assert.deepEqual(restored.state, state);
  return restored.state;
}

test("layout preferences restore an explicit reading policy without manufacturing a saved state", () => {
  assert.deepEqual(restoreLayoutState(null), { state: createLayoutState(), recovered: false });
  const state = roundTrip({ version: 1, outlineCollapsed: true, chatScrollTop: 125.5, chatAtEnd: false });
  assert.equal(state.outlineCollapsed, true);
  assert.equal(chatRestorePosition(state, 2400, 700), 125.5);
  roundTrip({ ...state, outlineCollapsed: false, chatScrollTop: Number.MAX_SAFE_INTEGER });
});

test("malformed or contaminated layout values recover only the default reading preferences", () => {
  const valid = createLayoutState();
  const invalid: unknown[] = [
    null, [], {}, true, 1, "saved", { ...valid, version: 2 },
    { ...valid, outlineCollapsed: "false" }, { ...valid, outlineCollapsed: 0 },
    { ...valid, chatAtEnd: "true" }, { ...valid, chatAtEnd: null },
    { ...valid, chatScrollTop: "120" }, { ...valid, chatScrollTop: null },
    { ...valid, chatScrollTop: -1 }, { ...valid, chatScrollTop: NaN },
    { ...valid, chatScrollTop: Infinity }, { ...valid, chatScrollTop: -Infinity },
    { ...valid, chatScrollTop: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, selectedArtifactId: "unrelated-learning-target" },
    { ...valid, readingAnchor: "unrelated-document-anchor" },
    { version: 1, outlineCollapsed: true, chatAtEnd: true },
    { version: 1, chatScrollTop: 0, chatAtEnd: true },
    { version: 1, outlineCollapsed: false, chatScrollTop: 0 },
  ];
  for (const value of invalid) {
    assert.equal(isLayoutState(value), false);
    assert.deepEqual(restoreLayoutState(JSON.stringify(value)), { state: valid, recovered: true });
  }
  for (const raw of ["", "{", "[]", "undefined", '{"__proto__":{},"version":1,"outlineCollapsed":false,"chatScrollTop":0,"chatAtEnd":true}']) {
    assert.deepEqual(restoreLayoutState(raw), { state: valid, recovered: true });
  }
});

test("an oversized but parseable layout payload recovers instead of retaining unbounded UI storage", () => {
  const raw = " ".repeat(4096) + JSON.stringify(createLayoutState());
  assert.deepEqual(restoreLayoutState(raw), { state: createLayoutState(), recovered: true });
  assert.deepEqual(restoreLayoutState(JSON.stringify({ ...createLayoutState(), extra: "x".repeat(4096) })), { state: createLayoutState(), recovered: true });
});

test("restoration keeps a historical chat position within the currently measurable scroll range", () => {
  const saved = roundTrip({ version: 1, outlineCollapsed: false, chatScrollTop: 1600.5, chatAtEnd: false });
  assert.equal(chatRestorePosition(saved, 3000, 700), 1600.5, "a longer transcript retains the prior reading position");
  assert.equal(chatRestorePosition(saved, 1200, 700), 500, "a shorter transcript clamps to its current end");
  assert.equal(chatRestorePosition(saved, 400, 700), 0, "content smaller than the viewport has no scroll offset");
  assert.equal(chatRestorePosition(saved, 0, 0), 0);
  assert.equal(saved.chatScrollTop, 1600.5, "a geometry clamp does not rewrite the stored preference");
});

test("following the end uses current geometry and invalid measurements always return a safe position", () => {
  const following = roundTrip({ version: 1, outlineCollapsed: true, chatScrollTop: 12, chatAtEnd: true });
  assert.equal(chatRestorePosition(following, 3000, 700), 2300);
  assert.equal(chatRestorePosition(following, 1200, 700), 500);
  assert.equal(chatRestorePosition(following, 400, 700), 0);
  for (const state of [following, { ...following, chatAtEnd: false }]) {
    for (const [height, client] of [[NaN, 700], [1000, NaN], [Infinity, 700], [1000, Infinity], [-1, 700], [1000, -1]]) {
      assert.equal(chatRestorePosition(state, height, client), 0);
    }
  }
});

test("layout recovery cannot change document v1, learning v3, drafts or pending requests and performs no I/O", async (context) => {
  let learning = createWorkspace(await getPublicLearningCatalog());
  const artifactId = learning.selectedArtifactId;
  learning = submitInitial(learning, artifactId, { kind: "choose", choice: 1, reason: "Test-only first reason" });
  learning = updateArtifact(learning, artifactId, artifact => ({ ...artifact, messageDraft: "Unsent question", revisionDraft: "Unsent revision" }));
  learning = beginTurn(learning, artifactId, { id: "unreplayed", requestId: "unreplayed-request", user: "Previously sent request", origin: "question", status: "pending" });
  assert.equal(isWorkspaceState(learning), true);
  const document = addReference(createDocumentState(), "get", learning.events.at(-1)!.id);
  const learningBefore = structuredClone(learning), documentBefore = structuredClone(document);
  const stored = new Map([
    [WORKSPACE_STORAGE_KEYS.v3, JSON.stringify(learning)],
    [DOCUMENT_UI_STORAGE_KEY, JSON.stringify(document)],
    [WORKSPACE_LAYOUT_STORAGE_KEY, "{broken-layout"],
  ]);
  const originalStored = new Map(stored);
  assert.equal(new Set(stored.keys()).size, 3, "each owner has a separate storage key");
  let fetches = 0, storageReads = 0, storageWrites = 0;
  context.mock.method(globalThis, "fetch", async () => { fetches++; throw new Error("No requests are allowed during layout restoration"); });
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem() { storageReads++; return null; },
    setItem() { storageWrites++; },
    removeItem() { storageWrites++; },
  } });
  try {
    const recovered = restoreLayoutState(stored.get(WORKSPACE_LAYOUT_STORAGE_KEY)!);
    assert.equal(recovered.recovered, true);
    roundTrip(recovered.state);
    chatRestorePosition(recovered.state, 2000, 700);
    assert.equal(fetches, 0);
    assert.equal(storageReads, 0);
    assert.equal(storageWrites, 0);
    assert.deepEqual(learning, learningBefore);
    assert.deepEqual(document, documentBefore);
    assert.deepEqual(stored, originalStored);
    assert.equal(learning.artifacts[0].threads[0].turns[0].status, "pending");
    assert.equal(learning.artifacts[0].messageDraft, "Unsent question");
    assert.equal(learning.artifacts[0].revisionDraft, "Unsent revision");
    assert.deepEqual(restoreLayoutState(stored.get(DOCUMENT_UI_STORAGE_KEY)!), { state: createLayoutState(), recovered: true });
    assert.deepEqual(restoreLayoutState(stored.get(WORKSPACE_STORAGE_KEYS.v3)!), { state: createLayoutState(), recovered: true });
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
