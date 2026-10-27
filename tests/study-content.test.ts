import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkBlanks, normalizeAnswer, splitBlanks } from "../lib/fill-blank";
import { convertCard, importPrep, importReading, parseInline, parseStory, parseWorkLine, tableRows } from "../scripts/import-study-content";
import readingJson from "../content/reading.json";
import prepJson from "../content/prep.json";
import type { PrepData, ReadingData } from "../lib/study-content-types";

test("blank answers ignore case, outer and doubled spaces, curly quotes", () => {
  assert.equal(normalizeAnswer("  Let’s   GO "), "let's go");
  assert.deepEqual(checkBlanks(["I DON’T know "], ["I don't know"]), { each: [true], correct: true });
  assert.deepEqual(checkBlanks([" pick", "UP "], ["pick", "up"]), { each: [true, true], correct: true });
  assert.deepEqual(checkBlanks(["pick", "out"], ["pick", "up"]), { each: [true, false], correct: false });
  assert.equal(checkBlanks(["gonna"], ["going to"]).correct, false);
  assert.equal(checkBlanks([""], ["just"]).correct, false);
  assert.equal(checkBlanks(["pick"], ["pick", "up"]).correct, false);
  assert.deepEqual(splitBlanks("How about we ___ her ___?"), ["How about we ", " her ", "?"]);
});

test("markdown helpers read tables, titles and italics", () => {
  const md = "x\n\n| 유닛 | 언제 | 담은 것 | 상태 |\n| --- | --- | --- | --- |\n| 0 | 보기 전 | 표현 21개 | 초안 |\n\n끝";
  assert.deepEqual(tableRows(md, ["유닛", "언제", "담은 것"]), [["0", "보기 전", "표현 21개", "초안"]]);
  assert.deepEqual(parseInline("A sign said *Green Hill*."), [{ text: "A sign said " }, { text: "Green Hill", em: true }, { text: "." }]);
  const story = parseStory("# Ticket\n\nLine one\ncontinues.\n\nLine two.\n", "t");
  assert.equal(story.title, "Ticket");
  assert.deepEqual(story.paragraphs, [[{ text: "Line one continues." }], [{ text: "Line two." }]]);
  assert.throws(() => parseStory("Ticket\n\nbody", "t"), /제목/);
  assert.deepEqual(parseWorkLine("- 책: R. J. Palacio, *Wonder* (Knopf, 2012).", "책", "w"), { creator: "R. J. Palacio", title: "Wonder", year: 2012 });
  assert.deepEqual(parseWorkLine("- 영화: *The Intern* (2015, 감독 Nancy Meyers).", "영화", "w"), { creator: undefined, title: "The Intern", year: 2015 });
});

const bookCard = {
  id: "w-0-12", key: "pick-up", expression: "pick up", count_in_book: 9, meaning_ko: "데리러 가다", sense: "s", basis: "b",
  example: { part: 2, text: "She picked me up." },
  drill: { type: "fill", part: 2, sentence: "\"My mom can ___ me ___.\"", answer: "pick / up", hint_ko: "h" },
};

