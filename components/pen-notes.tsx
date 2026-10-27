"use client";

import "./pen-notes.css";
import { Fragment, cloneElement, createContext, createElement, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type MutableRefObject, type ReactNode } from "react";
import { addNote, clearMark, cleanMemo, clipMemo, locateNote, makeNote, markLabel, memoLength, noteFileText, noteLimits, noteStorageKey, placeNotes, readable, readNotes, removeNote, runText, runsText, segmentsOf, setMemo, trimSpan, type Note, type NoteMark, type NoteRun } from "@/lib/notes";
import { blockTexts, type NoteBlocks } from "@/lib/note-blocks";
import { SaveWarning, type SaveState } from "@/components/workspace-session";

/**
 * Pen notes on the text of a lesson document: underline, highlight (two colours) and a memo in the margin.
 *
 * Rendering. The text of a block is React's own, and nothing here edits it: a block that carries notes renders its text as
 * pieces (`mark`/`span` around the noted parts) in place of the plain string, so a re-render never loses a note and the
 * first HTML is the plain text. The memo is a floated margin note (wide screens) or a folded line under the block (narrow).
 * Finding. A stored note is found again by its exact text and the characters around it (`lib/notes.ts`); the block's
 * runs (`lib/note-blocks.ts`) give the text, so a note is found even while its block is not on screen.
 * Storage. One key per lesson (`english-sense-notes-v1:<lessonId>`), apart from the lesson record and the document state.
 * A note is not a learning event and is never sent to the AI.
 */

export type NoteTarget = { block: string; start: number; end: number };
type Editing = { id: string; text: string };

export type PenNotes = {
  lessonId: string;
  ready: boolean;
  notes: Note[];
  notesIn: (block: string) => Note[];
  blockText: (block: string) => string | undefined;
  isHidden: (block: string) => boolean;
  /** The text of a note's block can be found in the current document. */
  isFound: (note: Note) => boolean;
  rank: (note: Note) => number;
  draft: Note | null;
  editing: Editing | null;
  loadNotice: string;
  dismissLoadNotice: () => void;
  notice: string;
  live: string;
  say: (text: string) => void;
  saveState: SaveState;
  saveError: string;
  retry: () => void;
  createMark: (target: NoteTarget, mark: Exclude<NoteMark, "none">) => string | null;
  startMemo: (target: NoteTarget) => boolean;
  editMemo: (id: string) => void;
  setEditingText: (text: string) => void;
  saveEditing: () => void;
  cancelEditing: () => void;
  dropMark: (id: string) => void;
  /** Removes the memo; a memo-only note goes with it. Asks first, because the memo is the learner's own writing. */
  removeMemo: (id: string) => void;
  deleteNote: (id: string) => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
  /** Moves to the note's text. False when the text is not on screen. */
  jump: (id: string) => boolean;
  flash: string | null;
  /** Keeps the remembered selection while the pointer is on a note control (the selection may collapse on press). */
  hold: MutableRefObject<number>;
  selection: MutableRefObject<{ target: NoteTarget; at: number } | null>;
};

const NotesContext = createContext<PenNotes | null>(null);
export const NotesProvider = NotesContext.Provider;
export const useNotes = () => useContext(NotesContext);

const newId = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* ---------- state ---------- */

