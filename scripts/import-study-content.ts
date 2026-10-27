// study-and-learn의 읽기·책 사전 훈련·영화 사전 훈련 자료를 웹앱용 JSON으로 옮긴다.
// 실행: npx tsx scripts/import-study-content.ts <study-and-learn 경로>
// content/reading, content/book-prep, content/movie-prep만 읽는다. input/의 원문은 읽지 않는다.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BLANK } from "../lib/fill-blank";
import type { Inline, Place, PrepCard, PrepData, PrepUnit, PrepWork, ReadingData, ReadingQuestion, ReadingStory } from "../lib/study-content-types";

type Json = Record<string, unknown>;

function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}
function str(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) fail(where, "비어 있지 않은 글이어야 합니다");
  return value;
}
function int(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail(where, "0 이상의 정수여야 합니다");
  return value;
}

/** 마크다운 표에서 머리 행과 구분 행을 뺀 칸들을 돌려준다. */
export function tableRows(markdown: string, header: string[]) {
  const lines = markdown.split("\n");
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  const start = lines.findIndex(line => line.trim().startsWith("|") && header.every((name, i) => cells(line)[i] === name));
  if (start < 0) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith("|")) break;
    rows.push(cells(line));
  }
  return rows;
}

export function readJsonl(text: string, where: string): Json[] {
  return text.split("\n").filter(line => line.trim()).map((line, i) => {
    try { return JSON.parse(line) as Json; } catch { fail(`${where}:${i + 1}`, "JSON이 아닙니다"); }
  });
}

/** *기울임*만 살리고 나머지는 글자 그대로 둔다. */
export function parseInline(paragraph: string): Inline[] {
  const parts: Inline[] = [];
  paragraph.split(/(\*[^*]+\*)/).forEach(piece => {
    if (!piece) return;
    if (/^\*[^*]+\*$/.test(piece)) parts.push({ text: piece.slice(1, -1), em: true });
    else parts.push({ text: piece });
  });
  return parts;
}

export function parseStory(markdown: string, where: string) {
  const [first, ...rest] = markdown.replace(/\r\n/g, "\n").split("\n");
  const title = first.match(/^#\s+(.+)$/)?.[1]?.trim() || fail(where, "첫 줄이 제목(# ...)이 아닙니다");
  const paragraphs = rest.join("\n").split(/\n\s*\n/).map(block => block.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).map(parseInline);
  if (!paragraphs.length) fail(where, "본문이 없습니다");
  return { title, paragraphs };
}

function minutes(value: string, where: string) {
  const m = value.match(/^(\d+(?:\.\d+)?)\s*분$/) || fail(where, `제한 시간 '${value}'을 읽지 못했습니다`);
  return Math.round(Number(m[1]) * 60);
}

export function convertQuestion(raw: Json, where: string): ReadingQuestion {
  const kind = raw.kind;
  if (kind !== "content" && kind !== "sense") fail(where, "kind는 content나 sense여야 합니다");
  if (!Array.isArray(raw.options) || raw.options.length < 2) fail(where, "선택지가 둘 이상이어야 합니다");
  const options = raw.options.map((option, i) => str(option, `${where} options[${i}]`));
  const answer = int(raw.answer, `${where} answer`);
  if (answer >= options.length) fail(where, "answer가 선택지 밖입니다");
  return {
    id: str(raw.id, `${where} id`), kind, question: str(raw.question, `${where} question`), options, answer,
    explain: str(raw.explain, `${where} explain`),
    ...(raw.basis !== undefined ? { basis: str(raw.basis, `${where} basis`) } : {}),
  };
}

export function importReading(root: string): ReadingData {
  const dir = join(root, "content", "reading");
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  const rows = tableRows(readme, ["이야기", "제목", "낱말", "제한 시간"]);
  if (!rows.length) fail("reading/README.md", "이야기 표를 찾지 못했습니다");
  const questions = readJsonl(readFileSync(join(dir, "quizzes.jsonl"), "utf8"), "reading/quizzes.jsonl");
  const stories: ReadingStory[] = rows.map(row => {
    const id = row[0].replace(/`/g, "");
    const where = `reading/stories/${id}.md`;
    const { title, paragraphs } = parseStory(readFileSync(join(dir, "stories", `${id}.md`), "utf8"), where);
    const own = questions.filter(q => q.story === id).map((q, i) => convertQuestion(q, `reading/quizzes.jsonl ${id}#${i + 1}`));
    if (!own.length) fail(where, "퀴즈가 없습니다");
    return {
      id, title, words: int(Number(row[2].replace(/,/g, "")), `${where} 낱말`), limitSeconds: minutes(row[3], where),
      draft: row[row.length - 1] !== "통과", paragraphs, questions: own,
    };
  });
  const known = new Set(stories.map(story => story.id));
  const orphan = questions.find(q => !known.has(String(q.story)));
  if (orphan) fail("reading/quizzes.jsonl", `표에 없는 이야기 '${String(orphan.story)}'의 문제가 있습니다`);
  return { stories };
}

function place(raw: Json, where: string): Place {
  if (raw.part !== undefined && raw.time === undefined) return { part: int(raw.part, `${where} part`) };
  if (raw.time !== undefined && raw.part === undefined) {
    const time = str(raw.time, `${where} time`);
    if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) fail(where, `타임코드 '${time}'의 꼴이 다릅니다`);
    return { time };
  }
  fail(where, "part와 time 가운데 하나만 있어야 합니다");
}

export function convertCard(raw: Json, kind: PrepWork["kind"], where: string): PrepCard {
  const example = raw.example as Json | undefined;
  const drill = raw.drill as Json | undefined;
  if (!example || typeof example !== "object") fail(where, "example이 없습니다");
  if (!drill || typeof drill !== "object") fail(where, "drill이 없습니다");
  if (drill.type !== "fill") fail(where, "drill.type은 fill이어야 합니다");
  const sentence = str(drill.sentence, `${where} drill.sentence`);
  const answers = str(drill.answer, `${where} drill.answer`).split(" / ").map(answer => answer.trim());
  const blanks = sentence.split(BLANK).length - 1;
  if (blanks < 1 || blanks !== answers.length || answers.some(answer => !answer)) fail(where, `빈칸 ${blanks}개와 답 ${answers.length}개가 맞지 않습니다`);
  const count = kind === "book" ? raw.count_in_book : raw.count_in_movie;
  return {
    id: str(raw.id, `${where} id`), expression: str(raw.expression, `${where} expression`), count: int(count, `${where} count`),
    ...(raw.count_in_part !== undefined ? { countInPart: int(raw.count_in_part, `${where} count_in_part`) } : {}),
    meaning: str(raw.meaning_ko, `${where} meaning_ko`), sense: str(raw.sense, `${where} sense`), basis: str(raw.basis, `${where} basis`),
    example: { ...place(example, `${where} example`), text: str(example.text, `${where} example.text`) },
    drill: { ...place(drill, `${where} drill`), sentence, answers, hint: str(drill.hint_ko, `${where} drill.hint_ko`) },
  };
}

/** "- 책: R. J. Palacio, *Wonder* (Knopf, 2012)." 또는 "- 영화: *Zootopia* (Disney, 2016)." */
export function parseWorkLine(readme: string, label: "책" | "영화", where: string) {
  const line = readme.split("\n").find(l => l.startsWith(`- ${label}:`)) || fail(where, `'- ${label}:' 줄이 없습니다`);
  const m = line.match(/^- (?:책|영화):\s*(?:(.+?),\s*)?\*([^*]+)\*\s*\(([^)]*)\)/) || fail(where, `'${line}'을 읽지 못했습니다`);
  const year = Number(m[3].match(/\b(1[89]|20)\d\d\b/)?.[0] || fail(where, "연도가 없습니다"));
  return { creator: m[1]?.trim(), title: m[2].trim(), year };
}

