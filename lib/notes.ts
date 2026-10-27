/**
 * Pen notes: underline, highlight and margin memo on the text of a lesson document. Pure rules only (no DOM, no React):
 * what a note is, how it is stored per lesson, how it is found again in the text and how a stored file is checked.
 * A note is not a learning event. It never enters the lesson record, and it is never sent to the AI.
 *
 * A note sits on a "block" (one paragraph, prompt, option, card field…, named by a stable key) and is identified by the exact
 * text the learner selected plus a few characters before and after it. Offsets are only a hint, so a changed text can still
 * find the note, and a note whose text is gone is kept and shown apart (`locateNote` returns null).
 */

export const NOTE_STORAGE_PREFIX = "english-sense-notes-v1:";
export const noteStorageKey = (lessonId: string) => `${NOTE_STORAGE_PREFIX}${lessonId}`;

export const noteLimits = { notes: 200, memo: 500, quote: 2000, context: 12, block: 120, id: 64 } as const;

/** "none" is a memo-only note. The two highlights differ by colour; every kind differs from the others by shape (line, fill, none). */
export const NOTE_MARKS = ["underline", "yellow", "rose", "none"] as const;
export type NoteMark = typeof NOTE_MARKS[number];

export type Note = {
  id: string;
  /** Stable key of the text block (`data-note-block`). */
  block: string;
  /** The exact selected text, trimmed. */
  quote: string;
  prefix: string;
  suffix: string;
  /** Where the quote started in the block text when the note was made. A hint, not the identity. */
  start: number;
  mark: NoteMark;
  /** The margin memo, up to `noteLimits.memo` characters. A memo-only note has a memo. */
  memo: string;
  createdAt: number;
};

export const markLabel: Record<NoteMark, string> = { underline: "밑줄", yellow: "노란 형광펜", rose: "분홍 형광펜", none: "메모" };

/* ---------- block text ---------- */

/** A blank input inside a block stands for this character; a line break for "\n". Both are one unit of the block text. */
export const GAP_CHAR = "￼";
export type NoteRun = { text: string; wrap?: "i" | "cite" } | { gap: "input" | "break" };
export const runText = (run: NoteRun) => "gap" in run ? (run.gap === "break" ? "\n" : GAP_CHAR) : run.text;
export const runsText = (runs: NoteRun[]) => runs.map(runText).join("");
/** The blank character is shown as the blank it stands for. */
export const readable = (text: string) => text.replaceAll(GAP_CHAR, "___").replace(/\s*\n\s*/g, " ");

/* ---------- making and finding ---------- */

/**
 * The note for a selection `[start, end)` of a block text. The ends are trimmed of white space and blank characters.
 * Null when nothing is left or the quote is longer than a note may be.
 */
export function makeNote(input: { id: string; block: string; text: string; start: number; end: number; mark: NoteMark; memo?: string; now: number }): Note | null {
  const { text } = input;
  const span = trimSpan(text, input.start, input.end);
  if (!span || span.end - span.start > noteLimits.quote || !input.block || input.block.length > noteLimits.block) return null;
  const { start, end } = span;
  return {
    id: input.id, block: input.block, quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - noteLimits.context), start), suffix: text.slice(end, end + noteLimits.context),
    start, mark: input.mark, memo: input.memo ?? "", createdAt: input.now,
  };
}

/** `[start, end)` of a text without the white space and blank characters at its ends. Null when nothing is left. */
export function trimSpan(text: string, from: number, to: number): { start: number; end: number } | null {
  let start = Math.max(0, Math.min(from, to)), end = Math.min(text.length, Math.max(from, to));
  const skip = (index: number) => /\s/.test(text[index]) || text[index] === GAP_CHAR;
  while (start < end && skip(start)) start++;
  while (end > start && skip(end - 1)) end--;
  return end > start ? { start, end } : null;
}

const commonSuffix = (a: string, b: string) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; };
const commonPrefix = (a: string, b: string) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };

/**
 * Finds the note in the current text of its block: the exact quote, and when it appears more than once the place whose
 * neighbours match best (then the one nearest the old offset). A short quote whose neighbours both changed is not trusted:
 * it may be another place, so the note is reported as not found instead of being attached to a wrong word.
 */
export function locateNote(text: string, note: Pick<Note, "quote" | "prefix" | "suffix" | "start">): { start: number; end: number } | null {
  if (!note.quote) return null;
  let best: { at: number; score: number } | null = null;
  for (let at = text.indexOf(note.quote); at >= 0; at = text.indexOf(note.quote, at + 1)) {
    // White space next to the quote matches almost anywhere, so it is not counted.
    const score = commonSuffix(text.slice(0, at).trimEnd(), note.prefix.trimEnd()) + commonPrefix(text.slice(at + note.quote.length).trimStart(), note.suffix.trimStart());
    if (!best || score > best.score || (score === best.score && Math.abs(at - note.start) < Math.abs(best.at - note.start))) best = { at, score };
  }
  if (!best) return null;
  const known = note.prefix.length + note.suffix.length, need = note.quote.length >= 20 ? 0 : Math.min(2, known);
  return best.score >= need ? { start: best.at, end: best.at + note.quote.length } : null;
}

export type Placement = { note: Note; start: number; end: number };