export function usePenNotes(options: { lessonId: string; blocks: NoteBlocks; /** Blocks whose text must not show now (the covered story). Their notes show a kind and the memo only. */ hidden?: (block: string) => boolean }): PenNotes {
  const { lessonId, blocks } = options, key = noteStorageKey(lessonId);
  const texts = useMemo(() => blockTexts(blocks), [blocks]);
  const order = useMemo(() => new Map(Object.keys(blocks).map((block, index) => [block, index])), [blocks]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [ready, setReady] = useState(false);
  const [loadNotice, setLoadNotice] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [saveError, setSaveError] = useState("");
  const [draft, setDraft] = useState<Note | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState("");
  const [live, setLive] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const notesRef = useRef(notes), draftRef = useRef(draft), editingRef = useRef(editing), hiddenRef = useRef(options.hidden);
  const triggerRef = useRef<HTMLButtonElement | null>(null), hold = useRef(0), selection = useRef<{ target: NoteTarget; at: number } | null>(null);
  notesRef.current = notes; draftRef.current = draft; editingRef.current = editing; hiddenRef.current = options.hidden;

  // Reading the stored notes makes no request and no event. A stored file that cannot be used loses only this lesson's notes.
  useEffect(() => {
    try {
      const result = readNotes(localStorage.getItem(key), lessonId);
      if (result.ok) { setNotes(result.notes); notesRef.current = result.notes; } else { setNotes([]); notesRef.current = []; setLoadNotice(result.message); }
    } catch { setLoadNotice("이 브라우저에서 노트를 읽지 못했습니다. 노트는 이 화면에서만 유지됩니다."); }
    setReady(true);
  }, [key, lessonId]);
  // Another tab of the same lesson wrote the notes.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key || draftRef.current || editingRef.current) return;
      const result = readNotes(event.newValue, lessonId);
      if (result.ok) { setNotes(result.notes); notesRef.current = result.notes; }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, lessonId]);

  const write = useCallback((next: Note[]) => {
    try {
      if (next.length === 0) localStorage.removeItem(key); else localStorage.setItem(key, noteFileText(lessonId, next));
      setSaveState("saved"); setSaveError("");
    } catch { setSaveState("failed"); setSaveError("노트를 저장하지 못했습니다. 화면에는 남아 있지만 화면을 닫으면 잃을 수 있습니다."); }
  }, [key, lessonId]);
  const commit = useCallback((next: Note[]) => { notesRef.current = next; setNotes(next); write(next); }, [write]);
  const say = useCallback((text: string) => { setLive(""); window.setTimeout(() => setLive(text), 30); }, []);
  const refuse = useCallback((message: string) => { setNotice(message); say(message); window.setTimeout(() => setNotice(current => current === message ? "" : current), 6000); }, [say]);

  function build(target: NoteTarget, mark: NoteMark): Note | null {
    const text = texts[target.block];
    if (text === undefined) { refuse("이 글에는 노트를 달 수 없습니다."); return null; }
    const note = makeNote({ id: newId(), block: target.block, text, start: target.start, end: target.end, mark, now: Date.now() });
    if (!note) { refuse("선택한 글이 비어 있거나 너무 깁니다."); return null; }
    return note;
  }
  function createMark(target: NoteTarget, mark: Exclude<NoteMark, "none">) {
    setNotice("");
    const note = build(target, mark);
    if (!note) return null;
    const result = addNote(notesRef.current, note, draftRef.current ? 1 : 0);
    if (!result.ok) { refuse(result.message); return null; }
    commit(result.notes); say(`${markLabel[mark]}을 남겼습니다.`);
    return note.id;
  }
  function startMemo(target: NoteTarget) {
    setNotice("");
    if (draftRef.current || editingRef.current) saveEditing();
    const note = build(target, "none");
    if (!note) return false;
    if (notesRef.current.length >= noteLimits.notes) { refuse(`노트는 한 수업에 ${noteLimits.notes}개까지 둘 수 있습니다. 쓰지 않는 노트를 지운 뒤 다시 시도하십시오.`); return false; }
    setDraft(note); draftRef.current = note; const next = { id: note.id, text: "" }; setEditing(next); editingRef.current = next;
    return true;
  }
  function editMemo(id: string) {
    const note = notesRef.current.find(item => item.id === id);
    if (!note) return;
    if (draftRef.current || editingRef.current) saveEditing();
    const next = { id, text: note.memo }; setEditing(next); editingRef.current = next;
  }
  function setEditingText(text: string) { setEditing(previous => { const next = previous ? { ...previous, text: clipMemo(text) } : previous; editingRef.current = next; return next; }); }
  function endEditing() { setEditing(null); editingRef.current = null; setDraft(null); draftRef.current = null; }
  function saveEditing() {
    const current = editingRef.current, pending = draftRef.current;
    if (!current) { endEditing(); return; }
    const memo = cleanMemo(current.text);
    if (pending && pending.id === current.id) {
      if (memo !== "") { const result = addNote(notesRef.current, { ...pending, memo }); if (result.ok) { commit(result.notes); say("메모를 남겼습니다."); } else refuse(result.message); }
    } else {
      const before = notesRef.current.find(note => note.id === current.id);
      if (before && before.memo !== memo) { commit(setMemo(notesRef.current, current.id, memo)); say(memo === "" ? "메모를 지웠습니다." : "메모를 고쳤습니다."); }
    }
    endEditing();
  }
  function cancelEditing() { endEditing(); }
  function dropMark(id: string) {
    const note = notesRef.current.find(item => item.id === id);
    if (!note || note.mark === "none") return;
    commit(clearMark(notesRef.current, id)); say(`${markLabel[note.mark]} 표시를 지웠습니다.`);
  }
  function removeMemo(id: string) {
    const note = notesRef.current.find(item => item.id === id);
    if (!note || note.memo === "") return;
    if (!window.confirm("이 메모를 지웁니다. 되돌릴 수 없습니다. 계속합니까?")) return;
    if (editingRef.current?.id === id) endEditing();
    commit(setMemo(notesRef.current, id, "")); say("메모를 지웠습니다.");
  }
  function deleteNote(id: string) {
    const note = notesRef.current.find(item => item.id === id);
    if (!note) return;
    if (editingRef.current?.id === id) endEditing();
    commit(removeNote(notesRef.current, id)); say("노트를 지웠습니다.");
  }
  // A memo being typed when its text is covered is kept, not lost.
  const hiddenNow = editing && options.hidden ? options.hidden(notesRef.current.find(note => note.id === editing.id)?.block ?? draft?.block ?? "") : false;
  useEffect(() => { if (hiddenNow) saveEditing(); }, [hiddenNow]);

  function jump(id: string) {
    const target = document.querySelector<HTMLElement>(`[data-note-head~="${id}"]`);
    if (!target) return false;
    target.scrollIntoView({ block: "center", behavior: "instant" });
    target.focus({ preventScroll: true });
    setFlash(id); window.setTimeout(() => setFlash(current => current === id ? null : current), 1800);
    return true;
  }

  const rank = (note: Note) => order.get(note.block) ?? 1e6;
  const isFound = (note: Note) => { const text = texts[note.block]; return text !== undefined && locateNote(text, note) !== null; };
  const notesIn = (block: string) => { const own = notes.filter(note => note.block === block); return draft && draft.block === block ? [...own, draft] : own; };

  return {
    lessonId, ready, notes, notesIn, blockText: block => texts[block], isHidden: block => options.hidden?.(block) ?? false, isFound, rank, draft, editing,
    loadNotice, dismissLoadNotice: () => setLoadNotice(""), notice, live, say, saveState, saveError,
    retry: () => write(notesRef.current), createMark, startMemo, editMemo, setEditingText, saveEditing, cancelEditing, dropMark, removeMemo, deleteNote,
    panelOpen, setPanelOpen, triggerRef, jump, flash, hold, selection,
  };
}

