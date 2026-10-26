import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addReference, artifactOutlineId, buildDocumentNodes, createDocumentState,
  documentAnchorId, DOCUMENT_UI_STORAGE_KEY, isDocumentState, referenceOutlineId,
  restoreDocumentState, toggleReference, type DocumentWorkspaceState,
} from "../lib/document-workspace-state";
import {
  addNextArtifact, beginTurn, createWorkspace, isWorkspaceState, submitInitial,
  updateArtifact, WORKSPACE_STORAGE_KEYS, type WorkspaceEvent,
} from "../lib/learning-workspace-state";
import { getPublicLearningCatalog } from "../lib/server/learning-catalog";
import type { ReferenceId } from "../lib/reference-materials";

const events: WorkspaceEvent[] = [
  { id: "card-one", kind: "card", artifactId: "quiz-one" },
  { id: "initial-one", kind: "initial", artifactId: "quiz-one" },
  { id: "card-two", kind: "card", artifactId: "quiz-two" },
  { id: "revision-one", kind: "revision", artifactId: "quiz-one", index: 0 },
];
function checked(state: DocumentWorkspaceState): DocumentWorkspaceState {
  assert.equal(isDocumentState(state), true);
  const roundTrip = restoreDocumentState(JSON.stringify(state));
  assert.equal(roundTrip.recovered, false);
  assert.deepEqual(roundTrip.state, state);
  return state;
}
function reject(value: unknown) {
  assert.equal(isDocumentState(value), false);
  assert.deepEqual(restoreDocumentState(JSON.stringify(value)), { state: createDocumentState(), recovered: true });
}

test("document references are real, unique additions and reopening keeps their original insertion", () => {
  let state = checked(createDocumentState());
  state = checked(addReference(state, "get", "initial-one"));
  state = checked(addReference(state, "be", "card-two"));
  state = checked(addReference(state, "go", "card-two"));
  const additions = structuredClone(state.references);
  const originalNodes = buildDocumentNodes(state, events);
  assert.deepEqual(state.references.map(item => item.id), ["have", "get", "be", "go"]);
  assert.equal(state.expandedReferenceId, "go");
  state = checked(addReference(state, "have", "revision-one"));
  assert.equal(state.expandedReferenceId, "have");
  assert.equal(state.readingAnchor, referenceOutlineId("have"));
  assert.deepEqual(state.references, additions, "reopening never becomes a new addition or moves an anchor");
  assert.deepEqual(buildDocumentNodes(state, events), originalNodes);
  state = checked(toggleReference(state, "get"));
  assert.equal(state.expandedReferenceId, "get");
  state = checked(toggleReference(state, "get"));
  assert.equal(state.expandedReferenceId, null, "a collapsed stack has no expanded reference");
  assert.deepEqual(state.references, additions);
  const first = createDocumentState();
  assert.equal(toggleReference(first, "be"), first, "an unadded reference cannot appear by toggling");
  assert.equal(addReference(first, "unknown" as ReferenceId, null), first);
});

test("the document inserts references at their addition anchors without changing learning event order", () => {
  let state = checked(createDocumentState());
  state = checked(addReference(state, "get", "initial-one"));
  state = checked(addReference(state, "be", "card-two"));
  state = checked(addReference(state, "go", "card-two"));
  const before = structuredClone(events);
  const nodes = buildDocumentNodes(state, events);
  assert.deepEqual(nodes.map(node => node.id), [
    referenceOutlineId("have"), artifactOutlineId("quiz-one"), "event-initial-one",
    referenceOutlineId("get"), artifactOutlineId("quiz-two"), referenceOutlineId("be"),
    referenceOutlineId("go"), "event-revision-one",
  ]);
  assert.deepEqual(nodes.filter(node => node.kind === "event").map(node => node.event), before);
  assert.deepEqual(events, before);
  assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length);
  assert.equal(nodes.filter(node => node.kind === "reference").length, state.references.length);
  for (const node of nodes) assert.equal(documentAnchorId(node.id), `doc-${node.id}`);
});

