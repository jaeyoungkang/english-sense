import { notFound } from "next/navigation";
import type { StudyPart } from "@/lib/content";
import { getStoryPublicGuide } from "@/lib/story-lesson";
import { clockLabel, getWork, unitPath, workLabel } from "@/lib/study-content";
import { levelLimitSeconds } from "@/lib/reading-level";
import { StoryRecordNote } from "@/components/story-record-note";
import type { PrepSummary, ReadingSummary, ReadingSummaryStory } from "@/lib/study-content-types";

/**
 * 목록 페이지(`/reading/`, `/prep/`, `/prep/<작품>/`)가 그리는 공개 요약. 서버가 `getStudyListing()`으로 만들어 넘기고,
 * 컴포넌트는 정본 JSON을 import하지 않는다. 이야기·유닛 수업 화면은 `story-workspace.tsx`·`card-lesson.tsx`가 그린다.
 */
type StudyListing = { reading: ReadingSummary; prep: PrepSummary };

function DraftTag() {
  return <span className="tag draft-tag">초안</span>;
}

function StoryLink({ story, label }: { story: ReadingSummaryStory; label?: string }) {
  const guide = getStoryPublicGuide(story.id);
  return <a className="link-card" href={`/reading/${story.id}/`}>
    <span className="t"><span className="en">{story.title}</span>{guide ? ` · ${guide.subtitleKo}` : ""} {story.draft && <DraftTag />}</span>
    {guide && <span className="s">{guide.synopsisKo}</span>}
    <span className="s">{label ? `${label} · ` : ""}{story.words}낱말 · 제한 시간 {clockLabel(levelLimitSeconds(story.words, "fast"))}~{clockLabel(levelLimitSeconds(story.words, "relaxed"))}(수준 선택) · 문제 {story.questionCount}개</span>
    <StoryRecordNote storyId={story.id} words={story.words} className="s lw-list-record" />
  </a>;
}

function ReadingList({ reading, prep }: StudyListing) {
  const plain = reading.stories.filter(story => !story.pair);
  const paired = prep.works.map(work => ({ work, stories: reading.stories.filter(story => story.pair?.work === work.id) })).filter(group => group.stories.length);
  const hasDraft = reading.stories.some(story => story.draft);
  return <>
    <header className="hero">
      <span className="eyebrow">영어 읽기 · 감각 훈련</span>
      <h1>이야기로 읽고, 퀴즈로 감각 익히기</h1>
      <p className="lede">쉬운 영어로 쓴 짧은 이야기 15편을 읽고 내용과 표현 감각을 묻는 7개 문제를 풉니다. 바로 내려가 읽고 풀어도 되고, 시간을 재어 읽은 뒤 본문을 가리고 기억으로 풀어 볼 수도 있습니다.</p>
    </header>
    <section aria-labelledby="stories-h">
      <h2 id="stories-h">이야기</h2>
      <div className="links">{plain.map(story => <StoryLink key={story.id} story={story} />)}</div>
    </section>
    {paired.length > 0 && <section aria-labelledby="paired-h">
      <h2 id="paired-h">사전 훈련 짝 이야기</h2>
      <p className="muted">사전 훈련 유닛의 카드 표현으로 쓴 새 이야기입니다. 카드로 익힌 표현을 이야기 속에서 다시 만납니다. 원작의 줄거리나 인물은 쓰지 않았습니다.</p>
      {paired.map(({ work, stories }) => <section key={work.id} aria-labelledby={`paired-${work.id}-h`}>
        <h3 id={`paired-${work.id}-h`}><i>{work.title}</i> <span className="note">{workLabel(work)}</span></h3>
        <div className="links">{stories.map(story => {
          const unit = work.units.find(u => u.n === story.pair!.unit);
          return <StoryLink key={story.id} story={story} label={`유닛 ${story.pair!.unit}${unit ? ` · ${unit.when}` : ""} 짝`} />;
        })}</div>
      </section>)}
    </section>}
    {hasDraft && <p className="note">초안은 강PD가 아직 읽고 통과시키지 않은 이야기입니다. 어색한 영어가 섞여 있을 수 있습니다.</p>}
  </>;
}