test("cards convert counts, places and multi-blank answers, and reject mismatches", () => {
  const card = convertCard(bookCard, "book", "t");
  assert.equal(card.count, 9);
  assert.deepEqual(card.drill, { part: 2, sentence: "\"My mom can ___ me ___.\"", answers: ["pick", "up"], hint: "h" });
  const movie = convertCard({ ...bookCard, count_in_book: undefined, count_in_movie: 4, example: { time: "00:03:41", text: "Hi." }, drill: { ...bookCard.drill, part: undefined, time: "01:00:00" } }, "movie", "t");
  assert.deepEqual([movie.count, movie.example, "time" in movie.drill && movie.drill.time], [4, { time: "00:03:41", text: "Hi." }, "01:00:00"]);
  assert.throws(() => convertCard({ ...bookCard, drill: { ...bookCard.drill, answer: "pick up" } }, "book", "t"), /빈칸 2개와 답 1개/);
  assert.throws(() => convertCard({ ...bookCard, example: { part: 1, time: "00:00:01", text: "x" } }, "book", "t"), /하나만/);
  assert.throws(() => convertCard({ ...bookCard, meaning_ko: "" }, "book", "t"), /meaning_ko/);
  assert.throws(() => convertCard({ ...bookCard, drill: { ...bookCard.drill, time: "3:41", part: undefined } }, "book", "t"), /타임코드/);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "study-"));
  const put = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put("content/reading/README.md", "| 이야기 | 제목 | 낱말 | 제한 시간 | 감각 | 상태 |\n| --- | --- | --- | --- | --- | --- |\n| `a` | A | 300 | 2분 | go | 초안 |\n| `b` | B | 1,200 | 8분 | - | 통과 |\n");
  put("content/reading/stories/a.md", "# A\n\nOne *two*.\n");
  put("content/reading/stories/b.md", "# B\n\nThree.\n");
  const q = (story: string, kind: string, extra = {}) => JSON.stringify({ id: `${story}-${kind}-1`, story, kind, question: "Q?", options: ["x", "y"], answer: 1, explain: "해설", ...extra });
  put("content/reading/quizzes.jsonl", [q("a", "content"), q("a", "sense", { basis: "감각 사전 go" }), q("b", "content")].join("\n") + "\n");
  put("content/book-prep/README.md", "| 책 | 폴더 | 상태 |\n| --- | --- | --- |\n| Bk (Au) | `bk/` | 초안 |\n");
  put("content/book-prep/bk/README.md", "- 책: Au Thor, *Bk* (Pub, 2001).\n\n| 부 | 화자 | 낱말 |\n| --- | --- | --- |\n| 1 | Ann | 1,000 |\n\n| 유닛 | 언제 | 담은 것 | 상태 |\n| --- | --- | --- | --- |\n| 0 | 읽기 전 | 하나 | 초안 |\n| 1 | 1부 앞 | 둘 | 초안 |\n");
  put("content/book-prep/bk/unit-0.jsonl", JSON.stringify(bookCard) + "\n");
  put("content/book-prep/bk/unit-1.jsonl", JSON.stringify({ ...bookCard, id: "w-1-01", count_in_part: 3 }) + "\n");
  put("content/movie-prep/README.md", "| 차례 | 영화 | 자막 | 상태 |\n| --- | --- | --- | --- |\n| 1 | Zed (1999) | 있음 | 초안 |\n| 2 | Alpha (2000) | 있음 | 초안 |\n");
  for (const [id, title, year] of [["alpha", "Alpha", 2000], ["zed", "Zed", 1999]] as const) {
    put(`content/movie-prep/${id}/README.md`, `- 영화: *${title}* (${year}).\n\n| 유닛 | 언제 | 담은 것 | 상태 |\n| --- | --- | --- | --- |\n| 0 | 보기 전 | 셋 | 초안 |\n`);
    put(`content/movie-prep/${id}/unit-0.jsonl`, JSON.stringify({ ...bookCard, id: `${id}-0-01`, count_in_book: undefined, count_in_movie: 5, example: { time: "00:00:01", text: "Hey." }, drill: { ...bookCard.drill, part: undefined, time: "00:00:02" } }) + "\n");
    put(`content/movie-prep/${id}/count_expressions.py`, "print('not read')\n");
  }
  mkdirSync(join(root, "content/movie-prep/__pycache__"));
  return root;
}

test("import reads only the reading and prep folders and keeps draft state and order", () => {
  const root = fixture();
  const reading = importReading(root);
  assert.deepEqual(reading.stories.map(s => [s.id, s.title, s.words, s.limitSeconds, s.draft, s.questions.length]), [["a", "A", 300, 120, true, 2], ["b", "B", 1200, 480, false, 1]]);
  assert.deepEqual(reading.stories[0].paragraphs, [[{ text: "One " }, { text: "two", em: true }, { text: "." }]]);
  assert.equal(reading.stories[0].questions[1].basis, "감각 사전 go");
  const prep = importPrep(root);
  assert.deepEqual(prep.works.map(w => [w.id, w.kind, w.title, w.creator, w.year]), [["bk", "book", "Bk", "Au Thor", 2001], ["zed", "movie", "Zed", undefined, 1999], ["alpha", "movie", "Alpha", undefined, 2000]]);
  assert.deepEqual(prep.works[0].parts, [{ n: 1, narrator: "Ann", words: 1000 }]);
  assert.deepEqual(prep.works[0].units.map(u => [u.n, u.when, u.cards[0].countInPart]), [[0, "읽기 전", undefined], [1, "1부 앞", 3]]);
  writeFileSync(join(root, "content/reading/quizzes.jsonl"), JSON.stringify({ id: "c", story: "c", kind: "content", question: "Q", options: ["x", "y"], answer: 0, explain: "e" }) + "\n" + JSON.stringify({ id: "a", story: "a", kind: "content", question: "Q", options: ["x", "y"], answer: 0, explain: "e" }) + "\n" + JSON.stringify({ id: "b", story: "b", kind: "content", question: "Q", options: ["x", "y"], answer: 0, explain: "e" }) + "\n");
  assert.throws(() => importReading(root), /표에 없는 이야기 'c'/);
});

test("committed JSON is well formed: every blank has an answer and every card cites its place", () => {
  const reading = readingJson as ReadingData;
  const prep = prepJson as PrepData;
  assert.ok(reading.stories.length >= 2 && reading.stories.every(s => s.limitSeconds > 0));
  for (const story of reading.stories) for (const q of story.questions) assert.ok(q.answer >= 0 && q.answer < q.options.length, q.id);
  for (const work of prep.works) for (const unit of work.units) for (const card of unit.cards) {
    assert.equal(splitBlanks(card.drill.sentence).length - 1, card.drill.answers.length, card.id);
    for (const place of [card.example, card.drill]) assert.ok(work.kind === "book" ? "part" in place : "time" in place, card.id);
  }
});