function importWork(dir: string, id: string, kind: PrepWork["kind"], label: string): PrepWork {
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  const { creator, title, year } = parseWorkLine(readme, kind === "book" ? "책" : "영화", `${label}/README.md`);
  const unitRows = tableRows(readme, ["유닛", "언제", "담은 것"]);
  const files = readdirSync(dir).filter(name => /^unit-\d+\.jsonl$/.test(name)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!files.length) fail(label, "유닛 파일이 없습니다");
  const units: PrepUnit[] = files.map(file => {
    const n = Number(file.match(/\d+/)![0]);
    const row = unitRows.find(r => r[0] === String(n)) || fail(`${label}/README.md`, `유닛 ${n}의 표 행이 없습니다`);
    const cards = readJsonl(readFileSync(join(dir, file), "utf8"), `${label}/${file}`).map((raw, i) => convertCard(raw, kind, `${label}/${file}:${i + 1}`));
    return { n, when: row[1], summary: row[2], cards };
  });
  const parts = kind === "book" ? tableRows(readme, ["부", "화자", "낱말"]).map(r => ({ n: Number(r[0]), narrator: r[1], words: Number(r[2].replace(/,/g, "")) })) : undefined;
  return { id, kind, title, ...(creator ? { creator } : {}), year, ...(parts?.length ? { parts } : {}), units };
}

export function importPrep(root: string): PrepData {
  const works: PrepWork[] = [];
  const bookDir = join(root, "content", "book-prep");
  for (const row of tableRows(readFileSync(join(bookDir, "README.md"), "utf8"), ["책", "폴더"])) {
    const id = row[1].replace(/[`/]/g, "");
    works.push(importWork(join(bookDir, id), id, "book", `book-prep/${id}`));
  }
  const movieDir = join(root, "content", "movie-prep");
  const order = tableRows(readFileSync(join(movieDir, "README.md"), "utf8"), ["차례", "영화"]).map(r => r[1]);
  const movies = readdirSync(movieDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(movieDir, entry.name, "README.md")))
    .map(entry => importWork(join(movieDir, entry.name), entry.name, "movie", `movie-prep/${entry.name}`));
  const rank = (work: PrepWork) => { const i = order.findIndex(name => name.startsWith(`${work.title} (`)); return i < 0 ? order.length : i; };
  works.push(...movies.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)));
  const ids = works.map(work => work.id);
  if (new Set(ids).size !== ids.length) fail("prep", "작품 id가 겹칩니다");
  return { works };
}

function main() {
  const root = resolve(process.argv[2] || join(process.env.HOME || "", "study-and-learn"));
  const out = resolve(import.meta.dirname, "..", "content");
  const reading = importReading(root);
  const prep = importPrep(root);
  writeFileSync(join(out, "reading.json"), `${JSON.stringify(reading, null, 2)}\n`);
  writeFileSync(join(out, "prep.json"), `${JSON.stringify(prep, null, 2)}\n`);
  const cards = prep.works.reduce((sum, work) => sum + work.units.reduce((s, unit) => s + unit.cards.length, 0), 0);
  console.log(`이야기 ${reading.stories.length}편, 작품 ${prep.works.length}개, 카드 ${cards}장을 옮겼습니다.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