function PrepList({ prep }: Pick<StudyListing, "prep">) {
  const groups = [["book", "책"], ["movie", "영화"]] as const;
  return <>
    <header className="hero">
      <span className="eyebrow">사전 훈련</span>
      <h1>보기 전에 자주 나오는 표현부터</h1>
      <p className="lede">재미있는 원서나 영화도 모르는 표현이 쌓이면 중간에 놓기 쉽습니다. 그 작품에서 자주 되풀이되는 표현을 세어 고르고, 뜻과 감각을 먼저 익힌 뒤 작품 문장의 빈칸을 채웁니다.</p>
    </header>
    {groups.map(([kind, label]) => <section key={kind} aria-labelledby={`${kind}-h`}>
      <h2 id={`${kind}-h`}>{label}</h2>
      <div className="links">{prep.works.filter(work => work.kind === kind).map(work =>
        <a className="link-card" key={work.id} href={`/prep/${work.id}/`}>
          <span className="t"><i>{work.title}</i></span>
          <span className="s">{work.creator ? `${work.creator} · ` : ""}{work.year} · 유닛 {work.units.length}개 · 표현 {work.cardCount}개</span>
        </a>)}
      </div>
    </section>)}
    <p className="note">예문과 빈칸 문장은 작품의 한 줄을 그대로 옮기고 카드마다 출처를 적었습니다. 작품 본문이나 자막 전체는 싣지 않습니다.</p>
  </>;
}

function PrepWorkPage({ id, prep }: Pick<StudyListing, "prep"> & { id: string }) {
  const work = getWork(prep, id);
  if (!work) notFound();
  return <>
    <header className="hero">
      <span className="eyebrow">{workLabel(work)} 사전 훈련</span>
      <h1><i>{work.title}</i></h1>
      <p className="lede">{work.creator ? `${work.creator}, ` : ""}{work.year}. {work.kind === "book"
        ? `책 전체에 자주 나오는 표현은 읽기 전에, 한 부에 몰린 표현은 그 부를 읽기 전에 익힙니다.`
        : `영화 대사에 자주 나오는 표현을 보기 전에 익히고 영어 자막으로 봅니다.`}</p>
    </header>
    {work.parts && <section aria-labelledby="parts-h">
      <h2 id="parts-h">부와 화자</h2>
      <div className="cmp"><table><thead><tr><th scope="col">부</th><th scope="col">화자</th><th scope="col">낱말</th></tr></thead>
        <tbody>{work.parts.map(part => <tr key={part.n}><td>{part.n}부</td><td>{part.narrator}</td><td>{part.words.toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div>
      <p className="note">부마다 화자가 바뀝니다. 부별 유닛은 그 부를 읽기 바로 전에 합니다.</p>
    </section>}
    <section aria-labelledby="units-h">
      <h2 id="units-h">유닛</h2>
      <div className="links">{work.units.map(unit =>
        <a className="link-card" key={unit.n} href={unitPath(work, unit.n)}>
          <span className="t">유닛 {unit.n} · {unit.when}</span>
          <span className="s">{unit.summary}</span>
        </a>)}
      </div>
    </section>
  </>;
}

/** 이야기 수업(`reading`)은 작업 공간이 따로 그린다. */
export function StudyPartView({ part, listing }: { part: Exclude<StudyPart, { kind: "reading" }>; listing: StudyListing }) {
  if (part.kind === "reading-list") return <ReadingList {...listing} />;
  if (part.kind === "prep-list") return <PrepList prep={listing.prep} />;
  if (part.kind === "prep-work") return <PrepWorkPage id={part.id} prep={listing.prep} />;
  // 카드 수업(prep-unit)은 라우트가 작업 공간으로 렌더링한다(components/card-lesson.tsx).
  notFound();
}
