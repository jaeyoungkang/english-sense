import { notFound } from "next/navigation";
import type { StudyPart } from "@/lib/content";
import { getWork, unitPath, workLabel } from "@/lib/study-content";
import { ContinueReadingBanner } from "@/components/continue-reading-banner";
import { StoryCatalogSection } from "@/components/story-catalog-tabs";
import type { PrepSummary, ReadingSummary } from "@/lib/study-content-types";

/**
 * 홈(`/`)과 목록 페이지(`/reading/`, `/prep/`, `/prep/<작품>/`)가 그리는 공개 요약.
 * 서버가 `getStudyListing()`으로 만들어 넘기고, 컴포넌트는 정본 JSON을 import하지 않는다.
 * 이야기·유닛·장면 수업 화면은 `story-workspace.tsx`·`card-lesson.tsx`·`learning-workspace.tsx`가 그린다.
 */
type StudyListing = { reading: ReadingSummary; prep: PrepSummary };

function ReadingList({ reading, prep }: StudyListing) {
  return <>
    <header className="hero hero-editorial">
      <span className="eyebrow">STORY READING · 영어 읽기 · 감각 훈련</span>
      <h1>이야기로 읽고, 퀴즈로 감각 익히기</h1>
      <p className="lede">쉬운 영어로 쓴 짧은 이야기 15편을 읽고 내용과 표현 감각을 묻는 7개 문제를 풉니다. 바로 내려가 읽고 풀어도 되고, 시간을 재어 읽은 뒤 본문을 가리고 기억으로 풀어 볼 수도 있습니다.</p>
    </header>
    <StoryCatalogSection reading={reading} prep={prep} />
  </>;
}