/** The notes of one block that are found in its text, in text order. */
export function placeNotes(text: string, notes: Note[]): Placement[] {
  const placed: Placement[] = [];
  for (const note of notes) { const found = locateNote(text, note); if (found) placed.push({ note, ...found }); }
  return placed.sort((a, b) => a.start - b.start || a.end - b.end);
}

export type Segment = { start: number; end: number; ids: string[] };

/** Cuts `[0, length)` at every note boundary. Segments no note covers have an empty `ids`. */
export function segmentsOf(length: number, placements: Pick<Placement, "start" | "end" | "note">[]): Segment[] {
  const cuts = new Set<number>([0, length]);
  for (const placement of placements) { cuts.add(Math.max(0, Math.min(length, placement.start))); cuts.add(Math.max(0, Math.min(length, placement.end))); }
  const points = [...cuts].sort((a, b) => a - b), segments: Segment[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const start = points[index], end = points[index + 1];
    segments.push({ start, end, ids: placements.filter(placement => placement.start <= start && placement.end >= end).map(placement => placement.note.id) });
  }
  return segments;
}

/* ---------- changing the list ---------- */

export type ChangeResult = { ok: true; notes: Note[] } | { ok: false; message: string };

export function addNote(notes: Note[], note: Note, reserved = 0): ChangeResult {
  if (notes.length + reserved >= noteLimits.notes) return { ok: false, message: `노트는 한 수업에 ${noteLimits.notes}개까지 둘 수 있습니다. 쓰지 않는 노트를 지운 뒤 다시 시도하십시오.` };
  return { ok: true, notes: [...notes, note] };
}
export const memoLength = (memo: string) => [...memo].length;
export const clipMemo = (memo: string) => memoLength(memo) <= noteLimits.memo ? memo : [...memo].slice(0, noteLimits.memo).join("");
/** A memo is kept as written except for white space at its ends. Empty means no memo. */
export const cleanMemo = (memo: string) => clipMemo(memo.trim());

/** Sets a note's memo. An empty memo on a memo-only note removes the note. */
export function setMemo(notes: Note[], id: string, memo: string): Note[] {
  const next = cleanMemo(memo);
  return notes.flatMap(note => note.id !== id ? [note] : next === "" && note.mark === "none" ? [] : [{ ...note, memo: next }]);
}
/** Takes the mark off a note. A note that has a memo stays as a memo-only note; one without a memo is removed. */
export function clearMark(notes: Note[], id: string): Note[] {
  return notes.flatMap(note => note.id !== id ? [note] : note.memo === "" ? [] : [{ ...note, mark: "none" as const }]);
}
export const removeNote = (notes: Note[], id: string) => notes.filter(note => note.id !== id);

/* ---------- storage ---------- */

type NoteFile = { v: 1; lesson: string; notes: Note[] };

export function noteFileText(lessonId: string, notes: Note[]) {
  const file: NoteFile = { v: 1, lesson: lessonId, notes };
  return JSON.stringify(file);
}

const KEYS = ["id", "block", "quote", "prefix", "suffix", "start", "mark", "memo", "createdAt"].sort().join();
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

function invalidNote(value: unknown): string | null {
  if (!isObject(value) || Object.keys(value).sort().join() !== KEYS) return "형식";
  const { id, block, quote, prefix, suffix, start, mark, memo, createdAt } = value;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return "식별자";
  if (typeof block !== "string" || block.length < 1 || block.length > noteLimits.block) return "블록";
  if (typeof quote !== "string" || quote.length < 1 || quote.length > noteLimits.quote || quote !== quote.trim()) return "인용";
  if (typeof prefix !== "string" || prefix.length > noteLimits.context || typeof suffix !== "string" || suffix.length > noteLimits.context) return "앞뒤 글";
  if (!isInt(start, 1_000_000)) return "위치";
  if (typeof mark !== "string" || !(NOTE_MARKS as readonly string[]).includes(mark)) return "표시";
  if (typeof memo !== "string" || memoLength(memo) > noteLimits.memo || memo !== memo.trim()) return "메모";
  if (mark === "none" && memo === "") return "메모";
  if (!isInt(createdAt, 8.64e15)) return "시각";
  return null;
}

export type NoteReadResult = { ok: true; notes: Note[] } | { ok: false; message: string };

/**
 * Reads the stored file of one lesson. Nothing stored is an empty list. Anything that does not match exactly (the shape, a
 * limit, a duplicate id, another lesson's file) makes the whole file of this lesson unusable; the caller drops these notes
 * and says so. Other lessons' notes and the lesson record are never touched here.
 */
export function readNotes(raw: string | null, lessonId: string): NoteReadResult {
  if (raw === null) return { ok: true, notes: [] };
  const bad = (reason: string): NoteReadResult => ({ ok: false, message: `저장된 노트를 읽지 못했습니다(${reason}). 이 수업의 노트만 비우고 새 노트부터 저장합니다.` });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return bad("형식"); }
  if (!isObject(value) || Object.keys(value).sort().join() !== "lesson,notes,v" || value.v !== 1 || value.lesson !== lessonId || !Array.isArray(value.notes)) return bad("형식");
  if (value.notes.length > noteLimits.notes) return bad("개수");
  const seen = new Set<string>();
  for (const item of value.notes) {
    const reason = invalidNote(item);
    if (reason) return bad(reason);
    const id = (item as Note).id;
    if (seen.has(id)) return bad("식별자");
    seen.add(id);
  }
  return { ok: true, notes: value.notes as Note[] };
}
