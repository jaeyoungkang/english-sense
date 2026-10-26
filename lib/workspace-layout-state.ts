/** Reading preferences only. This module never reads or writes learning/document records. */
export const WORKSPACE_LAYOUT_STORAGE_KEY = "english-sense-workspace-layout-v1";
export type WorkspaceLayoutState = { version: 1; outlineCollapsed: boolean; chatScrollTop: number; chatAtEnd: boolean };
export function createLayoutState(): WorkspaceLayoutState { return { version: 1, outlineCollapsed: false, chatScrollTop: 0, chatAtEnd: true }; }
export function isLayoutState(value: unknown): value is WorkspaceLayoutState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as WorkspaceLayoutState;
  return Object.keys(state).length === 4 && ["version", "outlineCollapsed", "chatScrollTop", "chatAtEnd"].every(key => Object.hasOwn(state, key)) && state.version === 1 && typeof state.outlineCollapsed === "boolean" && typeof state.chatAtEnd === "boolean" && typeof state.chatScrollTop === "number" && Number.isFinite(state.chatScrollTop) && state.chatScrollTop >= 0 && state.chatScrollTop <= Number.MAX_SAFE_INTEGER;
}
export function restoreLayoutState(raw: string | null): { state: WorkspaceLayoutState; recovered: boolean } {
  if (raw === null) return { state: createLayoutState(), recovered: false };
  try { if (raw.length <= 1024) { const state: unknown = JSON.parse(raw); if (isLayoutState(state)) return { state, recovered: false }; } } catch { /* Invalid layout preferences do not invalidate learning. */ }
  return { state: createLayoutState(), recovered: true };
}
export function chatRestorePosition(state: WorkspaceLayoutState, scrollHeight: number, clientHeight: number): number {
  const valid = Number.isFinite(scrollHeight) && Number.isFinite(clientHeight) && scrollHeight >= 0 && clientHeight >= 0;
  const maximum = valid ? Math.max(0, scrollHeight - clientHeight) : 0;
  return state.chatAtEnd ? maximum : Math.min(maximum, Math.max(0, state.chatScrollTop));
}