function ReadingHub({ reading, prep }: StudyListing) {
  const totalUnits = prep.works.reduce((sum, work) => sum + work.units.length, 0);
  return <>
    <header className="hero hero-home">
      <div className="hero-home-inner">
        <span className="eyebrow">ENGLISH SENSE · 영어 이야기 읽기 &amp; 감각 훈련</span>
        <h1>이야기로 읽고, 퀴즈로 익히는 영어 감각</h1>
        <p className="lede">쉬운 영어로 쓴 짧은 이야기 {reading.stories.length}편을 읽고 내용·감각·표현을 묻는 7개 문제를 풉니다. 바로 내려가 읽고 풀거나 시간을 재어 읽은 뒤 기억으로 풀어 볼 수 있고, 막히는 문장은 AI 튜터와 해설기에서 바로 물어봅니다.</p>
        <div className="actions">
          <a className="btn" href="/reading/green-umbrella/">첫 이야기 읽기: The Green Umbrella <span aria-hidden="true">→</span></a>
          <a className="btn ghost" href="#stories-h">전체 이야기 {reading.stories.length}편</a>
          <a className="btn ghost" href="/prep/">사전 훈련 카드 {totalUnits}유닛</a>
          <a className="btn ghost" href="/ask/">AI 문장 해설기</a>
        </div>
      </div>
    </header>

    <ContinueReadingBanner stories={reading.stories} />

    <StoryCatalogSection reading={reading} prep={prep} />

    <section className="showcase-section" aria-labelledby="prep-h">
      <div className="section-head">
        <div>
          <span className="section-eyebrow">VOCABULARY &amp; IDIOM PREP</span>
          <h2 id="prep-h">책·영화 사전 훈련 카드</h2>
        </div>
        <p className="muted">원서나 영화를 보다가 모르는 표현이 쌓여 멈추지 않도록, 작품에 자주 되풀이되는 표현의 뜻과 감각을 먼저 익히고 빈칸을 채워 보는 카드 수업입니다. 각 유닛은 위 짝 이야기와 1:1로 이어집니다.</p>
      </div>
      <div className="links work-card-grid">{prep.works.map(work =>
        <a className="link-card work-card" key={work.id} href={`/prep/${work.id}/`}>
          <span className="story-card-badges">
            <span className="story-badge-cat">{workLabel(work)}</span>
            <span className="story-badge-meta">유닛 {work.units.length}개 · 표현 {work.cardCount}개</span>
          </span>
          <span className="t"><i>{work.title}</i> <span className="note">{workLabel(work)}</span></span>
          <span className="s">{work.creator ? `${work.creator} · ` : ""}{work.year} · 유닛 {work.units.length}개 · 표현 {work.cardCount}개</span>
        </a>)}
      </div>
    </section>

    <section className="showcase-section" aria-labelledby="words">
      <div className="section-head">
        <div>
          <span className="section-eyebrow">CORE VERB SENSES</span>
          <h2 id="words">이야기 속 기본동사 감각 원리</h2>
        </div>
        <p className="muted">이야기와 문제에서 가장 자주 만나는 기본동사를 뜻 목록으로 외우지 않고, 영어 화자에게 보이는 <b>그림 하나(이미지 · 뉘앙스 · 예시)</b>로 잡습니다.</p>
      </div>
      <div className="grp"><p className="gh"><span className="num">①</span> 있음과 들어섬</p><div className="vcs"><a className="vc" href="/have/"><span className="w en">have</span><span className="pic">영역 안에 놓여 있다</span><span className="st">읽기</span></a><a className="vc" href="/get/"><span className="w en">get</span><span className="pic">경계를 넘어 들어선다</span><span className="st">읽기</span></a><a className="vc" href="/be/"><span className="w en">be</span><span className="pic">장소·모습에 놓여 있다</span><span className="st">읽기</span></a></div></div>
      <div className="grp"><p className="gh"><span className="num">②</span> 멀어짐과 다가옴</p><div className="vcs"><a className="vc" href="/go/"><span className="w en">go</span><span className="pic">기준점에서 멀어진다</span><span className="st">읽기</span></a><a className="vc" href="/come/"><span className="w en">come</span><span className="pic">기준점으로 다가온다</span><span className="st">읽기</span></a></div></div>
      <div className="grp"><p className="gh"><span className="num">③</span> 놓기, 집기, 건네기</p><div className="vcs"><div className="vc"><span className="w en">put</span><span className="pic">손으로 옮겨 놓는다</span><span className="st">준비 중</span></div><div className="vc"><span className="w en">take</span><span className="pic">손을 뻗어 집어 든다</span><span className="st">준비 중</span></div><div className="vc"><span className="w en">give</span><span className="pic">상대의 손으로 넘긴다</span><span className="st">준비 중</span></div></div></div>
      <div className="grp"><p className="gh"><span className="num">④</span> 붙들기와 버티기</p><div className="vcs"><div className="vc"><span className="w en">hold</span><span className="pic">쥐고 붙들어 둔다</span><span className="st">준비 중</span></div><div className="vc"><span className="w en">keep</span><span className="pic">힘을 견디며 붙들어 둔다</span><span className="st">준비 중</span></div><div className="vc"><span className="w en">set</span><span className="pic">제자리에 앉혀 놓는다</span><span className="st">준비 중</span></div></div></div>
      <div className="grp"><p className="gh"><span className="num">⑤</span> 방식과 눈길과 만들기</p><div className="vcs"><div className="vc"><span className="w en">run</span><span className="pic">빨리 달린다</span><span className="st">준비 중</span></div><div className="vc"><span className="w en">look</span><span className="pic">눈길을 보낸다</span><span className="st">준비 중</span></div><div className="vc"><span className="w en">make</span><span className="pic">전에 없던 것을 만든다</span><span className="st">준비 중</span></div></div></div>
    </section>

    <section className="showcase-section" aria-labelledby="practice-h">
      <div className="section-head">
        <div>
          <span className="section-eyebrow">SCENE PRACTICE</span>
          <h2 id="practice-h">책 장면으로 연습하기</h2>
        </div>
        <p className="muted">영어 원서의 실제 장면에서 한국어식 직역·라틴어 계열 낱말·영어 화자의 문장을 견주며 기본동사의 감각을 연습합니다.</p>
      </div>
      <div className="links story-card-grid">
        <a className="link-card work-card" href="/practice/have/">
          <span className="story-card-badges">
            <span className="story-badge-cat">AI 대화형 작업 공간</span>
            <span className="story-badge-meta">7문항 · 실시간 피드백</span>
          </span>
          <span className="t"><i>Tonight on the Titanic</i> · <span className="en">have</span> 장면 작업 공간 (AI 피드백·대화)</span>
          <span className="s">감각 자료 스택과 7개 장면 문제를 한 문서에 펼쳐 놓고 AI 피드백과 질문을 이어 가는 대화형 작업 공간</span>
        </a>
        <a className="link-card work-card" href="/practice/titanic/">
          <span className="story-card-badges">
            <span className="story-badge-cat">기본동사 5종 퀴즈</span>
            <span className="story-badge-meta">have · get · be · go · come</span>
          </span>
          <span className="t"><i>Tonight on the Titanic</i> 장면 퀴즈 모음</span>
          <span className="s">Magic Tree House #17 · 매직트리하우스 17권 · 연습할 표제어: have, get, be, go, come</span>
        </a>
      </div>
    </section>

    <section className="showcase-section" aria-labelledby="how-h">
      <div className="section-head">
        <div>
          <span className="section-eyebrow">HOW IT WORKS</span>
          <h2 id="how-h">이렇게 익힙니다</h2>
        </div>
      </div>
      <ol className="steps steps-grid">
        <li><b>이야기 읽기</b>에서 짧은 영어 이야기를 읽고(또는 시간 제한 읽기로 기억을 시험하고) 내용·감각·표현 7문제를 풉니다.</li>
        <li><b>짝 사전 훈련 카드</b>에서 작품에 자주 나오는 핵심 표현을 뜻과 힌트로 먼저 떠올려 빈칸을 채웁니다.</li>
        <li><b>기본동사 표제어와 책 장면 연습</b>에서 <span className="en">have, get, be, go, come</span>의 중심 그림을 잡고 원서 장면으로 확인합니다.</li>
        <li>읽다가 걸린 문장은 <a href="/ask/">문장 해설기</a>에 넣어 감각 단위로 풀고 이어서 질문합니다.</li>
      </ol>
    </section>

    <section className="explainer-cta-banner" aria-labelledby="tool-h">
      <div>
        <span className="section-eyebrow">AI SENTENCE EXPLAINER</span>
        <h2 id="tool-h">내 문장으로 해 보기</h2>
        <p>이야기나 원서를 읽다가 걸린 영어 문장, 또는 영어로 말하고 싶은 한국어 문장을 넣어 보십시오. 같은 감각 사전으로 풀어 드립니다.</p>
      </div>
      <div className="actions"><a className="btn" href="/ask/">영어 감각 해설기 열기 <span aria-hidden="true">→</span></a></div>
    </section>
  </>;
}

