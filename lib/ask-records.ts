import { askFollowupLimits, askId, isExplanation, type AskMessage, type AskMode, type Explanation } from "./ask-contract";

/** Storage-neutral facts. Samples, browsing and selection are never requests. */
export type AskStatus = "pending" | "succeeded" | "failed" | "unknown";
export type AskTurn = {
  id: string; message: string; createdAt: string; status: AskStatus;
  reply?: string; error?: string; finishedAt?: string; retryOf?: string;
};
export type AskEntry = {
  id: string; mode: AskMode; text: string; createdAt: string; status: AskStatus;
  result?: Explanation; error?: string; finishedAt?: string; retryOf?: string;
  followupDraft: string; turns: AskTurn[];
};
export type AskRecords = { schema: 1; composer: { mode: AskMode; text: string }; selectedId: string | null; entries: AskEntry[] };

const own = (value: object, key: string) => Object.hasOwn(value, key);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const mode = (value: unknown): value is AskMode => value === "explain" || value === "translate";
const size = (value: string) => [...value].length;
const text = (value: unknown, limit: number, empty = false): value is string => typeof value === "string" && size(value) <= limit && (empty || !!value.trim());
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
function requireValue(condition: unknown): asserts condition { if (!condition) throw new Error("문장 해설 기록의 형식이나 크기가 맞지 않습니다. 원본을 보존하십시오."); }
function shape(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  requireValue(object(value) && required.every(key => own(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)));
}
function iso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
function result(value: unknown): asserts value is Explanation {
  requireValue(isExplanation(value) && bytes(JSON.stringify(value)) <= askFollowupLimits.explanationBytes);
}
function terminalFields(item: Record<string, unknown>, answer: "result" | "reply") {
  requireValue(["pending", "succeeded", "failed", "unknown"].includes(item.status as string));
  if (item.status === "succeeded") {
    requireValue(own(item, answer) && !own(item, "error") && iso(item.finishedAt));
    if (answer === "result") result(item.result);
    else requireValue(text(item.reply, askFollowupLimits.reply));
  } else if (item.status === "failed") {
    requireValue(!own(item, answer) && text(item.error, askFollowupLimits.reply) && iso(item.finishedAt));
  } else requireValue(!own(item, answer) && !own(item, "error") && !own(item, "finishedAt"));
  if (own(item, "finishedAt")) requireValue((item.finishedAt as string) >= (item.createdAt as string));
}
function identity(item: Record<string, unknown>, ids: Set<string>) {
  requireValue(askId(item.id) && !ids.has(item.id) && iso(item.createdAt));
  ids.add(item.id);
  if (own(item, "retryOf")) requireValue(askId(item.retryOf));
}
function validateEntry(value: unknown, ids: Set<string>, previous: AskEntry[]): asserts value is AskEntry {
  shape(value, ["id", "mode", "text", "createdAt", "status", "followupDraft", "turns"], ["result", "error", "finishedAt", "retryOf"]);
  identity(value, ids);
  requireValue(mode(value.mode) && text(value.text, 300) && text(value.followupDraft, askFollowupLimits.message, true) && Array.isArray(value.turns));
  terminalFields(value, "result");
  if (value.retryOf !== undefined) {
    const prior = previous.find(item => item.id === value.retryOf);
    requireValue(prior && ["failed", "unknown"].includes(prior.status) && prior.mode === value.mode && prior.text === value.text);
  }
  requireValue(value.status === "succeeded" || (value.followupDraft === "" && value.turns.length === 0));
  const turns: AskTurn[] = [];
  for (const item of value.turns) {
    shape(item, ["id", "message", "createdAt", "status"], ["reply", "error", "finishedAt", "retryOf"]);
    identity(item, ids);
    requireValue(text(item.message, askFollowupLimits.message));
    terminalFields(item, "reply");
    if (item.retryOf !== undefined) {
      const prior = turns.find(turn => turn.id === item.retryOf);
      requireValue(prior && ["failed", "unknown"].includes(prior.status) && prior.message === item.message);
    }
    turns.push(item as AskTurn);
  }
  requireValue(turns.filter(turn => turn.status === "pending").length <= 1);
}

/** Reject corruption without repairing, pruning, merging or overwriting its source. */
export function validateAskRecords(value: unknown): asserts value is AskRecords {
  shape(value, ["schema", "composer", "selectedId", "entries"]);
  requireValue(value.schema === 1 && Array.isArray(value.entries));
  shape(value.composer, ["mode", "text"]);
  requireValue(mode(value.composer.mode) && text(value.composer.text, 300, true));
  const ids = new Set<string>(), entries: AskEntry[] = [];
  for (const entry of value.entries) { validateEntry(entry, ids, entries); entries.push(entry); }
  requireValue(value.selectedId === null || (askId(value.selectedId) && entries.some(item => item.id === value.selectedId)));
}
function checked(value: AskRecords): AskRecords { validateAskRecords(value); return value; }
function updateEntry(state: AskRecords, id: string, change: (entry: AskEntry) => AskEntry): AskRecords {
  const index = state.entries.findIndex(entry => entry.id === id);
  if (index < 0) return state;
  const entry = change(state.entries[index]);
  if (entry === state.entries[index]) return state;
  return checked({ ...state, entries: state.entries.map((item, i) => i === index ? entry : item) });
}
function updateTurn(state: AskRecords, entryId: string, turnId: string, change: (turn: AskTurn) => AskTurn): AskRecords {
  return updateEntry(state, entryId, entry => {
    const index = entry.turns.findIndex(turn => turn.id === turnId);
    if (index < 0) return entry;
    const turn = change(entry.turns[index]);
    return turn === entry.turns[index] ? entry : { ...entry, turns: entry.turns.map((item, i) => i === index ? turn : item) };
  });
}

