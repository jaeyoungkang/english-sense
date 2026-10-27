// study-and-learn의 읽기·사전 훈련 자료를 웹앱에 옮긴 모양. 정본은 study-and-learn이고, 이 모양은
// scripts/import-study-content.ts가 만든다.

export type Inline = { text: string; em?: true };
export type ReadingQuestion = {
  id: string;
  kind: "content" | "sense";
  question: string;
  options: string[];
  answer: number;
  explain: string;
  basis?: string;
};
export type ReadingStory = {
  id: string;
  title: string;
  words: number;
  limitSeconds: number;
  draft: boolean;
  paragraphs: Inline[][];
  questions: ReadingQuestion[];
};
export type ReadingData = { stories: ReadingStory[] };

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