function PrepList({ prep }: Pick<StudyListing, "prep">) {
  const groups = [["book", "책"], ["movie", "영화"]] as const;
  return <>
    <header className="hero hero-editorial">
      <span className="eyebrow">VOCABULARY PREP · 사전 훈련</span>
      <h1>보기 전에 자주 나오는 표현부터</h1>
      <p className="lede">재미있는 원서나 영화도 모르는 표현이 쌓이면 중간에 놓기 쉽습니다. 그 작품에서 자주 되풀이되는 표현을 세어 고르고, 뜻과 감각을 먼저 익힌 뒤 작품 문장의 빈칸을 채웁니다.</p>
    </header>
    {groups.map(([kind, label]) => <section className="showcase-section" key={kind} aria-labelledby={`${kind}-h`}>
      <h2 id={`${kind}-h`}>{label}</h2>
      <div className="links work-card-grid">{prep.works.filter(work => work.kind === kind).map(work =>
        <a className="link-card work-card" key={work.id} href={`/prep/${work.id}/`}>
          <span className="story-card-badges">
            <span className="story-badge-cat">{label}</span>
            <span className="story-badge-meta">유닛 {work.units.length}개 · 표현 {work.cardCount}개</span>
          </span>
          <span className="t"><i>{work.title}</i></span>
          <span className="s">{work.creator ? `${work.creator} · ` : ""}{work.year} · 유닛 {work.units.length}개 · 표현 {work.cardCount}개</span>
        </a>)}
      </div>
    </section>)}
    <p className="note">예문과 빈칸 문장은 작품의 한 줄을 그대로 옮기고 카드마다 출처를 적었습니다. 작품 본문이나 자막 전체는 싣지 않습니다.</p>
  </>;
}

