import type { Place, PrepData, PrepWork, ReadingData, ReadingPair, ReadingStory } from "@/lib/study-content-types";

// 읽기·사전 훈련 자료를 읽는 순수 도우미다. 정본 JSON은 서버 모듈(lib/server/study-source.ts)만 import한다.
export const getStory = (reading: ReadingData, id: string) => reading.stories.find(story => story.id === id);
export const getWork = (prep: PrepData, id: string) => prep.works.find(work => work.id === id);
export const unitPath = (work: PrepWork, n: number) => `/prep/${work.id}/unit-${n}/`;
export const workLabel = (work: PrepWork) => work.kind === "book" ? "책" : "영화";
export const cardPath = (work: PrepWork, n: number, cardId: string) => `${unitPath(work, n)}#${cardId}`;
/** 사전 훈련 유닛과 짝을 이루는 이야기들 */
export const pairStories = <S extends { pair?: ReadingPair }>(reading: { stories: S[] }, workId: string, n: number) => reading.stories.filter(story => story.pair?.work === workId && story.pair.unit === n);
/** 짝 이야기의 작품과 유닛. 짝이 없거나 사전 훈련에 없으면 undefined */
export function storyPair(prep: PrepData, story: ReadingStory) {
  if (!story.pair) return undefined;
  const work = getWork(prep, story.pair.work);
  const unit = work?.units.find(u => u.n === story.pair!.unit);
  return work && unit ? { work, unit } : undefined;
}
export const cardCount = (work: PrepWork) => work.units.reduce((sum, unit) => sum + unit.cards.length, 0);

/** 카드 문장의 출처. 예: "Wonder (R. J. Palacio, 2012) · 8부", "Zootopia (2016) · 01:21:09" */
export function sourceLabel(work: PrepWork, place: Place) {
  const credit = work.creator ? `${work.creator}, ${work.year}` : String(work.year);
  return `${work.title} (${credit}) · ${"part" in place ? `${place.part}부` : place.time}`;
}

function minutesLabel(seconds: number) {
  return seconds % 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds / 60}분`;
}
export { minutesLabel };

/** 남은 시간·읽은 시간 표시: 161초 → "2:41" */
export function clockLabel(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