/* ---------- a block of text ---------- */

type BlockTag = "p" | "h2" | "li" | "dd" | "blockquote";
type NoteBlockProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  as?: BlockTag;
  /** Stable key of the block in this lesson (`lib/note-blocks.ts`). */
  block: string;
  runs: NoteRun[];
  /** The elements of `{ gap: "input" }` runs, in order. Each one is marked as a gap of the text; a blank input is not text. */
  gaps?: ReactNode[];
  /** The block is shown but may not take notes (an older version of the text). */
  disabled?: boolean;
  /** Content after the text that is not part of it (a tag next to an option). It must carry `data-note-skip`. */
  children?: ReactNode;
};

const pinMarks = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
const pinOf = (index: number) => pinMarks[index] ?? String(index + 1);

/**
 * A block of text that can carry notes. With no provider, no note or `disabled` it renders exactly the text it was given.
 * The element keeps the caller's tag, class, language and attributes; it only adds `data-note-block` (what the selection
 * tool looks for) and, when it carries notes, the pieces around the noted text and the margin memos.
 */
export function NoteBlock({ as = "p", block, runs, gaps = [], disabled, children, className, ...rest }: NoteBlockProps) {
  const notes = useNotes(), listId = useId(), [open, setOpen] = useState(false);
  const enabled = !!notes && !disabled;
  const text = runsText(runs);
  const own = enabled ? notes.notesIn(block) : [];
  const placed = own.length ? placeNotes(text, own) : [];
  const withMemo = placed.filter(item => item.note.memo !== "" || notes?.editing?.id === item.note.id);
  const editingHere = withMemo.some(item => notes?.editing?.id === item.note.id);
  const pins = new Map(withMemo.map((item, index) => [item.note.id, pinOf(index)]));
  const segments = placed.length ? segmentsOf(text.length, placed) : [];
  const byId = new Map(placed.map(item => [item.note.id, item]));

  function pieces(): ReactNode[] {
    const nodes: ReactNode[] = [];
    let offset = 0, gap = 0;
    runs.forEach((run, index) => {
      if ("gap" in run) {
        const node = run.gap === "input" ? gaps[gap++] : null;
        nodes.push(run.gap === "break" ? <br key={index} data-note-gap="break" /> : isValidElement<Record<string, unknown>>(node) ? cloneElement(node, { key: index, "data-note-gap": "input" }) : <span key={index} data-note-gap="input">{node}</span>);
        offset += runText(run).length;
        return;
      }
      const end = offset + run.text.length;
      const inner: ReactNode[] = [];
      if (segments.length === 0) inner.push(run.text);
      else for (const segment of segments) {
        const from = Math.max(segment.start, offset), to = Math.min(segment.end, end);
        if (to <= from) continue;
        const slice = run.text.slice(from - offset, to - offset);
        if (segment.ids.length === 0) { inner.push(slice); continue; }
        const covering = segment.ids.map(id => byId.get(id)!).filter(Boolean);
        const highlight = covering.filter(item => item.note.mark === "yellow" || item.note.mark === "rose").sort((a, b) => b.note.createdAt - a.note.createdAt)[0];
        const underlined = covering.some(item => item.note.mark === "underline");
        const heads = covering.filter(item => item.start === from).map(item => item.note.id);
        const tails = covering.filter(item => item.end === to && pins.has(item.note.id)).map(item => pins.get(item.note.id)!);
        const described = covering.filter(item => pins.has(item.note.id)).map(item => `np-memo-${item.note.id}`).join(" ");
        const flashing = covering.some(item => item.note.id === notes?.flash);
        const classes = ["np-seg", underlined ? "np-u" : "", highlight ? `np-${highlight.note.mark}` : "", !underlined && !highlight ? "np-memo-only" : "", flashing ? "np-flash" : ""].filter(Boolean).join(" ");
        inner.push(createElement(highlight ? "mark" : "span", {
          key: `${index}-${from}`, className: classes, "data-note-ids": segment.ids.join(" "), "data-note-head": heads.length ? heads.join(" ") : undefined,
          "data-pin": tails.length ? tails.join("") : undefined, "aria-describedby": described || undefined, tabIndex: heads.length ? -1 : undefined,
        }, slice));
      }
      nodes.push(run.wrap ? createElement(run.wrap, { key: index }, ...inner) : <Fragment key={index}>{inner}</Fragment>);
      offset = end;
    });
    return nodes;
  }

  const margin = withMemo.length > 0 && notes && <span className="np-margin" data-note-skip data-open={open || editingHere}>
    <button type="button" className="np-fold" aria-expanded={open || editingHere} aria-controls={listId} onClick={() => setOpen(value => !value)}>메모 {withMemo.length}개 <span aria-hidden="true">{open || editingHere ? "▴" : "▾"}</span></button>
    <span className="np-memos" id={listId}>{withMemo.map(item => <MemoItem key={item.note.id} notes={notes} note={item.note} pin={pins.get(item.note.id)!} />)}</span>
  </span>;

  return createElement(as, { ...rest, className: [className, withMemo.length ? "np-has-memo" : ""].filter(Boolean).join(" ") || undefined, "data-note-block": enabled ? block : undefined }, ...pieces(), children, margin || null);
}

