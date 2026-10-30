import { ARTIFACT_LESSON_ID, LEARNING_QUESTION_IDS } from "./learning-catalog";
import type { Place } from "./study-content-types";
import { LESSON_DATA } from "./lesson-registry-data";

/** 수업·문항 ID 규칙. 기록과 요청 계약의 `identity`와 같다. */
export const LESSON_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export type LessonKind = "scene" | "story" | "cards";

/** 수업 하나의 식별과 문항 목록. 정답·해설을 담지 않으므로 브라우저 모듈도 import해도 된다. */
export type LessonEntry =
  | { lessonId: typeof ARTIFACT_LESSON_ID; kind: "scene"; path: "/practice/have/"; questionIds: readonly string[] }
  | { lessonId: string; kind: "story"; path: string; storyId: string; questionIds: readonly string[] }
  | { lessonId: string; kind: "cards"; path: string; workId: string; unit: number; questionIds: readonly string[] };

/**
 * 문서 순서가 고정된 수업 목록: 장면 1, 이야기 15, 카드(작품별 유닛) 13.
 * ID는 원본 ID에서 만들고 순서에서 만들지 않는다. 이야기는 이야기 ID, 문항은 원본 문항 ID,
 * 카드 수업은 `<작품>-unit-<n>`, 카드 문항은 카드 ID다.
 * 이야기·카드 목록(lesson-registry-data.ts)은 정본에서 만든다: `npx tsx scripts/generate-lesson-registry.ts`.
 */
export const LESSONS: readonly LessonEntry[] = [
  { lessonId: ARTIFACT_LESSON_ID, kind: "scene", path: "/practice/have/", questionIds: LEARNING_QUESTION_IDS },
  ...LESSON_DATA.stories.map(([storyId, ...questionIds]): LessonEntry => ({ lessonId: storyId, kind: "story", path: `/reading/${storyId}/`, storyId, questionIds })),
  ...LESSON_DATA.units.map(([workId, unit, ...questionIds]): LessonEntry => ({ lessonId: unitLessonId(workId, unit), kind: "cards", path: `/prep/${workId}/unit-${unit}/`, workId, unit, questionIds })),
];

export function unitLessonId(workId: string, unit: number) {
  return `${workId}-unit-${unit}`;
}

const byId = new Map<string, LessonEntry>(LESSONS.map(entry => [entry.lessonId, entry]));

/** 알 수 없는 ID(`__proto__` 포함)는 undefined다. */
export function getLessonEntry(lessonId: unknown): LessonEntry | undefined {
  return typeof lessonId === "string" ? byId.get(lessonId) : undefined;
}

export function hasLessonQuestion(entry: LessonEntry, questionId: unknown) {
  return typeof questionId === "string" && entry.questionIds.includes(questionId);
}

/** 이야기 수업의 공개 문항: 종류·발문·보기. `answer`·`explain`·`basis`는 서버 정본에만 있다. */
export type PublicStoryQuestion = {
  questionId: string;
  kind: "content" | "sense" | "expression";
  question: string;
  options: string[];
  /** expression 문제가 묻는 카드의 id. 카드에서 다시 보기 링크에 쓴다. */
  card?: string;
};
export type PublicStoryLesson = {
  kind: "story";
  lessonId: string;
  contentVersion: string;
  title: string;
  words: number;
  limitSeconds: number;
  draft: boolean;
  pair?: { work: string; unit: number };
  paragraphs: { text: string; em?: true }[][];
  questions: PublicStoryQuestion[];
};

/** 이야기 수업 화면의 짝 링크: 짝 유닛과, expression 문항이 묻는 카드로 가는 주소. 표현·주소만 담으며 정답이 아니다. */
export type StoryLessonLinks = {
  pair?: { workTitle: string; unit: number; href: string };
  cards: Record<string, { href: string; expression: string }>;
};

/**
 * 카드 수업의 공개 카드: 첫 답 전에 보이는 것만 담는다(뜻·빈칸 문장·한국어 힌트·출처 자리·빈칸 수).
 * 표현·횟수·감각·예문·근거는 서버에만 두고 첫 판정 응답의 `card`(`OpenedCard`)로 열린다. 빈칸 정답(`drill.answers`)은 응답에도 없다.
 */
export type PublicCard = {
  questionId: string;
  meaning: string;
  drill: Place & { sentence: string; hint: string; blanks: number };
};
export type PublicCardsLesson = {
  kind: "cards";
  lessonId: string;
  contentVersion: string;
  work: { id: string; kind: "book" | "movie"; title: string; creator?: string; year: number };
  unit: { n: number; when: string; summary: string };
  cards: PublicCard[];
};
