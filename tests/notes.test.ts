import assert from "node:assert/strict";
import { test } from "node:test";
import { cardBlocks, cardSentenceRuns, haveBlocks, haveSourceRuns, isClosedCardBlock, isStoryBodyKey, storyBlocks } from "../lib/note-blocks";
import {
  GAP_CHAR, addNote, clearMark, cleanMemo, locateNote, makeNote, noteFileText, noteLimits, noteStorageKey, placeNotes, readNotes, readable, removeNote, runsText, segmentsOf, setMemo, trimSpan, type Note,
} from "../lib/notes";
import { getPublicLesson } from "../lib/server/lesson-catalog";
import { getStudySource } from "../lib/server/study-source";
import { REFERENCE_IDS } from "../lib/reference-materials";

const text = "The old man smiled. The old man left, and the old dog stayed.";
const note = (over: Partial<Note> = {}): Note => ({ id: "n1", block: "body-0", quote: "old dog", prefix: "ft, and the ", suffix: " stayed.", start: text.indexOf("old dog"), mark: "yellow", memo: "", createdAt: 1, ...over });
const made = (start: number, end: number, mark: Note["mark"] = "underline", id = "n1") => makeNote({ id, block: "body-0", text, start, end, mark, now: 5 })!;

test("a note keeps the exact quote, trimmed, with the characters around it", () => {
  const n = made(text.indexOf(" old dog") , text.indexOf(" stayed"));
  assert.equal(n.quote, "old dog");
  assert.equal(n.prefix, "ft, and the ");
  assert.equal(n.suffix, " stayed.");
  assert.equal(n.start, text.indexOf("old dog"));
  assert.deepEqual(trimSpan("  a b \n", 0, 7), { start: 2, end: 5 });
  assert.equal(trimSpan("   ", 0, 3), null);
  assert.equal(trimSpan(`${GAP_CHAR} ${GAP_CHAR}`, 0, 3), null);
  assert.equal(makeNote({ id: "x", block: "b", text, start: 3, end: 3, mark: "underline", now: 1 }), null);
  assert.equal(makeNote({ id: "x", block: "b", text: "a".repeat(noteLimits.quote + 1), start: 0, end: noteLimits.quote + 1, mark: "underline", now: 1 }), null);
  assert.equal(made(10, 3).quote, text.slice(3, 10).trim());
});

test("a note is found again by its quote; among repeats the matching neighbours decide", () => {
  const dog = text.indexOf("old dog");
  assert.deepEqual(locateNote(text, note()), { start: dog, end: dog + 7 });
  const man = made(text.indexOf("old man left"), text.indexOf("old man left") + 3, "underline"); // "old" in "The old man left"
  assert.equal(man.quote, "old");
  const at = locateNote(text, man)!;
  assert.equal(text.slice(at.start - 4, at.end + 9), "The old man left");
  // The same text with a sentence added before: the offset hint is wrong but the neighbours still pick the place.
  const moved = `Long ago it rained. ${text}`;
  const again = locateNote(moved, man)!;
  assert.equal(moved.slice(again.start - 4, again.end + 9), "The old man left");
  // Two equal places with no neighbour to tell them apart: the one nearest the old offset.
  const twins = { quote: "go", prefix: "", suffix: "", start: 8 };
  assert.deepEqual(locateNote("go go go go", twins), { start: 9, end: 11 });
});

test("a note whose text is gone is not found, and a short quote is not attached to a different place", () => {
  assert.equal(locateNote("Nothing like it here.", note()), null);
  assert.equal(locateNote("", note()), null);
  // "the" is in the new text, but both neighbours changed: that is another place.
  assert.equal(locateNote("Every rabbit in the garden slept.", { quote: "the", prefix: "left, and ", suffix: " old dog stayed", start: 40 }), null);
  // One neighbour changed: still the same place.
  assert.deepEqual(locateNote("He left, and the cat stayed.", { quote: "the", prefix: "left, and ", suffix: " old dog stayed", start: 9 }), { start: 13, end: 16 });
  // A long quote needs no neighbours.
  const long = "a very particular sentence of some length";
  assert.deepEqual(locateNote(`xx ${long} yy`, { quote: long, prefix: "zzzz", suffix: "qqqq", start: 0 }), { start: 3, end: 3 + long.length });
  assert.equal(locateNote("abc", { quote: "", prefix: "", suffix: "", start: 0 }), null);
});

test("placements are in text order and segments cut at every boundary, with overlaps", () => {
  const a = note({ id: "a", quote: "old man", prefix: "The ", suffix: " smiled.", start: 4, mark: "underline" });
  const b = note({ id: "b", quote: "man smiled", prefix: "The old ", suffix: ". The old", start: 8, mark: "rose" });
  const placed = placeNotes(text, [b, a, note({ id: "c", quote: "gone" })]);
  assert.deepEqual(placed.map(item => item.note.id), ["a", "b"]);
  const segments = segmentsOf(text.length, placed);
  assert.equal(segments.map(segment => text.slice(segment.start, segment.end)).join(""), text);
  const covered = segments.filter(segment => segment.ids.length).map(segment => ({ part: text.slice(segment.start, segment.end), ids: segment.ids }));
  assert.deepEqual(covered, [{ part: "old ", ids: ["a"] }, { part: "man", ids: ["a", "b"] }, { part: " smiled", ids: ["b"] }]);
  assert.deepEqual(segmentsOf(5, []), [{ start: 0, end: 5, ids: [] }]);
});