function MemoItem({ notes, note, pin }: { notes: PenNotes; note: Note; pin: string }) {
  const editing = notes.editing?.id === note.id;
  const label = `‘${readable(note.quote)}’`;
  return <span className="np-memo" id={`np-memo-${note.id}`} data-note-id={note.id}>
    <span className="np-pinno" aria-hidden="true">{pin}</span>
    {editing ? <MemoEditor notes={notes} label={label} /> : <>
      <span className="lw-sr-only">{label}에 단 메모: </span>
      <span className="np-memo-text">{note.memo}</span>
      <span className="np-memo-actions">
        <button type="button" onClick={() => notes.editMemo(note.id)} aria-label={`메모 수정: ${label}`}>수정</button>
        <button type="button" onClick={() => notes.removeMemo(note.id)} aria-label={`메모 삭제: ${label}`}>삭제</button>
      </span>
    </>}
  </span>;
}

function MemoEditor({ notes, label }: { notes: PenNotes; label: string }) {
  const field = useRef<HTMLTextAreaElement>(null), id = useId();
  const text = notes.editing?.text ?? "";
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    const box = element.getBoundingClientRect();
    if (box.bottom > window.innerHeight || box.top < 0) element.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, []);
  return <span className="np-edit">
    <label className="lw-sr-only" htmlFor={id}>{label}에 달 메모</label>
    <textarea id={id} ref={field} value={text} rows={3} maxLength={noteLimits.memo} placeholder="여백에 남길 메모" onChange={event => notes.setEditingText(event.target.value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); notes.cancelEditing(); }
        else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); notes.saveEditing(); }
      }} />
    <span className="np-edit-foot">
      <span className="np-count" aria-hidden="true">{memoLength(text)} / {noteLimits.memo}</span>
      <button type="button" className="np-primary" onClick={notes.saveEditing}>저장</button>
      <button type="button" onClick={notes.cancelEditing}>취소</button>
    </span>
    {notes.saveState === "failed" && <span className="np-save" role="status">{notes.saveError} <button type="button" onClick={notes.retry}>저장 다시 시도</button></span>}
  </span>;
}

/* ---------- the DOM side of a selection ---------- */

type Unit = { node: Node; text: string; start: number; gap: boolean };

/** The units of a block's text in order: its text nodes, and one unit for each blank/line break. Notes' own margin is skipped. */
function unitsOf(block: HTMLElement): Unit[] {
  const units: Unit[] = [];
  let at = 0;
  const walk = (parent: Node) => {
    parent.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) { const text = (child as Text).data; units.push({ node: child, text, start: at, gap: false }); at += text.length; }
      else if (child instanceof HTMLElement) {
        if (child.hasAttribute("data-note-skip")) return;
        const gap = child.getAttribute("data-note-gap");
        if (gap) { const text = gap === "break" ? "\n" : "￼"; units.push({ node: child, text, start: at, gap: true }); at += 1; }
        else walk(child);
      }
    });
  };
  walk(block);
  return units;
}

function blockOf(node: Node | null): HTMLElement | null {
  const element = node ? (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement) : null;
  if (!element || element.closest("[data-np-ui]")) return null;
  const block = element.closest<HTMLElement>("[data-note-block]");
  if (!block) return null;
  const skip = element.closest("[data-note-skip]");
  return skip && block.contains(skip) ? null : block;
}

