import prompt from "./prompt.json";
import { getStudySource } from "./study-source";
import type { ServerLessonQuestion } from "./lesson-catalog";

/** 한 수업의 AI 맥락에 넣는 표제어의 상한. 항목 하나가 길지 않아도 맥락이 부풀지 않게 묶는다. */
export const SENSE_ENTRY_LIMIT = 3;

/**
 * 감각 사전(해설기의 `prompt.json`)의 표제어 31개와 그 표 한 줄. 줄은 사전의 문자열 그대로이고,
 * 사전을 한 곳(`prompt.json`)에만 두려고 여기서 새로 적지 않고 표에서 읽는다.
 */
const dictionary = (() => {
  const rules = prompt.rules;
  const rows = new Map<string, string>();
  for (const line of rules.slice(rules.indexOf("감각 사전\n")).split("\n")) {
    const head = /^\| ([a-z]+) \|/.exec(line);
    if (head) rows.set(head[1], line);
  }
  return rows;
})();

export const SENSE_TABLE_HEADER = "| 표제어 | 이미지 | 뉘앙스 | 예시 |";

/** 표제어의 사전 줄. 사전에 없으면 undefined. */
export function senseEntry(headword: string): string | undefined {
  return dictionary.get(headword);
}

export function senseHeadwords(): string[] {
  return [...dictionary.keys()];
}

/** 표제어가 문장에서 꼴을 바꾼 것. 규칙 변화(looked, takes)는 빠르게 기본형으로 접고, 불규칙한 것만 적는다. */
const irregular: Record<string, string> = {
  got: "get", gotten: "get", gets: "get", getting: "get",
  went: "go", gone: "go", goes: "go", going: "go",
  came: "come", comes: "come", coming: "come",
  puts: "put", putting: "put",
  took: "take", taken: "take", takes: "take", taking: "take",
  sets: "set", setting: "set",
  held: "hold", holds: "hold", holding: "hold",
  kept: "keep", keeps: "keep", keeping: "keep",
  ran: "run", runs: "run", running: "run",
  looks: "look", looked: "look", looking: "look",
  am: "be", is: "be", are: "be", was: "be", were: "be", been: "be", being: "be",
  has: "have", had: "have", having: "have",
  made: "make", makes: "make", making: "make",
  gave: "give", given: "give", gives: "give", giving: "give",
};

/** 거의 모든 영어 문장에 들어가는 말. 지금 질문에서는 따옴표나 한국어 사이에 따로 언급했을 때만 센다. */
const weak = new Set(["to", "of", "as", "at", "in", "on", "be"]);

function headwordOf(token: string): string | undefined {
  const word = token.toLowerCase();
  return dictionary.has(word) ? word : irregular[word];
}

/** 글에 나오는 표제어를 나온 순서대로, 겹치지 않게. */
export function findHeadwords(text: string): string[] {
  const found: string[] = [];
  for (const token of text.match(/[A-Za-z]+/g) ?? []) {
    const headword = headwordOf(token);
    if (headword && !found.includes(headword)) found.push(headword);
  }
  return found;
}

/**
 * 학습자의 지금 질문에서 표제어를 찾는다. 질문은 한국어 문장 속에 영어를 섞는 일이 많아서, `to`·`of` 같은 말은
 * 영어 문장의 일부일 때가 많다. 이런 말은 따옴표나 한국어 글자, 쉼표·빗금 사이에서 따로 불렀을 때만 센다.
 */
export function findHeadwordsInMessage(message: string): string[] {
  const found: string[] = [];
  for (const match of message.matchAll(/[A-Za-z]+/g)) {
    const headword = headwordOf(match[0]);
    if (!headword || found.includes(headword)) continue;
    if (weak.has(headword)) {
      const before = message.slice(0, match.index);
      const after = message.slice(match.index + match[0].length);
      if (!/(^|[가-힣"'“‘`(/,])\s*$/.test(before) || !/^\s*($|[가-힣"'”’`)/,.?!])/.test(after)) continue;
    }
    found.push(headword);
  }
  return found;
}

/** 근거에 "감각 사전 out", "감각 사전 look, at"처럼 이름 붙인 표제어. "모델 밖"이라고 쓴 근거는 이름이 없다. */
export function namedHeadwords(basis: string | undefined): string[] {
  const match = /^감각 사전\s+([a-z]+(?:\s*,\s*[a-z]+)*)/.exec(basis ?? "");
  return (match ? match[1].split(/\s*,\s*/) : []).filter(word => dictionary.has(word));
}

/**
 * 이 문항이 가리키는 표현. 이야기는 표현 문제의 카드와 근거가 감각 사전을 가리키는 감각 문제에서, 카드는 그 카드의 표현에서 찾는다.
 * 줄거리를 묻는 문제의 발문은 읽지 않는다. 발문과 보기에 우연히 들어 있는 in·to·get이 표제어로 잡히지 않게 하려는 것이다.
 * 정답과 해설은 읽지 않으며, 근거(`basis`)는 표제어의 이름만 읽는다.
 */
function questionTargets(question: ServerLessonQuestion): { basis?: string; expression?: string } {
  if (question.kind === "cards") return { basis: question.card.basis, expression: question.card.expression };
  const { kind, basis, card } = question.question;
  if (kind === "sense") return { basis };
  if (kind === "expression" && card) {
    const found = getStudySource().prep.works.flatMap(work => work.units.flatMap(unit => unit.cards)).find(item => item.id === card);
    if (found) return { basis: found.basis, expression: found.expression };
  }
  return {};
}

/**
 * 이번 대화에 줄 표제어를 고른다(최대 `SENSE_ENTRY_LIMIT`). 순서는 근거가 이름 붙인 것, 표현에 들어 있는 것, 지금 질문에서 언급한 것이다.
 * 사전에 없는 말은 고르지 않으며, 아무것도 고르지 못하면 빈 목록이다. 서버가 정하고 모델은 고르지 않는다.
 */
export function selectSenseHeadwords(question: ServerLessonQuestion, message = ""): string[] {
  const { basis, expression } = questionTargets(question);
  const ordered = [...namedHeadwords(basis), ...findHeadwords(expression ?? ""), ...findHeadwordsInMessage(message)];
  return [...new Set(ordered)].slice(0, SENSE_ENTRY_LIMIT);
}

/** 맥락에 넣는 감각 사전 구간. 고른 표제어의 사전 줄을 그대로 싣고, 없으면 없다고 밝힌다. */
export function senseSection(headwords: string[]): string {
  if (headwords.length === 0) return "감각 사전에서 서버가 고른 표제어: 없음 (이 표현은 감각 사전에 아직 없습니다)";
  return `감각 사전에서 서버가 고른 표제어: ${headwords.join(", ")}\n${SENSE_TABLE_HEADER}\n| --- | --- | --- | --- |\n${headwords.map(word => dictionary.get(word)!).join("\n")}`;
}