export function createAskRecords(): AskRecords { return { schema: 1, composer: { mode: "explain", text: "" }, selectedId: null, entries: [] }; }
export function createAskEntry(input: { id: string; mode: AskMode; text: string; createdAt: string; retryOf?: string }): AskEntry {
  const entry: AskEntry = { id: input.id, mode: input.mode, text: input.text, createdAt: input.createdAt, ...(input.retryOf !== undefined ? { retryOf: input.retryOf } : {}), status: "pending", followupDraft: "", turns: [] };
  // The retry target belongs to the archive and is validated when appending.
  const { retryOf, ...initial } = entry;
  requireValue(retryOf === undefined || askId(retryOf));
  validateEntry(initial, new Set(), []);
  return entry;
}
export function appendAskEntry(state: AskRecords, entry: AskEntry): AskRecords {
  requireValue(entry.status === "pending");
  return checked({ ...state, selectedId: entry.id, entries: [...state.entries, { ...entry, turns: [...entry.turns] }] });
}
export function completeAskEntry(state: AskRecords, id: string, explanation: Explanation, finishedAt: string): AskRecords {
  return updateEntry(state, id, entry => {
    if (entry.status !== "pending") return entry;
    result(explanation);
    const snapshot: Explanation = { ...explanation, headwords: explanation.headwords.map(item => ({ ...item })), contrasts: explanation.contrasts.map(item => ({ ...item })), alternatives: [...explanation.alternatives] };
    return { ...entry, status: "succeeded", result: snapshot, finishedAt };
  });
}
export function failAskEntry(state: AskRecords, id: string, error: string, finishedAt: string): AskRecords {
  return updateEntry(state, id, entry => entry.status === "pending" ? { ...entry, status: "failed", error, finishedAt } : entry);
}
export function selectAskEntry(state: AskRecords, id: string | null): AskRecords {
  requireValue(id === null || state.entries.some(entry => entry.id === id));
  return state.selectedId === id ? state : { ...state, selectedId: id };
}
export function setAskComposer(state: AskRecords, composer: AskRecords["composer"]): AskRecords {
  requireValue(mode(composer.mode) && text(composer.text, 300, true));
  return { ...state, composer: { ...composer } };
}
export function setAskFollowupDraft(state: AskRecords, entryId: string, draft: string): AskRecords {
  return updateEntry(state, entryId, entry => ({ ...entry, followupDraft: draft }));
}
export function createAskTurn(input: { id: string; message: string; createdAt: string; retryOf?: string }): AskTurn {
  requireValue(askId(input.id) && text(input.message, askFollowupLimits.message) && iso(input.createdAt) && (input.retryOf === undefined || askId(input.retryOf)));
  return { id: input.id, message: input.message, createdAt: input.createdAt, ...(input.retryOf !== undefined ? { retryOf: input.retryOf } : {}), status: "pending" };
}
export function appendAskTurn(state: AskRecords, entryId: string, turn: AskTurn): AskRecords {
  requireValue(turn.status === "pending" && state.entries.some(entry => entry.id === entryId && entry.status === "succeeded"));
  return updateEntry(state, entryId, entry => ({ ...entry, turns: [...entry.turns, { ...turn }] }));
}
export function completeAskTurn(state: AskRecords, entryId: string, turnId: string, reply: string, finishedAt: string): AskRecords {
  return updateTurn(state, entryId, turnId, turn => turn.status === "pending" ? { ...turn, status: "succeeded", reply, finishedAt } : turn);
}
export function failAskTurn(state: AskRecords, entryId: string, turnId: string, error: string, finishedAt: string): AskRecords {
  return updateTurn(state, entryId, turnId, turn => turn.status === "pending" ? { ...turn, status: "failed", error, finishedAt } : turn);
}

/** The browser is leaving/aborting receipt; the provider outcome is not known. */
export function interruptAskRequest(state: AskRecords, entryId: string, requestId: string): AskRecords {
  if (entryId === requestId) return updateEntry(state, entryId, entry => entry.status === "pending" ? { ...entry, status: "unknown" } : entry);
  return updateTurn(state, entryId, requestId, turn => turn.status === "pending" ? { ...turn, status: "unknown" } : turn);
}

export function serializeAskRecords(state: AskRecords): string { validateAskRecords(state); return JSON.stringify(state); }
export function restoreAskRecords(raw: string): AskRecords {
  const value: unknown = JSON.parse(raw);
  validateAskRecords(value);
  return { ...value, entries: value.entries.map(entry => ({ ...entry, status: entry.status === "pending" ? "unknown" : entry.status, turns: entry.turns.map(turn => ({ ...turn, status: turn.status === "pending" ? "unknown" : turn.status })) })) };
}

/** Recent successful pairs only. Dropped count is successful turns omitted from transmission, never deleted records. */
export function askHistoryWindow(entry: AskEntry): { messages: AskMessage[]; droppedCount: number } {
  const successful = entry.turns.filter(turn => turn.status === "succeeded");
  const messages: AskMessage[] = [];
  let characters = 0;
  for (let i = successful.length - 1; i >= 0; i--) {
    const turn = successful[i], reply = turn.reply!;
    const count = size(turn.message) + size(reply);
    if (messages.length + 2 > askFollowupLimits.historyMessages || characters + count > askFollowupLimits.historyCharacters) break;
    messages.unshift({ role: "user", content: turn.message }, { role: "assistant", content: reply });
    characters += count;
  }
  return { messages, droppedCount: successful.length - messages.length / 2 };
}