/** Where a range boundary lies in the block text, or null when it lies outside the text (a memo, another element). */
function offsetIn(units: Unit[], total: number, container: Node, offset: number): number | null {
  if (container.nodeType === Node.TEXT_NODE) { const unit = units.find(item => item.node === container); return unit ? unit.start + offset : null; }
  const inGap = units.find(unit => unit.gap && (unit.node === container || unit.node.contains(container)));
  if (inGap) return inGap.start;
  const reference = offset < container.childNodes.length ? container.childNodes[offset] : null;
  for (const unit of units) {
    const after = reference
      ? unit.node === reference || reference.contains(unit.node) || !!(reference.compareDocumentPosition(unit.node) & Node.DOCUMENT_POSITION_FOLLOWING)
      : !container.contains(unit.node) && !!(container.compareDocumentPosition(unit.node) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (after) return unit.start;
  }
  return total;
}

/** The selection as a span of one block (the block the selection starts in), or null when notes cannot be made on it. */
function readSelection(notes: PenNotes): NoteTarget | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const active = document.activeElement;
  if (active && active.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-np-ui]")) return null;
  const range = selection.getRangeAt(0);
  const first = blockOf(range.startContainer), last = blockOf(range.endContainer), block = first ?? last;
  if (!block) return null;
  const key = block.getAttribute("data-note-block")!, units = unitsOf(block), domText = units.map(unit => unit.text).join("");
  // The text on screen must be the text the notes are made on.
  if (notes.blockText(key) !== domText) return null;
  const start = first === block ? offsetIn(units, domText.length, range.startContainer, range.startOffset) : 0;
  const end = last === block ? offsetIn(units, domText.length, range.endContainer, range.endOffset) : domText.length;
  if (start === null || end === null) return null;
  const span = trimSpan(domText, start, end);
  return span ? { block: key, start: span.start, end: span.end } : null;
}

/* ---------- tools ---------- */

type Tool = { kind: "select"; target: NoteTarget } | { kind: "marks"; ids: string[]; fresh?: boolean };
type Place = { top: number; left: number } | { dock: "top" | "bottom" } | null;

const dockQuery = "(max-width: 760px), (pointer: coarse)";

function Swatch({ kind }: { kind: "underline" | "yellow" | "rose" | "memo" }) {
  if (kind === "underline") return <svg className="np-icon" width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M1 11c2-1.6 3.3.9 5.4-.4S9.8 9.8 12 10.9s3.2-.6 5-.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M4 2h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".55" /></svg>;
  if (kind === "memo") return <svg className="np-icon" width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M2 12l1-3.5L11.5 1 15 4.5 6.5 12.5 2 12zM10 2.6l3.4 3.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>;
  return <svg className="np-icon" width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><rect x="1.5" y="2" width="15" height="10" rx="2.5" fill={kind === "yellow" ? "#f6d93b" : "#f49ac1"} stroke="#fff" strokeWidth="1" /></svg>;
}

/** The floating tool for a selection or a marked text, the notes list, and the announcements. Render it once per lesson, inside the frame. */
export function NoteTools() {
  const notes = useNotes();
  if (!notes || !notes.ready) return null;
  return <NoteToolsInner notes={notes} />;
}

