import { REFERENCE_IDS, type ReferenceId } from "./reference-materials";
import type { QuizArtifact, WorkspaceEvent } from "./learning-workspace-state";

export const DOCUMENT_UI_STORAGE_KEY = "english-sense-document-ui-v1";
export type DocumentReference = { id: ReferenceId; afterEventId: string | null };
export type DocumentWorkspaceState = { version: 1; references: DocumentReference[]; expandedReferenceId: ReferenceId | null; readingAnchor: string | null };
export type DocumentNode = { kind: "reference"; id: string; reference: DocumentReference; orphaned: boolean } | { kind: "artifact"; id: string; artifact: QuizArtifact };
export const referenceOutlineId = (id: ReferenceId) => `reference-${id}`;
export const artifactOutlineId = (id: string) => `artifact-${id}`;
export const documentAnchorId = (id: string) => `doc-${id}`;
const isReferenceId = (id: unknown): id is ReferenceId => REFERENCE_IDS.includes(id as ReferenceId);
const exactKeys = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
/**
 * Lessons other than `titanic-have` have no reference stack ("plain"): `references` stays empty and nothing is expanded.
 * The default ("references") is the have document and keeps the original shape and validation.
 */
export type DocumentMode = "references" | "plain";
const PLAIN_ANCHOR = /^[a-zA-Z0-9_-]{1,160}$/;
export function createDocumentState(mode: DocumentMode = "references"): DocumentWorkspaceState {
  if (mode === "plain") return { version: 1, references: [], expandedReferenceId: null, readingAnchor: null };
  return { version: 1, references: [{ id: "have", afterEventId: null }], expandedReferenceId: "have", readingAnchor: referenceOutlineId("have") };
}
export function isDocumentState(value: unknown, mode: DocumentMode = "references"): value is DocumentWorkspaceState {
  if (!value || typeof value !== "object") return false;
  const state = value as DocumentWorkspaceState;
  if (mode === "plain") return exactKeys(state, ["version", "references", "expandedReferenceId", "readingAnchor"]) && state.version === 1 && Array.isArray(state.references) && state.references.length === 0 && state.expandedReferenceId === null && (state.readingAnchor === null || (typeof state.readingAnchor === "string" && PLAIN_ANCHOR.test(state.readingAnchor)));
  if (!exactKeys(state, ["version", "references", "expandedReferenceId", "readingAnchor"]) || state.version !== 1 || !Array.isArray(state.references) || !state.references.length || state.references.length > REFERENCE_IDS.length || !state.references.every(item => item && typeof item === "object" && exactKeys(item, ["id", "afterEventId"]) && isReferenceId(item.id) && (item.afterEventId === null || (typeof item.afterEventId === "string" && /^[a-zA-Z0-9_-]{1,150}$/.test(item.afterEventId)))) || new Set(state.references.map(item => item.id)).size !== state.references.length || state.references[0].id !== "have" || state.references[0].afterEventId !== null) return false;
  return (state.expandedReferenceId === null || state.references.some(item => item.id === state.expandedReferenceId)) && (state.readingAnchor === null || (typeof state.readingAnchor === "string" && (/^reference-(have|get|be|go|come)$/.test(state.readingAnchor) || /^artifact-[a-zA-Z0-9_-]{1,150}$/.test(state.readingAnchor))));
}
/** Invalid navigation preferences never invalidate or rewrite learning v3. */
export function restoreDocumentState(raw: string | null, mode: DocumentMode = "references"): { state: DocumentWorkspaceState; recovered: boolean } {
  if (raw === null) return { state: createDocumentState(mode), recovered: false };
  try { if (raw.length > 4096) return { state: createDocumentState(mode), recovered: true }; const state: unknown = JSON.parse(raw); if (isDocumentState(state, mode)) return { state, recovered: false }; } catch { /* Only UI preferences fall back. */ }
  return { state: createDocumentState(mode), recovered: true };
}
export function addReference(state: DocumentWorkspaceState, id: ReferenceId, afterEventId: string | null): DocumentWorkspaceState {
  if (!isReferenceId(id)) return state;
  if (state.references.some(item => item.id === id)) return { ...state, expandedReferenceId: id, readingAnchor: referenceOutlineId(id) };
  return { ...state, references: [...state.references, { id, afterEventId }], expandedReferenceId: id, readingAnchor: referenceOutlineId(id) };
}
export function toggleReference(state: DocumentWorkspaceState, id: ReferenceId): DocumentWorkspaceState {
  if (!state.references.some(item => item.id === id)) return state;
  return { ...state, expandedReferenceId: state.expandedReferenceId === id ? null : id };
}
/** Catalog order is independent of learning chronology; existing reference anchors keep their reading position. */
export function buildDocumentNodes(state: DocumentWorkspaceState, events: WorkspaceEvent[], artifacts: QuizArtifact[]): DocumentNode[] {
  const result: DocumentNode[] = [];
  const add = (reference: DocumentReference, orphaned = false) => result.push({ kind: "reference", id: referenceOutlineId(reference.id), reference, orphaned });
  const positions = new Map<string, string | null>();
  let lastCard: string | null = null;
  for (const event of events) {
    if (event.kind === "card") lastCard = event.artifactId;
    positions.set(event.id, lastCard);
  }
  const position = (reference: DocumentReference) => reference.afterEventId === null ? null : positions.get(reference.afterEventId);
  state.references.filter(reference => position(reference) === null).forEach(reference => add(reference));
  for (const artifact of artifacts) {
    result.push({ kind: "artifact", id: artifactOutlineId(artifact.artifactId), artifact });
    state.references.filter(reference => position(reference) === artifact.artifactId).forEach(reference => add(reference));
  }
  const ids = new Set(artifacts.map(artifact => artifact.artifactId));
  state.references.filter(reference => { const target = position(reference); return target === undefined || (target !== null && !ids.has(target)); }).forEach(reference => add(reference, true));
  return result;
}
