// study-and-learn의 읽기·사전 훈련 자료를 웹앱에 옮긴 모양. 정본은 study-and-learn이고, 이 모양은
// scripts/import-study-content.ts가 만든다.

export type Inline = { text: string; em?: true };
export type ReadingQuestion = {
  id: string;
  kind: "content" | "sense" | "expression";
  question: string;
  options: string[];
  answer: number;
  explain: string;
  basis?: string;
  /** expression 문제가 묻는 사전 훈련 카드의 id */
  card?: string;
};
/** 사전 훈련 유닛과 짝을 이루는 이야기의 그 유닛. */
export type ReadingPair = { work: string; unit: number };
export type ReadingStory = {
  id: string;
  title: string;
  words: number;
  limitSeconds: number;
  draft: boolean;
  pair?: ReadingPair;
  paragraphs: Inline[][];
  questions: ReadingQuestion[];
};
export type ReadingData = { stories: ReadingStory[] };
/** 목록과 짝 링크에 필요한 이야기 정보. 문항을 담지 않으므로 정답·해설이 브라우저 쪽 산출물로 가지 않는다. */
export type ReadingSummaryStory = { id: string; title: string; words: number; limitSeconds: number; draft: boolean; pair?: ReadingPair; questionCount: number };
export type ReadingSummary = { stories: ReadingSummaryStory[] };

/** 예문과 빈칸 문장의 자리. 책은 부 번호, 영화는 대사의 타임코드다. */
export type Place = { part: number } | { time: string };
export type PrepCard = {
  id: string;
  expression: string;
  count: number;
  countInPart?: number;
  meaning: string;
  sense: string;
  basis: string;
  example: Place & { text: string };
  drill: Place & { sentence: string; answers: string[]; hint: string };
};
export type PrepUnit = { n: number; when: string; summary: string; cards: PrepCard[] };
export type PrepWork = {
  id: string;
  kind: "book" | "movie";
  title: string;
  creator?: string;
  year: number;
  parts?: { n: number; narrator: string; words: number }[];
  units: PrepUnit[];
};
export type PrepData = { works: PrepWork[] };