function NoteToolsInner({ notes }: { notes: PenNotes }) {
  const [tool, setTool] = useState<Tool | null>(null);
  const [place, setPlace] = useState<Place>(null);
  const bar = useRef<HTMLDivElement>(null), returnFocus = useRef<HTMLElement | null>(null), focusBar = useRef(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const idsLeft = (ids: string[]) => ids.filter(id => notes.notes.some(note => note.id === id));
  // A marks tool whose notes are gone is closed.
  useEffect(() => { if (tool?.kind === "marks" && idsLeft(tool.ids).length === 0) setTool(null); }, [notes.notes]);

  // The selection: remembered while it is on a block that can take notes, forgotten when it collapses.
  useEffect(() => {
    let timer = 0, pressed = false;
    const evaluate = () => {
      if (performance.now() < notesRef.current.hold.current || pressed) return;
      if (document.activeElement?.closest("[data-np-ui]")) return;
      const target = readSelection(notesRef.current);
      notesRef.current.selection.current = target ? { target, at: performance.now() } : null;
      setTool(previous => target ? { kind: "select", target } : previous?.kind === "select" ? null : previous);
    };
    const schedule = (delay = 140) => { window.clearTimeout(timer); timer = window.setTimeout(evaluate, delay); };
    const onDown = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-np-ui]")) { notesRef.current.hold.current = performance.now() + 1500; return; }
      pressed = event instanceof PointerEvent ? event.pointerType === "mouse" && event.button === 0 && !target?.closest?.("button, input, textarea, select, a") : false;
      if (!target?.closest?.("[data-note-ids]")) setTool(previous => previous?.kind === "marks" ? null : previous);
    };
    const onUp = (event: Event) => { pressed = false; if (!(event.target as Element | null)?.closest?.("[data-np-ui]")) schedule(0); };
    const onCancel = () => { pressed = false; };
    // The press on a tool is over once its click has come; a later selection is a new one.
    const onToolClick = (event: Event) => { if ((event.target as Element | null)?.closest?.("[data-np-ui]")) notesRef.current.hold.current = 0; };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || target.closest("[data-np-ui], dialog, button, a, input, textarea, select, label, summary")) return;
      const segment = target.closest<HTMLElement>("[data-note-ids]");
      if (!segment || !window.getSelection()?.isCollapsed) return;
      const ids = (segment.getAttribute("data-note-ids") || "").split(" ").filter(Boolean);
      if (ids.length) { returnFocus.current = null; setTool({ kind: "marks", ids }); }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.code === "KeyN" && !(event.target as Element | null)?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']")) {
        event.preventDefault();
        const current = toolRef.current;
        if (current && bar.current) { returnFocus.current = (document.activeElement as HTMLElement) ?? null; bar.current.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }); }
        else notesRef.current.setPanelOpen(true);
      } else if (event.key === "Escape" && toolRef.current && !(event.target as Element | null)?.closest?.("[data-np-ui]")) setTool(null);
    };
    const onSelection = () => schedule();
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onCancel, true);
    document.addEventListener("pointercancel", onCancel, true);
    document.addEventListener("mouseup", onUp, true);
    document.addEventListener("click", onToolClick, true);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("pointerup", onCancel, true); document.removeEventListener("pointercancel", onCancel, true);
      document.removeEventListener("mouseup", onUp, true); document.removeEventListener("click", onToolClick, true); document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey);
    };
  }, []);

  const lastRect = useRef<DOMRect | null>(null);
  function anchorRect(current: Tool): DOMRect | null {
    if (current.kind === "marks") {
      for (const id of current.ids) { const element = document.querySelector<HTMLElement>(`[data-note-ids~="${id}"]`); if (element) return element.getBoundingClientRect(); }
      return null;
    }
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width || rect.height) { lastRect.current = rect; return rect; }
    }
    // The selection can collapse while the focus is on the tool (some browsers do); the tool then stays where it was.
    return bar.current?.contains(document.activeElement) ? lastRect.current : null;
  }
  const reposition = useCallback(() => {
    const current = toolRef.current, element = bar.current;
    if (!current || !element) { setPlace(null); return; }
    const rect = anchorRect(current);
    if (!rect) {
      // The selection is gone and nothing holds it: the tool goes too.
      if (current.kind === "select" && performance.now() >= notesRef.current.hold.current && !element.contains(document.activeElement)) setTool(null);
      setPlace(previous => previous === null ? previous : null);
      return;
    }
    if (rect.bottom < 0 || rect.top > window.innerHeight) { setPlace(previous => previous === null ? previous : null); return; }
    const height = element.offsetHeight, width = element.offsetWidth;
    let next: Place;
    if (window.matchMedia(dockQuery).matches) next = { dock: rect.bottom > window.innerHeight - height - 16 ? "top" : "bottom" };
    else {
      const safe = 66;
      let top = rect.top - height - 8;
      if (top < safe) top = rect.bottom + 8;
      if (top + height > window.innerHeight - 8) top = Math.max(safe, window.innerHeight - height - 8);
      next = { top: Math.round(top), left: Math.round(Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 8), Math.max(8, window.innerWidth - width - 8))) };
    }
    setPlace(previous => previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  useLayoutEffect(() => { reposition(); }, [tool, notes.notice, notes.notes, reposition]);
  useEffect(() => {
    if (!tool) return;
    let frame = 0;
    const again = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reposition); };
    window.addEventListener("scroll", again, { capture: true, passive: true }); window.addEventListener("resize", again); document.addEventListener("selectionchange", again);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", again, { capture: true }); window.removeEventListener("resize", again); document.removeEventListener("selectionchange", again); };
  }, [tool, reposition]);
  useEffect(() => {
    if (focusBar.current && bar.current) { focusBar.current = false; bar.current.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }); }
  });

  function dismiss(restore = true) {
    setTool(null); notes.selection.current = null;
    if (restore) returnFocus.current?.focus({ preventScroll: true });
    returnFocus.current = null;
  }
  function clearDomSelection() { window.getSelection()?.removeAllRanges(); }
  const hadFocus = () => !!bar.current?.contains(document.activeElement);
  function mark(kind: Exclude<NoteMark, "none">) {
    if (tool?.kind !== "select") return;
    const keepFocus = hadFocus(), id = notes.createMark(tool.target, kind);
    if (!id) return;
    clearDomSelection(); notes.selection.current = null;
    setTool({ kind: "marks", ids: [id], fresh: true }); focusBar.current = keepFocus;
  }
  function memo() {
    if (tool?.kind !== "select") return;
    if (notes.startMemo(tool.target)) { clearDomSelection(); setTool(null); notes.selection.current = null; }
  }
  function memoFor(id: string) { setTool(null); notes.editMemo(id); }

  const current = tool?.kind === "marks" ? idsLeft(tool.ids).map(id => notes.notes.find(note => note.id === id)!) : [];
  const style = place && "top" in place ? { top: place.top, left: place.left } : undefined;
  const barClass = ["np-bar", place && "dock" in place ? `np-dock np-dock-${place.dock}` : "np-float", place ? "" : "np-pending"].filter(Boolean).join(" ");

  return <>
    <div className="lw-sr-only" role="status" aria-live="polite" aria-atomic="true">{notes.live}</div>
    {tool && <div ref={bar} className={barClass} style={style} role="toolbar" aria-label={tool.kind === "select" ? "노트 도구: 선택한 글" : "노트 도구: 표시한 글"} data-np-ui data-tool={tool.kind}
      onMouseDown={event => { if (!(event.target as Element).closest("textarea, input")) event.preventDefault(); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); }
        else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("button")], at = buttons.indexOf(document.activeElement as HTMLElement);
          if (at >= 0) { event.preventDefault(); buttons[(at + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length].focus({ preventScroll: true }); }
        }
      }}>
      {tool.kind === "select" ? <>
        <button type="button" onClick={() => mark("underline")} aria-label="밑줄 긋기"><Swatch kind="underline" /><span>밑줄</span></button>
        <button type="button" onClick={() => mark("yellow")} aria-label="노란 형광펜"><Swatch kind="yellow" /><span>노란색</span></button>
        <button type="button" onClick={() => mark("rose")} aria-label="분홍 형광펜"><Swatch kind="rose" /><span>분홍색</span></button>
        <button type="button" onClick={memo} aria-label="메모 달기"><Swatch kind="memo" /><span>메모</span></button>
      </> : <>
        {current.map(note => <span className="np-row" key={note.id} role="group" aria-label={`${markLabel[note.mark]}: ${readable(note.quote)}`}>
          <b>{markLabel[note.mark]}{tool.fresh ? "을 남겼습니다" : ""}</b>
          <button type="button" onClick={() => memoFor(note.id)}><Swatch kind="memo" /><span>{note.memo ? "메모 고치기" : "메모 달기"}</span></button>
          {note.mark !== "none" && <button type="button" onClick={() => { const keep = hadFocus(); notes.dropMark(note.id); focusBar.current = keep; }}><span>표시 지우기</span></button>}
          <button type="button" onClick={() => { if (note.memo && !window.confirm("이 노트의 메모도 함께 지웁니다. 되돌릴 수 없습니다. 계속합니까?")) return; notes.deleteNote(note.id); }}><span>노트 지우기</span></button>
        </span>)}
      </>}
      {notes.notice && <span className="np-bar-note" role="status">{notes.notice}</span>}
      {notes.saveState === "failed" && <span className="np-save" role="status">{notes.saveError} <button type="button" onClick={notes.retry}>저장 다시 시도</button></span>}
    </div>}
    {notes.panelOpen && <NotesPanel notes={notes} />}
  </>;
}

