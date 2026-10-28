import type { LessonListing } from "@/lib/lesson-list";
import { StoryRecordNote } from "@/components/story-record-note";

/**
 * Body of the home toolbar's "수업 목록" window: links to the story lessons and the book/movie unit lessons at their
 * existing addresses. Opening one leaves this page; each lesson keeps its own record. It only draws what the server handed over.
 */
export function LessonListDialog({ listing }: { listing: LessonListing }) {
  const units = listing.works.reduce((sum, work) => sum + work.units.length, 0);
  return <>
    <p className="lw-dialog-intro">장면 연습, 이야기 읽기, 책·영화 사전 훈련을 고릅니다. 수업을 열면 페이지가 바뀝니다.</p>
    <section className="lw-lesson-list" aria-labelledby="lw-lessons-scenes">
      <h3 id="lw-lessons-scenes">장면 연습 <a href="/practice/">전체 목록</a></h3>
      <p className="study-list-note">홈의 have 수업과 별도로 푸는 장면 퀴즈입니다.</p>
      <ul className="study-scene-links">{["have", "get", "be", "go", "come"].map(word => <li key={word}><a href={`/practice/titanic/${word}/`}>Titanic · <span lang="en">{word}</span></a></li>)}</ul>
    </section>
    <section className="lw-lesson-list" aria-labelledby="lw-lessons-stories">
      <h3 id="lw-lessons-stories">이야기 읽기 · {listing.stories.length}편 <a href="/reading/">전체 목록</a></h3>
      <ul>{listing.stories.map(story => <li key={story.href}><a href={story.href}><span lang="en">{story.title}</span>{story.draft && <span className="tag draft-tag">초안</span>}</a><StoryRecordNote storyId={story.id} words={story.words} /></li>)}</ul>
    </section>
    <section className="lw-lesson-list" aria-labelledby="lw-lessons-prep">
      <h3 id="lw-lessons-prep">책·영화 사전 훈련 · 유닛 {units}개 <a href="/prep/">전체 목록</a></h3>
      {listing.works.map(work => <div key={work.href}>
        <h4><a href={work.href}><i>{work.title}</i></a> <span>{work.kind === "book" ? "책" : "영화"}</span></h4>
        <ul>{work.units.map(unit => <li key={unit.href}><a href={unit.href}>{unit.label}</a></li>)}</ul>
      </div>)}
    </section>
  </>;
}