function PrepWorkPage({ id, prep, reading }: StudyListing & { id: string }) {
  const work = getWork(prep, id);
  if (!work) notFound();
  return <>
    <header className="hero hero-editorial">
      <span className="eyebrow">{workLabel(work)} 사전 훈련</span>
      <h1><i>{work.title}</i></h1>
      <p className="lede">{work.creator ? `${work.creator}, ` : ""}{work.year}. {work.kind === "book"
        ? `책 전체에 자주 나오는 표현은 읽기 전에, 한 부에 몰린 표현은 그 부를 읽기 전에 익힙니다.`
        : `영화 대사에 자주 나오는 표현을 보기 전에 익히고 영어 자막으로 봅니다.`}</p>
    </header>
    {work.parts && <section className="showcase-section" aria-labelledby="parts-h">
      <h2 id="parts-h">부와 화자</h2>
      <div className="cmp"><table><thead><tr><th scope="col">부</th><th scope="col">화자</th><th scope="col">낱말</th></tr></thead>
        <tbody>{work.parts.map(part => <tr key={part.n}><td>{part.n}부</td><td>{part.narrator}</td><td>{part.words.toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div>
      <p className="note">부마다 화자가 바뀝니다. 부별 유닛은 그 부를 읽기 바로 전에 합니다.</p>
    </section>}
    <section className="showcase-section" aria-labelledby="units-h">
      <h2 id="units-h">유닛</h2>
      <div className="links story-card-grid">{work.units.map(unit => {
        const pairs = reading.stories.filter(story => story.pair?.work === work.id && story.pair?.unit === unit.n);
        return <div className="story-card-group" key={unit.n}>
          <a className="link-card story-card" href={unitPath(work, unit.n)}>
            <span className="story-card-badges">
              <span className="story-badge-cat">유닛 {unit.n}</span>
              <span className="story-badge-meta">표현 카드 {unit.cardCount}개</span>
            </span>
            <span className="t">유닛 {unit.n} · {unit.when}</span>
            <span className="s">{unit.summary}</span>
          </a>
          {pairs.map(story => <div className="story-pair-bar" key={story.id}>
            <a className="story-pair-unit-link" href={`/reading/${story.id}/`}>이 유닛의 표현으로 쓴 짝 이야기 읽기 · {story.words}낱말 · 문제 {story.questionCount}개 <span aria-hidden="true">→</span></a>
          </div>)}
        </div>;
      })}
      </div>
    </section>
  </>;
}

/** 이야기 수업(`reading`)과 장면 작업 공간(`scene-workspace`)은 라우트에서 전용 작업 공간이 그린다. */
export function StudyPartView({ part, listing }: { part: Exclude<StudyPart, { kind: "reading" } | { kind: "scene-workspace" }>; listing: StudyListing }) {
  if (part.kind === "reading-hub") return <ReadingHub {...listing} />;
  if (part.kind === "reading-list") return <ReadingList {...listing} />;
  if (part.kind === "prep-list") return <PrepList prep={listing.prep} />;
  if (part.kind === "prep-work") return <PrepWorkPage id={part.id} prep={listing.prep} reading={listing.reading} />;
  // 카드 수업(prep-unit)은 라우트가 작업 공간으로 렌더링한다(components/card-lesson.tsx).
  notFound();
}