/* ---------- the list ---------- */

function noteLine(notes: PenNotes, note: Note) {
  const hidden = notes.isHidden(note.block);
  return { hidden, kind: markLabel[note.mark], quote: hidden ? "" : readable(note.quote) };
}

function NotesPanel({ notes }: { notes: PenNotes }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [target] = useState(() => { const saved = notes.selection.current; return saved && performance.now() - saved.at < 4000 ? saved.target : null; });
  const [confirmed, setConfirmed] = useState("");
  useEffect(() => { const element = dialog.current; if (element && !element.open) element.showModal(); }, []);
  function close(focusTrigger = true) { dialog.current?.close(); notes.setPanelOpen(false); if (focusTrigger) requestAnimationFrame(() => notes.triggerRef.current?.focus({ preventScroll: true })); }
  const sorted = [...notes.notes].sort((a, b) => notes.rank(a) - notes.rank(b) || a.createdAt - b.createdAt);
  const found = sorted.filter(note => notes.isFound(note)), lost = sorted.filter(note => !notes.isFound(note));
  const quote = target ? notes.blockText(target.block)?.slice(target.start, target.end) : undefined;

  function go(note: Note) {
    close(false);
    requestAnimationFrame(() => { if (!notes.jump(note.id)) notes.say("이 노트의 글은 지금 문서에 보이지 않습니다."); });
  }
  function edit(note: Note) { close(false); requestAnimationFrame(() => { notes.editMemo(note.id); }); }
  function remove(note: Note) {
    if (note.memo && !window.confirm("이 노트의 메모도 함께 지웁니다. 되돌릴 수 없습니다. 계속합니까?")) return;
    notes.deleteNote(note.id); setConfirmed("노트를 지웠습니다.");
  }
  function item(note: Note, isLost: boolean) {
    const line = noteLine(notes, note), onScreen = !isLost && !line.hidden && !!document.querySelector(`[data-note-head~="${note.id}"]`);
    return <li className="np-item" key={note.id} data-note-id={note.id} data-found={!isLost}>
      <p className="np-item-kind"><b>{line.kind}</b>{line.hidden && <span> · 본문 노트</span>}</p>
      {line.quote && <p className="np-item-quote" lang="en">{line.quote}</p>}
      {note.memo && <p className="np-item-memo">{note.memo}</p>}
      <p className="np-item-actions">
        {!isLost && <button type="button" disabled={!onScreen} onClick={() => go(note)}>이동</button>}
        {onScreen && <button type="button" onClick={() => edit(note)}>{note.memo ? "메모 고치기" : "메모 달기"}</button>}
        {!isLost && !onScreen && <span className="lw-muted">{line.hidden ? "본문을 가린 동안은 이동하지 않습니다." : "지금 문서에 보이지 않는 글입니다."}</span>}
        <button type="button" onClick={() => remove(note)}>지우기</button>
      </p>
    </li>;
  }

  return <dialog ref={dialog} className="lw-dialog np-panel" aria-labelledby="np-panel-title" data-np-ui onCancel={event => { event.preventDefault(); close(); }}>
    <header><h2 id="np-panel-title">노트</h2><button type="button" onClick={() => close()} aria-label="닫고 학습으로 돌아가기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></header>
    <div className="lw-dialog-scroll">
      <p className="lw-dialog-intro">노트는 이 브라우저에만 저장되고 AI에는 보내지 않습니다. 글을 선택한 뒤 Alt+Shift+N을 눌러 도구로 이동할 수도 있습니다.</p>
      <section className="np-section" aria-labelledby="np-selected-title">
        <h3 id="np-selected-title">선택한 글</h3>
        {target && quote ? <>
          <p className="np-item-quote" lang="en">{readable(quote)}</p>
          <p className="np-item-actions">
            <button type="button" onClick={() => { notes.createMark(target, "underline"); }}>밑줄</button>
            <button type="button" onClick={() => { notes.createMark(target, "yellow"); }}>노란 형광펜</button>
            <button type="button" onClick={() => { notes.createMark(target, "rose"); }}>분홍 형광펜</button>
            <button type="button" onClick={() => { if (notes.startMemo(target)) close(false); }}>메모</button>
          </p>
        </> : <p className="lw-muted">선택한 글이 없습니다. 문서에서 글을 드래그하거나 Shift+방향키로 고른 뒤 이 창을 열면 여기서 밑줄·형광펜·메모를 고를 수 있습니다.</p>}
        {notes.notice && <p className="np-bar-note" role="status">{notes.notice}</p>}
      </section>
      <section className="np-section" aria-labelledby="np-list-title">
        <h3 id="np-list-title">이 수업의 노트 {found.length}개</h3>
        {found.length ? <ol className="np-list">{found.map(note => item(note, false))}</ol> : <p className="lw-muted">아직 노트가 없습니다.</p>}
      </section>
      {lost.length > 0 && <section className="np-section" aria-labelledby="np-lost-title">
        <h3 id="np-lost-title">이 글을 찾지 못한 노트 {lost.length}개</h3>
        <p className="lw-muted">자료가 고쳐져 노트를 단 글을 문서에서 찾지 못했습니다. 노트는 지우지 않고 그대로 보관합니다.</p>
        <ol className="np-list">{lost.map(note => item(note, true))}</ol>
      </section>}
      {confirmed && <p className="lw-muted" role="status">{confirmed}</p>}
      <SaveWarning store={notes} />
    </div>
  </dialog>;
}

