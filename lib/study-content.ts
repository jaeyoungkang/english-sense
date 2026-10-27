import readingData from "@/content/reading.json";
import prepData from "@/content/prep.json";
import type { ContentPage } from "@/lib/content";
import type { Place, PrepData, PrepWork, ReadingData } from "@/lib/study-content-types";

export const reading = readingData as ReadingData;
export const prep = prepData as PrepData;

export const getStory = (id: string) => reading.stories.find(story => story.id === id);
export const getWork = (id: string) => prep.works.find(work => work.id === id);
export const unitPath = (work: PrepWork, n: number) => `/prep/${work.id}/unit-${n}/`;
export const workLabel = (work: PrepWork) => work.kind === "book" ? "책" : "영화";
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

/** pages.json의 공개 페이지와 같은 꼴로 읽기·사전 훈련 페이지를 만든다. */
export function studyPages(): ContentPage[] {
  const pages: ContentPage[] = [{
    path: "reading/", menu: "reading", crumbs: [["읽기", null]], type: "website",
    title: "시간 제한 읽기: 짧은 영어 이야기를 읽고 바로 퀴즈 | 영어 감각",
    description: "쉬운 영어로 쓴 짧은 이야기를 정한 시간 안에 읽고, 본문을 가린 채 내용과 표현 감각을 묻는 퀴즈를 풉니다.",
    parts: [{ kind: "reading-list" }],
  }];
  for (const story of reading.stories) pages.push({
    path: `reading/${story.id}/`, menu: "reading", crumbs: [["읽기", "/reading/"], [story.title, null]],
    title: `${story.title}${story.draft ? " (초안)" : ""}: ${minutesLabel(story.limitSeconds)} 안에 읽고 퀴즈 풀기 | 영어 감각`,
    description: `${story.words}낱말 영어 이야기 ${story.title}를 ${minutesLabel(story.limitSeconds)} 안에 읽고 ${story.questions.length}문제로 확인합니다.`,
    parts: [{ kind: "reading", id: story.id }],
  });
  pages.push({
    path: "prep/", menu: "prep", crumbs: [["사전 훈련", null]], type: "website",
    title: "책·영화 사전 훈련: 자주 나오는 표현을 미리 익히기 | 영어 감각",
    description: "영어 원서나 영화를 보기 전에, 그 작품에 자주 나오는 표현의 뜻과 감각을 카드로 익히고 작품 문장의 빈칸을 채웁니다.",
    parts: [{ kind: "prep-list" }],
  });
  for (const work of prep.works) {
    pages.push({
      path: `prep/${work.id}/`, menu: "prep", crumbs: [["사전 훈련", "/prep/"], [work.title, null]],
      title: `${work.title} 사전 훈련: ${workLabel(work)}에 자주 나오는 영어 표현 | 영어 감각`,
      description: `${work.title}(${work.year})에 자주 나오는 영어 표현 ${cardCount(work)}개를 유닛 ${work.units.length}개로 나눠 미리 익힙니다.`,
      parts: [{ kind: "prep-work", id: work.id }],
    });
    for (const unit of work.units) pages.push({
      path: unitPath(work, unit.n).slice(1), menu: "prep",
      crumbs: [["사전 훈련", "/prep/"], [work.title, `/prep/${work.id}/`], [`유닛 ${unit.n}`, null]],
      title: `${work.title} 사전 훈련 유닛 ${unit.n}(${unit.when}) | 영어 감각`,
      description: `${work.title}를 ${unit.when === "보기 전" || unit.when === "읽기 전" ? unit.when : `${unit.when}에`} 익힐 표현 ${unit.cards.length}개: ${unit.cards.slice(0, 4).map(card => card.expression).join(", ")} …`,
      parts: [{ kind: "prep-unit", id: work.id, unit: unit.n }],
    });
  }
  return pages;
}