test("the list of notes: limit, memo, clearing a mark and removing", () => {
  let notes: Note[] = [];
  for (let index = 0; index < noteLimits.notes; index++) { const result = addNote(notes, note({ id: `n${index}` })); assert.ok(result.ok); if (result.ok) notes = result.notes; }
  const full = addNote(notes, note({ id: "extra" }));
  assert.equal(full.ok, false);
  assert.equal(addNote(notes.slice(1), note({ id: "extra" }), 1).ok, false, "a memo being typed holds a place");
  assert.equal(addNote(notes.slice(2), note({ id: "extra" }), 1).ok, true);

  const one = [note({ mark: "yellow" })];
  assert.equal(setMemo(one, "n1", "  hello  ")[0].memo, "hello");
  assert.equal(setMemo(one, "n1", "")[0].memo, "");
  assert.equal(setMemo([note({ mark: "none", memo: "x" })], "n1", "   ").length, 0, "a memo-only note without a memo is removed");
  assert.equal(cleanMemo("가".repeat(noteLimits.memo + 30)).length, noteLimits.memo);
  assert.equal(cleanMemo("😀".repeat(noteLimits.memo + 1)).length, noteLimits.memo * 2, "counted in characters, not code units");
  assert.deepEqual(clearMark([note({ memo: "m" })], "n1").map(item => [item.mark, item.memo]), [["none", "m"]]);
  assert.equal(clearMark([note()], "n1").length, 0);
  assert.equal(removeNote([note(), note({ id: "n2" })], "n1").length, 1);
});

test("stored notes: a lesson's own file round-trips and anything off makes that lesson's file unusable", () => {
  assert.equal(noteStorageKey("titanic-have"), "english-sense-notes-v1:titanic-have");
  assert.deepEqual(readNotes(null, "a"), { ok: true, notes: [] });
  const good = [note(), note({ id: "n2", mark: "none", memo: "여백에 쓴 글", quote: "old man", prefix: "The ", suffix: " smiled.", start: 4 })];
  const raw = noteFileText("a", good);
  assert.deepEqual(readNotes(raw, "a"), { ok: true, notes: good });
  const bad = (value: unknown) => { const result = readNotes(typeof value === "string" ? value : JSON.stringify(value), "a"); assert.equal(result.ok, false); return result.ok ? "" : result.message; };
  assert.match(bad("{not json"), /이 수업의 노트만 비우고/);
  assert.match(bad(raw.replace('"lesson":"a"', '"lesson":"b"')), /형식/);
  bad({ v: 2, lesson: "a", notes: [] });
  bad({ v: 1, lesson: "a", notes: [], extra: 1 });
  bad({ v: 1, lesson: "a" });
  bad({ v: 1, lesson: "a", notes: [{ ...note(), extra: 1 }] });
  const { memo: _memo, ...noMemo } = note();
  bad({ v: 1, lesson: "a", notes: [noMemo] });
  bad({ v: 1, lesson: "a", notes: [note({ id: "bad id!" })] });
  bad({ v: 1, lesson: "a", notes: [note({ block: "" })] });
  bad({ v: 1, lesson: "a", notes: [note({ quote: "" })] });
  bad({ v: 1, lesson: "a", notes: [note({ quote: " padded " })] });
  bad({ v: 1, lesson: "a", notes: [note({ quote: "x".repeat(noteLimits.quote + 1) })] });
  bad({ v: 1, lesson: "a", notes: [note({ prefix: "x".repeat(noteLimits.context + 1) })] });
  bad({ v: 1, lesson: "a", notes: [note({ start: -1 })] });
  bad({ v: 1, lesson: "a", notes: [note({ start: 1.5 })] });
  bad({ v: 1, lesson: "a", notes: [note({ mark: "red" as never })] });
  bad({ v: 1, lesson: "a", notes: [note({ memo: "x".repeat(noteLimits.memo + 1) })] });
  bad({ v: 1, lesson: "a", notes: [note({ mark: "none", memo: "" })] });
  bad({ v: 1, lesson: "a", notes: [note({ createdAt: "now" as never })] });
  bad({ v: 1, lesson: "a", notes: [note(), note()] });
  bad({ v: 1, lesson: "a", notes: Array.from({ length: noteLimits.notes + 1 }, (_, index) => note({ id: `n${index}` })) });
  assert.equal(readNotes(noteFileText("a", Array.from({ length: noteLimits.notes }, (_, index) => note({ id: `n${index}` }))), "a").ok, true);
});