test("a disappeared insertion anchor keeps the reference readable and preserves all learning events", () => {
  let state = checked(addReference(createDocumentState(), "get", "removed-event"));
  state = checked(addReference(state, "be", "initial-one"));
  const before = structuredClone(events), nodes = buildDocumentNodes(state, events);
  const orphan = nodes.find(node => node.kind === "reference" && node.reference.id === "get");
  assert.ok(orphan && orphan.kind === "reference");
  assert.equal(orphan.orphaned, true);
  assert.equal(nodes.at(-1)?.id, referenceOutlineId("get"));
  assert.equal(nodes.filter(node => node.id === referenceOutlineId("get")).length, 1);
  assert.deepEqual(nodes.filter(node => node.kind === "event").map(node => node.event), before);
  assert.deepEqual(events, before);
  assert.deepEqual(state.references.map(item => item.id), ["have", "get", "be"]);
  const empty = buildDocumentNodes(state, []);
  assert.deepEqual(empty.map(node => node.id), [referenceOutlineId("have"), referenceOutlineId("get"), referenceOutlineId("be")]);
});

test("untrusted UI records recover from malformed, duplicate, unknown and impossible navigation values", () => {
  const initial = createDocumentState();
  for (const bad of [
    null, [], {}, { ...initial, version: 2 }, { ...initial, references: [] },
    { ...initial, references: [{ id: "get", afterEventId: null }] },
    { ...initial, references: [{ id: "have", afterEventId: "card-one" }] },
    { ...initial, references: [...initial.references, { id: "have", afterEventId: null }] },
    { ...initial, references: [...initial.references, { id: "come", afterEventId: null }] },
    { ...initial, references: [...initial.references, { id: "get", afterEventId: [] }] },
    { ...initial, expandedReferenceId: "get" }, { ...initial, expandedReferenceId: {} },
    { ...initial, readingAnchor: [] }, { ...initial, readingAnchor: "javascript:alert(1)" },
    { ...initial, readingAnchor: "reference-come" },
    { ...initial, references: [...initial.references, { id: "get", afterEventId: "" }] },
    { ...initial, references: [...initial.references, { id: "get", afterEventId: "event with spaces" }] },
    { ...initial, extra: "unrecognized UI field" },
    { ...initial, references: [{ id: "have", afterEventId: null, extra: "unrecognized reference field" }] },
  ]) reject(bad);
  for (const raw of ["", "{", "null", "[]", "true"]) {
    assert.deepEqual(restoreDocumentState(raw), { state: createDocumentState(), recovered: true });
  }
  assert.deepEqual(restoreDocumentState(null), { state: initial, recovered: false });
});

test("oversized UI preferences recover rather than retaining an unbounded storage payload", () => {
  const raw = " ".repeat(128 * 1024) + JSON.stringify(createDocumentState());
  assert.deepEqual(restoreDocumentState(raw), { state: createDocumentState(), recovered: true });
  reject({ ...createDocumentState(), references: [{ id: "have", afterEventId: null }, { id: "get", afterEventId: "x".repeat(2000) }] });
  reject({ ...createDocumentState(), readingAnchor: "x".repeat(2000) });
});

test("reading preferences and reference changes cannot change the learning target, drafts or stored v3", async () => {
  const catalog = await getPublicLearningCatalog();
  let learning = createWorkspace(catalog);
  const first = learning.selectedArtifactId;
  learning = submitInitial(learning, first, { kind: "choose", choice: 1, reason: "Independent target" });
  learning = addNextArtifact(learning, catalog);
  const target = learning.selectedArtifactId;
  learning = updateArtifact(learning, target, artifact => ({ ...artifact, messageDraft: "Unsent target question", revisionDraft: "Unsent target revision" }));
  learning = beginTurn(learning, first, { id: "delayed", requestId: "delayed-request", user: "Earlier card question", origin: "question", status: "pending" });
  assert.equal(isWorkspaceState(learning), true);
  const rawV3 = JSON.stringify(learning), before = structuredClone(learning);
  let document = checked(addReference(createDocumentState(), "get", learning.events.at(-1)!.id));
  document = checked({ ...document, readingAnchor: artifactOutlineId(first) });
  checked(toggleReference(document, "have"));
  buildDocumentNodes(document, learning.events);
  restoreDocumentState("{invalid-ui");
  assert.notEqual(DOCUMENT_UI_STORAGE_KEY, WORKSPACE_STORAGE_KEYS.v3);
  assert.deepEqual(learning, before);
  assert.equal(JSON.stringify(learning), rawV3);
  assert.equal(learning.selectedArtifactId, target);
  assert.equal(learning.artifacts[1].messageDraft, "Unsent target question");
  assert.equal(learning.artifacts[1].revisionDraft, "Unsent target revision");
  assert.equal(learning.artifacts[0].threads[0].turns[0].status, "pending");
});
