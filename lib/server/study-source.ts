import readingData from "../../content/reading.json";
import prepData from "../../content/prep.json";
import type { ContentPage } from "../content";
import { cardCount, minutesLabel, namelessSummary, unitPath, workLabel } from "../study-content";
import { lessonListing, type LessonListing } from "../lesson-list";
import type { PrepData, PrepSummary, ReadingData, ReadingSummary } from "../study-content-types";

// 읽기·사전 훈련 정본 JSON을 import하는 유일한 모듈이다. 정답·해설을 담으므로 서버 밖으로 내보내지 않는다.
const reading = readingData as ReadingData;
const prep = prepData as PrepData;

/** 정본 전체를 돌려준다. 서버 모듈만 쓴다. */
export const getStudySource = () => ({ reading, prep });

/**
 * 목록용 공개 요약: `/reading/`·`/prep/`·`/prep/<작품>/` 목록 페이지와 홈의 수업 목록 창이 쓴다.
 * 이야기는 문항 없이 제목·낱말·제한 시간·짝·문제 수만, 사전 훈련은 카드 없이 작품·유닛·카드 수만 낸다.
 * 이야기의 `answer`·`explain`·`basis`와 카드의 `drill.answers`가 담길 자리가 없는 모양이라 브라우저로 나가도 된다.
 * 유닛 요약은 표현 이름을 지운 글이다. 카드 표현은 첫 답을 낸 뒤에야 이름을 붙이므로 목록도 이름을 나열하지 않는다.
 */
export function getStudyListing(): { reading: ReadingSummary; prep: PrepSummary } {
  return {
    reading: { stories: reading.stories.map(({ id, title, words, limitSeconds, draft, pair, questions }) => ({ id, title, words, limitSeconds, draft, ...(pair ? { pair: { ...pair } } : {}), questionCount: questions.length })) },
    prep: { works: prep.works.map(({ units, ...work }) => ({ ...work, cardCount: cardCount({ units }), units: units.map(({ n, when, summary, cards }) => ({ n, when, summary: namelessSummary(summary), cardCount: cards.length })) })) },
  };
}

/** 홈의 수업 목록 창에 넘기는 이야기 15편·유닛 13개의 제목과 주소. */
export const getLessonListing = (): LessonListing => lessonListing(getStudyListing());

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
      // 표현 이름은 쓰지 않는다. 카드는 첫 답을 낸 뒤에야 표현을 보이므로 페이지 설명도 이름을 붙이지 않는다.
      description: `${work.title}를 ${unit.when === "보기 전" || unit.when === "읽기 전" ? unit.when : `${unit.when}에`} 익힐 표현 ${unit.cards.length}개를 뜻과 힌트로 떠올려 빈칸에 채우는 카드 수업입니다.`,
      parts: [{ kind: "prep-unit", id: work.id, unit: unit.n }],
    });
  }
  return pages;
}
