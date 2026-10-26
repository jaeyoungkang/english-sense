import { REFERENCE_IDS, type ReferenceId } from "./reference-materials";
import type { WorkspaceEvent } from "./learning-workspace-state";

export const DOCUMENT_UI_STORAGE_KEY = "english-sense-document-ui-v1";
export type DocumentReference = { id: ReferenceId; afterEventId: string | null };
export type DocumentWorkspaceState = { version: 1; references: DocumentReference[]; expandedReferenceId: ReferenceId | null; readingAnchor: string | null };
export type DocumentNode = { kind: "reference"; id: string; reference: DocumentReference; orphaned: boolean } | { kind: "event"; id: string; event: WorkspaceEvent };
export const referenceOutlineId = (id: ReferenceId) => `reference-${id}`;
export const artifactOutlineId = (id: string) => `artifact-${id}`;
export const documentAnchorId = (id: string) => `doc-${id}`;
const isReferenceId = (id: unknown): id is ReferenceId => REFERENCE_IDS.includes(id as ReferenceId);
const exactKeys = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function createDocumentState(): DocumentWorkspaceState { return { version: 1, references: [{ id: "have", afterEventId: null }], expandedReferenceId: "have", readingAnchor: referenceOutlineId("have") }; }
export function isDocumentState(value: unknown): value is DocumentWorkspaceState {
  if (!value || typeof value !== "object") return false;
  const state = value as DocumentWorkspaceState;
  if (!exactKeys(state, ["version", "references", "expandedReferenceId", "readingAnchor"]) || state.version !== 1 || !Array.isArray(state.references) || !state.references.length || state.references.length > REFERENCE_IDS.length || !state.references.every(item => item && typeof item === "object" && exactKeys(item, ["id", "afterEventId"]) && isReferenceId(item.id) && (item.afterEventId === null || (typeof item.afterEventId === "string" && /^[a-zA-Z0-9_-]{1,150}$/.test(item.afterEventId)))) || new Set(state.references.map(item => item.id)).size !== state.references.length || state.references[0].id !== "have" || state.references[0].afterEventId !== null) return false;
  return (state.expandedReferenceId === null || state.references.some(item => item.id === state.expandedReferenceId)) && (state.readingAnchor === null || (typeof state.readingAnchor === "string" && (/^reference-(have|get|be|go)$/.test(state.readingAnchor) || /^artifact-[a-zA-Z0-9_-]{1,150}$/.test(state.readingAnchor))));
}
/** Invalid navigation preferences never invalidate or rewrite learning v3. */
export function restoreDocumentState(raw: string | null): { state: DocumentWorkspaceState; recovered: boolean } {
  if (raw === null) return { state: createDocumentState(), recovered: false };
  try { if (raw.length > 4096) return { state: createDocumentState(), recovered: true }; const state: unknown = JSON.parse(raw); if (isDocumentState(state)) return { state, recovered: false }; } catch { /* Only UI preferences fall back. */ }
  return { state: createDocumentState(), recovered: true };
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
/** Reopening a reference changes neither its insertion anchor nor document order. */
export function buildDocumentNodes(state: DocumentWorkspaceState, events: WorkspaceEvent[]): DocumentNode[] {
  const result: DocumentNode[] = [];
  const add = (reference: DocumentReference, orphaned = false) => result.push({ kind: "reference", id: referenceOutlineId(reference.id), reference, orphaned });
  state.references.filter(item => item.afterEventId === null).forEach(item => add(item));
  for (const event of events) {
    result.push({ kind: "event", id: event.kind === "card" ? artifactOutlineId(event.artifactId) : `event-${event.id}`, event });
    state.references.filter(item => item.afterEventId === event.id).forEach(item => add(item));
  }
  const known = new Set(events.map(event => event.id));
  state.references.filter(item => item.afterEventId !== null && !known.has(item.afterEventId)).forEach(item => add(item, true));
  return result;
}
