import { namesExpression, type CardLessonView } from "../card-lesson";
import { unitLessonId } from "../lesson-registry";
import { getWork, pairStories, unitPath } from "../study-content";
import { getPublicLesson } from "./lesson-catalog";
import { getStudySource } from "./study-source";

/**
 * What a unit page (`/prep/<작품>/unit-<n>/`) hands the browser: the public projection of the cards lesson
 * (never `drill.answers`, and no expression, count, sense, example or basis: those open with the first answer), neighbouring units
 * and the stories written with these expressions (a story whose title names one of the unit's expressions is listed without its title).
 * Returns null for a unit that does not exist.
 */
export async function getCardLessonView(workId: string, n: number): Promise<CardLessonView | null> {
  const { reading, prep } = getStudySource();
  const work = getWork(prep, workId), index = work?.units.findIndex(unit => unit.n === n) ?? -1;
  if (!work || index < 0) return null;
  const lesson = await getPublicLesson(unitLessonId(work.id, n));
  if (lesson.kind !== "cards") return null;
  const link = (unit: (typeof work.units)[number] | undefined) => unit ? { n: unit.n, when: unit.when, href: unitPath(work, unit.n) } : null;
  return {
    lesson, countLabel: work.kind === "book" ? "책 전체" : "영화 전체", listHref: `/prep/${work.id}/`,
    prev: link(work.units[index - 1]), next: link(work.units[index + 1]),
    pairs: pairStories(reading, work.id, n).map(story => ({ id: story.id, title: namesExpression(story.title, work.units[index].cards.map(card => card.expression)) ? null : story.title, words: story.words, limitSeconds: story.limitSeconds, draft: story.draft, questions: story.questions.length })),
  };
}