test("another lesson's notes are not read from a lesson's file, and a bad file of one lesson leaves the others usable", () => {
  const files: Record<string, string> = { [noteStorageKey("a")]: "garbage", [noteStorageKey("b")]: noteFileText("b", [note()]) };
  assert.equal(readNotes(files[noteStorageKey("a")], "a").ok, false);
  assert.equal(readNotes(files[noteStorageKey("b")], "b").ok, true);
  assert.equal(readNotes(files[noteStorageKey("b")], "a").ok, false, "a file that names another lesson is not this lesson's");
});

test("blank characters and line breaks in a block's text", () => {
  const runs = cardSentenceRuns("She ___ the ___ again.");
  assert.equal(runsText(runs), `She ${GAP_CHAR} the ${GAP_CHAR} again.`, "gap characters stand where the blanks are");
  assert.equal(readable(runsText(cardSentenceRuns("a ___ b"))), "a ___ b");
  assert.equal(runs.filter(run => "gap" in run).length, 2);
  assert.equal(cardSentenceRuns("___ first").length, 2);
  const source = haveSourceRuns("Rose", { title: "Titanic", author: "J. Cameron", path: "/x" });
  assert.equal(runsText(source), "말하는 사람: Rose · J. Cameron\nTitanic");
  assert.equal(readable(runsText(source)), "말하는 사람: Rose · J. Cameron Titanic");
  // A selection that starts at a blank is trimmed past it.
  const sentence = runsText(cardSentenceRuns("I ___ it."));
  assert.equal(makeNote({ id: "x", block: "b", text: sentence, start: 1, end: sentence.length, mark: "underline", now: 1 })!.quote, "it.");
});

test("the blocks of every lesson are public text only", async () => {
  const { reading } = getStudySource();
  for (const story of reading.stories) {
    const lesson = await getPublicLesson(story.id);
    assert.equal(lesson.kind, "story");
    if (lesson.kind !== "story") continue;
    const blocks = storyBlocks(lesson);
    for (const key of Object.keys(blocks)) assert.match(key, /^(body-\d+|q-[A-Za-z0-9_-]+-(ask|o\d+))$/, key);
    assert.equal(Object.keys(blocks).filter(isStoryBodyKey).length, lesson.paragraphs.length);
    const all = Object.values(blocks).map(runsText).join("\n");
    for (const source of story.questions) {
      assert.ok(all.includes(source.question));
      // Neither the explanation nor the basis is a block: they come only with a judgement and a block is only ever public text.
      assert.ok(!Object.values(blocks).some(runs => runsText(runs) === source.explain), `${source.id} explain`);
      if (source.basis) assert.ok(!Object.values(blocks).some(runs => runsText(runs) === source.basis), `${source.id} basis`);
    }
  }
  const cards = await getPublicLesson("wonder-unit-0");
  assert.equal(cards.kind, "cards");
  if (cards.kind === "cards") {
    // Closed cards (nothing answered yet): only the meaning and the blank sentence are blocks. Sense, example and basis are not known to the page.
    const closed = cardBlocks(cards, () => null);
    assert.equal(Object.keys(closed).length, cards.cards.length * 2);
    assert.ok(Object.keys(closed).every(key => /-(meaning|sentence)$/.test(key)), Object.keys(closed).join());
    assert.ok(cards.cards.every(card => ["sense", "example", "basis"].every(field => isClosedCardBlock(cards, `card-${card.questionId}-${field}`, () => null))));
    assert.equal(isClosedCardBlock(cards, "card-removed-card-basis", () => null), false, "a block of a card the lesson does not have is not a closed card's block");
    // With the card's text from a judgement response, its five blocks exist in the old order.
    const opened = (questionId: string) => ({ expression: "kind of", count: 3, sense: "sense text", basis: "basis text", example: { part: 1, text: `example of ${questionId}` } });
    const blocks = cardBlocks(cards, opened);
    assert.equal(Object.keys(blocks).length, cards.cards.length * 5);
    assert.deepEqual(Object.keys(blocks).slice(0, 5).map(key => key.replace(/^card-.+-/, "")), ["meaning", "sense", "example", "sentence", "basis"]);
    assert.ok(!isClosedCardBlock(cards, `card-${cards.cards[0].questionId}-sense`, opened));
    for (const card of cards.cards) {
      assert.equal(runsText(blocks[`card-${card.questionId}-sentence`]).split(GAP_CHAR).length - 1, card.drill.blanks);
      assert.ok(!Object.values(blocks).some(runs => runsText(runs).includes("answers")));
    }
  }
  const have = await getPublicLesson("titanic-have");
  assert.equal(have.kind, "scene");
  if (have.kind === "scene") {
    const blocks = haveBlocks(have, REFERENCE_IDS.map(id => ({ id, title: id, sense: "s", description: `${id} description`, href: "/", zones: [{ k: "z", ex: "ex", ctx: "ctx", lis: "lis" }] })));
    assert.ok(Object.keys(blocks).every(key => /^(have-titanic-have-\d-(ask|scene|source|o\d+)|mat-(have|get|be|go|come)-(desc|z0-(ex|ctx|lis)))$/.test(key)), Object.keys(blocks).join());
  }
});
