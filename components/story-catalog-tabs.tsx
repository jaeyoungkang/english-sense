"use client";

import { useState } from "react";
import { getStoryPublicGuide } from "@/lib/story-lesson";
import { clockLabel, unitPath, workLabel } from "@/lib/study-content";
import { levelLimitSeconds } from "@/lib/reading-level";
import { StoryRecordNote } from "@/components/story-record-note";
import type { PrepSummary, ReadingSummary, ReadingSummaryStory } from "@/lib/study-content-types";

type FilterCategory = "all" | "intro" | "wonder" | "movies";

function DraftTag() {
  return <span className="tag draft-tag">초안</span>;
}

export function StoryCardLink({ story, label, badge }: { story: ReadingSummaryStory; label?: string; badge?: string }) {
  const guide = getStoryPublicGuide(story.id);
  return <a className="link-card story-card" href={`/reading/${story.id}/`}>
    <span className="story-card-badges">
      <span className="story-badge-cat">{badge || "입문 감각"}</span>
      <span className="story-badge-meta">{story.words}낱말 · {clockLabel(levelLimitSeconds(story.words, "fast"))}~{clockLabel(levelLimitSeconds(story.words, "relaxed"))}</span>
    </span>
    <span className="t"><span className="en">{story.title}</span>{guide ? <span className="story-subtitle">{` · ${guide.subtitleKo}`}</span> : ""} {story.draft && <DraftTag />}</span>
    {guide && <span className="s story-synopsis-text">{guide.synopsisKo}</span>}
    <span className="s story-detail-meta">{label ? `${label} · ` : ""}{story.words}낱말 · 제한 시간 {clockLabel(levelLimitSeconds(story.words, "fast"))}~{clockLabel(levelLimitSeconds(story.words, "relaxed"))}(수준 선택) · 문제 {story.questionCount}개</span>
    <StoryRecordNote storyId={story.id} words={story.words} className="s lw-list-record" />
  </a>;
}

export function StoryCatalogSection({ reading, prep }: { reading: ReadingSummary; prep: PrepSummary }) {
  const [filter, setFilter] = useState<FilterCategory>("all");
  const plain = reading.stories.filter(story => !story.pair);
  const paired = prep.works
    .map(work => ({ work, stories: reading.stories.filter(story => story.pair?.work === work.id) }))
    .filter(group => group.stories.length > 0);
  const wonderCount = reading.stories.filter(story => story.pair?.work === "wonder").length;
  const movieCount = reading.stories.filter(story => story.pair && story.pair.work !== "wonder").length;
  const hasDraft = reading.stories.some(story => story.draft);

  const showIntro = filter === "all" || filter === "intro";
  const visiblePaired = paired.filter(({ work }) => {
    if (filter === "all") return true;
    if (filter === "wonder") return work.id === "wonder";
    if (filter === "movies") return work.kind === "movie";
    return false;
  });

  return <div className="story-catalog">
    <div className="story-filter-bar" role="group" aria-label="작품별 이야기 분류">
      <button type="button" className="story-filter-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
        전체 이야기 <span className="chip-count">{reading.stories.length}</span>
      </button>
      <button type="button" className="story-filter-chip" aria-pressed={filter === "intro"} onClick={() => setFilter("intro")}>
        입문·감각 이야기 <span className="chip-count">{plain.length}</span>
      </button>
      <button type="button" className="story-filter-chip" aria-pressed={filter === "wonder"} onClick={() => setFilter("wonder")}>
        <i lang="en">Wonder</i> 시리즈 <span className="chip-count">{wonderCount}</span>
      </button>
      <button type="button" className="story-filter-chip" aria-pressed={filter === "movies"} onClick={() => setFilter("movies")}>
        영화 명장면 <span className="chip-count">{movieCount}</span>
      </button>
    </div>

    {showIntro && <section className="catalog-section" aria-labelledby="stories-h">
      <div className="section-head">
        <div>
          <span className="section-eyebrow">STARTER STORIES</span>
          <h2 id="stories-h">입문·감각 이야기</h2>
        </div>
        <p className="muted">일상 장면 속에서 <span className="en">have, get, be, go, come</span>의 기본 감각을 자연스럽게 만나는 짧은 이야기입니다. 처음 방문했다면 여기서부터 읽어 보십시오.</p>
      </div>
      <div className="links story-card-grid">
        {plain.map(story => <div className="story-card-group" key={story.id}>
          <StoryCardLink story={story} badge="입문 · 기본동사 감각" />
        </div>)}
      </div>
    </section>}

    {visiblePaired.length > 0 && <section className="catalog-section" aria-labelledby="paired-h">
      <div className="section-head">
        <div>
          <span className="section-eyebrow">BOOK &amp; MOVIE STORIES</span>
          <h2 id="paired-h">사전 훈련 짝 이야기 · 작품별 표현 읽기</h2>
        </div>
        <p className="muted">영어 원서·영화의 사전 훈련 유닛에서 뽑은 핵심 표현으로 새로 쓴 이야기입니다. 이야기를 바로 읽고 문제를 풀어도 되고, 짝 사전 훈련 유닛에서 빈칸 카드로 표현을 먼저 떠올려 본 뒤 읽어도 좋습니다.</p>
      </div>
      {visiblePaired.map(({ work, stories }) => <section className="work-story-group" key={work.id} aria-labelledby={`paired-${work.id}-h`}>
        <div className="work-group-header">
          <h3 id={`paired-${work.id}-h`}><i>{work.title}</i> <span className="note">{workLabel(work)}</span></h3>
          <a className="work-group-link" href={`/prep/${work.id}/`}>작품 유닛 전체 보기 ({work.units.length}유닛) <span aria-hidden="true">→</span></a>
        </div>
        <div className="links story-card-grid">{stories.map(story => {
          const unit = work.units.find(u => u.n === story.pair!.unit);
          const pairHref = unitPath(work, story.pair!.unit);
          return <div className="story-card-group" key={story.id}>
            <StoryCardLink
              story={story}
              badge={`${work.title} · 유닛 ${story.pair!.unit}`}
              label={`유닛 ${story.pair!.unit}${unit ? ` · ${unit.when}` : ""} 짝`}
            />
            <div className="story-pair-bar">
              <a className="story-pair-unit-link" href={pairHref}>짝 사전 훈련: <i>{work.title}</i> 유닛 {story.pair!.unit}{unit ? ` · ${unit.when}` : ""}{unit ? ` 표현 카드 ${unit.cardCount}개 연습` : ""} <span aria-hidden="true">→</span></a>
            </div>
          </div>;
        })}</div>
      </section>)}
    </section>}

    {hasDraft && <p className="note">초안은 강PD가 아직 읽고 통과시키지 않은 이야기입니다. 어색한 영어가 섞여 있을 수 있습니다.</p>}
  </div>;
}
