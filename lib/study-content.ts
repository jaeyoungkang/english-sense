import type { PrepData, PrepWork, ReadingPair, ReadingStory } from "@/lib/study-content-types";

// 읽기·사전 훈련 자료를 읽는 순수 도우미다. 정본 JSON은 서버 모듈(lib/server/study-source.ts)만 import한다.
export const getWork = <W extends { id: string }>(prep: { works: W[] }, id: string) => prep.works.find(work => work.id === id);
export const unitPath = (work: Pick<PrepWork, "id">, n: number) => `/prep/${work.id}/unit-${n}/`;
export const workLabel = (work: Pick<PrepWork, "kind">) => work.kind === "book" ? "책" : "영화";
export const cardPath = (work: Pick<PrepWork, "id">, n: number, cardId: string) => `${unitPath(work, n)}#${cardId}`;
/** 사전 훈련 유닛과 짝을 이루는 이야기들 */
export const pairStories = <S extends { pair?: ReadingPair }>(reading: { stories: S[] }, workId: string, n: number) => reading.stories.filter(story => story.pair?.work === workId && story.pair.unit === n);
/** 짝 이야기의 작품과 유닛. 짝이 없거나 사전 훈련에 없으면 undefined */
export function storyPair(prep: PrepData, story: ReadingStory) {
  if (!story.pair) return undefined;
  const work = getWork(prep, story.pair.work);
  const unit = work?.units.find(u => u.n === story.pair!.unit);
  return work && unit ? { work, unit } : undefined;
}
/**
 * 유닛 요약("표현 21개(kind of 136회 …)")에서 표현 이름이 든 괄호를 걷어 낸다. 카드 표현은 첫 답을 낸 뒤에야 이름을 붙이므로,
 * 첫 답 전에 보이는 글(수업 화면, 목록, 페이지 설명)에는 이름 없는 요약을 쓴다.
 */
export function namelessSummary(summary: string) {
  const head = summary.replace(/\s*[(（].*$/s, "").trim();
  return /^\d+개$/.test(head) ? `표현 ${head}` : head;
}
export const cardCount = (work: Pick<PrepWork, "units">) => work.units.reduce((sum, unit) => sum + unit.cards.length, 0);

function minutesLabel(seconds: number) {
  return seconds % 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds / 60}분`;
}
export { minutesLabel };

/** 남은 시간·읽은 시간 표시: 161초 → "2:41" */
export function clockLabel(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