/* ---------- places for the lesson screens ---------- */

export function NotesButton() {
  const notes = useNotes();
  if (!notes) return null;
  const count = notes.notes.length;
  return <button type="button" className="np-trigger" ref={notes.triggerRef} aria-haspopup="dialog" aria-keyshortcuts="Alt+Shift+N" aria-label={count ? `노트 ${count}개` : "노트"} title="노트 (Alt+Shift+N)"
    onPointerDown={() => { notes.hold.current = performance.now() + 1500; }} onClick={() => { notes.hold.current = 0; notes.setPanelOpen(true); }}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 20 4-1 11-11-3-3L5 16l-1 4ZM14 7l3 3" /></svg>
    <span>노트{count ? ` ${count}개` : ""}</span>{count > 0 && <b className="np-trigger-count" aria-hidden="true">{count}</b>}
  </button>;
}

/** "노트 N개" for the outline's summary. A fact only. */
export function NotesFact() {
  const notes = useNotes();
  return notes && notes.notes.length > 0 ? <p>노트 {notes.notes.length}개</p> : null;
}

/** What went wrong with the stored notes, at the top of the document: an unreadable file, a failed save. */
export function NotesBanner() {
  const notes = useNotes();
  if (!notes || !notes.ready || (!notes.loadNotice && notes.saveState !== "failed")) return null;
  return <div className="np-banner">
    {notes.loadNotice && <p role="status">{notes.loadNotice} <button type="button" onClick={notes.dismissLoadNotice}>알겠습니다</button></p>}
    <SaveWarning store={notes} />
  </div>;
}

/**
 * Notes on the story body while the body is covered. Only the kind of mark and the memo show: the noted text is the story
 * itself and stays covered with it.
 */
export function CoveredNotes({ isBody }: { isBody: (block: string) => boolean }) {
  const notes = useNotes();
  if (!notes || !notes.ready) return null;
  const own = notes.notes.filter(note => isBody(note.block)).sort((a, b) => notes.rank(a) - notes.rank(b) || a.createdAt - b.createdAt);
  if (own.length === 0) return null;
  return <details className="np-covered">
    <summary>본문에 단 노트 {own.length}개</summary>
    <p className="lw-muted">본문을 가린 동안은 표시한 종류와 메모만 보입니다. 본문을 확인하면 노트가 글에 다시 보입니다.</p>
    <ul>{own.map(note => <li key={note.id}><b>{markLabel[note.mark]}</b>{note.memo ? <span className="np-item-memo"> {note.memo}</span> : <span className="lw-muted"> · 메모 없음</span>}</li>)}</ul>
  </details>;
}
