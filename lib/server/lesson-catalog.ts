import { getLessonEntry, type LessonEntry, type PublicCard, type PublicCardsLesson, type PublicStoryLesson } from "../lesson-registry";
import { splitBlanks } from "../fill-blank";
import type { PublicLearningCatalog } from "../learning-catalog";
import type { PrepCard, PrepUnit, PrepWork, ReadingQuestion, ReadingStory } from "../study-content-types";
import { getStudySource } from "./study-source";
import { getPublicLearningCatalog } from "./learning-catalog";

/** 서버 정본의 한 수업. 이야기의 `answer`·`explain`·`basis`와 카드의 `drill.answers`를 그대로 담는다. */
export type ServerLesson =
  | { kind: "story"; lessonId: string; story: ReadingStory }
  | { kind: "cards"; lessonId: string; work: PrepWork; unit: PrepUnit };

export type PublicLesson = PublicStoryLesson | PublicCardsLesson | ({ kind: "scene" } & PublicLearningCatalog);

/** 정본 한 문항. 이야기는 보기 번호와 해설, 카드는 빈칸 정답을 담는다. */
export type ServerLessonQuestion =
  | { kind: "story"; lessonId: string; questionId: string; question: ReadingQuestion }
  | { kind: "cards"; lessonId: string; questionId: string; card: PrepCard };

function sha256(value: unknown): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))
    .then(buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join(""));
}

/** 정본에서 수업 목록용 문항 ID를 만든다. lib/lesson-registry-data.ts가 이와 같은지 단위 검사가 비교한다. */
export function buildLessonData() {
  const { reading, prep } = getStudySource();
  return {
    stories: reading.stories.map(story => [story.id, ...story.questions.map(question => question.id)] as [string, ...string[]]),
    units: prep.works.flatMap(work => work.units.map(unit => [work.id, unit.n, ...unit.cards.map(card => card.id)] as [string, number, ...string[]])),
  };
}

/** lib/lesson-registry-data.ts의 본문. 한 수업을 한 줄에 쓴다. */
export function renderLessonData(data: ReturnType<typeof buildLessonData>) {
  const row = (items: readonly (string | number)[]) => `    ${JSON.stringify(items)},`;
  return [
    "// scripts/generate-lesson-registry.ts가 정본에서 만든다. 손으로 고치지 않는다.",
    "export const LESSON_DATA: { stories: readonly (readonly [string, ...string[]])[]; units: readonly (readonly [string, number, ...string[]])[] } = {",
    "  stories: [", ...data.stories.map(row), "  ],",
    "  units: [", ...data.units.map(row), "  ],",
    "};",
    "",
  ].join("\n");
}

/** 이야기 수업의 정본. 알 수 없는 ID와 다른 종류의 수업은 거절한다. */
function serverLesson(entry: LessonEntry): ServerLesson {
  const { reading, prep } = getStudySource();
  if (entry.kind === "story") {
    const story = reading.stories.find(item => item.id === entry.storyId);
    if (story) return { kind: "story", lessonId: entry.lessonId, story };
  } else if (entry.kind === "cards") {
    const work = prep.works.find(item => item.id === entry.workId);
    const unit = work?.units.find(item => item.n === entry.unit);
    if (work && unit) return { kind: "cards", lessonId: entry.lessonId, work, unit };
  }
  throw new Error("lesson_unavailable");
}

/** 정본 조회. 장면(`titanic-have`)은 기존 학습 정본(`getServerLearningQuestion`)이 맡으므로 여기서 다루지 않는다. */
export function getServerLesson(lessonId: unknown): ServerLesson {
  const entry = getLessonEntry(lessonId);
  if (!entry || entry.kind === "scene") throw new Error("lesson_unavailable");
  return serverLesson(entry);
}

/** 수업별 자료 판: 공개 필드와 정본 필드를 모두 포함한 정본의 SHA-256. 초안을 고치면 그 수업의 판만 바뀐다. */
export async function getLessonContentVersion(lessonId: unknown): Promise<string> {
  const entry = getLessonEntry(lessonId);
  if (!entry) throw new Error("lesson_unavailable");
  if (entry.kind === "scene") return (await getPublicLearningCatalog()).contentVersion;
  const lesson = serverLesson(entry);
  return sha256(lesson.kind === "story" ? lesson.story : { work: lesson.work.id, unit: lesson.unit });
}

function publicCard(card: PrepCard): PublicCard {
  return {
    questionId: card.id, expression: card.expression, count: card.count, ...(card.countInPart !== undefined ? { countInPart: card.countInPart } : {}),
    meaning: card.meaning, sense: card.sense, basis: card.basis, example: { ...card.example },
    drill: { ..."part" in card.drill ? { part: card.drill.part } : { time: card.drill.time }, sentence: card.drill.sentence, hint: card.drill.hint, blanks: splitBlanks(card.drill.sentence).length - 1 },
  };
}

/** 브라우저로 나가는 유일한 투영. 이야기의 `answer`·`explain`·`basis`와 카드의 `drill.answers`는 여기서 뺀다. */
export async function getPublicLesson(lessonId: unknown): Promise<PublicLesson> {
  const entry = getLessonEntry(lessonId);
  if (!entry) throw new Error("lesson_unavailable");
  if (entry.kind === "scene") return { kind: "scene", ...(await getPublicLearningCatalog()) };
  const lesson = serverLesson(entry);
  const contentVersion = await getLessonContentVersion(entry.lessonId);
  if (lesson.kind === "story") {
    const { story } = lesson;
    return {
      kind: "story", lessonId: lesson.lessonId, contentVersion, title: story.title, words: story.words, limitSeconds: story.limitSeconds, draft: story.draft,
      ...(story.pair ? { pair: { ...story.pair } } : {}),
      paragraphs: story.paragraphs.map(paragraph => paragraph.map(inline => ({ ...inline }))),
      questions: story.questions.map(question => ({
        questionId: question.id, kind: question.kind, question: question.question, options: [...question.options],
        ...(question.card ? { card: question.card } : {}),
      })),
    };
  }
  const { work, unit } = lesson;
  return {
    kind: "cards", lessonId: lesson.lessonId, contentVersion,
    work: { id: work.id, kind: work.kind, title: work.title, ...(work.creator ? { creator: work.creator } : {}), year: work.year },
    unit: { n: unit.n, when: unit.when, summary: unit.summary },
    cards: unit.cards.map(publicCard),
  };
}

/** 정본 한 문항(정답·해설 포함). 판정이 쓴다. 장면 수업은 기존 `getServerLearningQuestion`을 쓴다. */
export function getServerLessonQuestion(lessonId: unknown, questionId: unknown): ServerLessonQuestion {
  const lesson = getServerLesson(lessonId);
  if (lesson.kind === "story") {
    const question = lesson.story.questions.find(item => item.id === questionId);
    if (question) return { kind: "story", lessonId: lesson.lessonId, questionId: question.id, question };
  } else {
    const card = lesson.unit.cards.find(item => item.id === questionId);
    if (card) return { kind: "cards", lessonId: lesson.lessonId, questionId: card.id, card };
  }
  throw new Error("lesson_question_unavailable");
}
