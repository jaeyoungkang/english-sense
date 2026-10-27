import type { PrepSummary, ReadingSummary } from "./study-content-types";
import { unitPath } from "./study-content";

/**
 * 홈의 "수업 목록" 창이 보이는 이야기·유닛 목록. 제목과 기존 주소뿐이고 문항·카드·정답을 담지 않는다.
 * 서버가 목록용 공개 요약에서 만들어 props로 넘긴다. 수업 레지스트리(문항 ID 약 350개)는 브라우저로 가지 않는다.
 */
export type LessonListing = {
  stories: { title: string; href: string; draft: boolean }[];
  works: { title: string; kind: "book" | "movie"; href: string; units: { label: string; href: string }[] }[];
};

export function lessonListing(source: { reading: ReadingSummary; prep: PrepSummary }): LessonListing {
  return {
    stories: source.reading.stories.map(story => ({ title: story.title, href: `/reading/${story.id}/`, draft: story.draft })),
    works: source.prep.works.map(work => ({
      title: work.title, kind: work.kind, href: `/prep/${work.id}/`,
      units: work.units.map(unit => ({ label: `유닛 ${unit.n} · ${unit.when}`, href: unitPath(work, unit.n) })),
    })),
  };
}
