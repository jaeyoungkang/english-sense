import { notFound } from "next/navigation";
import type { StudyPart } from "@/lib/content";
import { cardCount, getStory, getWork, minutesLabel, prep, reading, sourceLabel, unitPath, workLabel } from "@/lib/study-content";
import { TimedReading } from "@/components/timed-reading";
import { FillDrill } from "@/components/fill-drill";

function DraftTag() {
  return <span className="tag draft-tag">초안</span>;
}

function ReadingList() {
  return <>
    <header className="hero">
      <span className="eyebrow">시간 제한 읽기</span>
      <h1>읽고, 가리고, 떠올리기</h1>
      <p className="lede">쉬운 영어로 쓴 짧은 이야기를 정한 시간 안에 읽습니다. 다 읽으면 본문을 가리고 내용과 표현의 감각을 묻는 문제를 풉니다. 다시 읽기보다 읽은 것을 꺼내 볼 때 오래 남습니다.</p>
    </header>
    <section aria-labelledby="stories-h">
      <h2 id="stories-h">이야기</h2>
      <div className="links">{reading.stories.map(story =>
        <a className="link-card" key={story.id} href={`/reading/${story.id}/`}>
          <span className="t"><span className="en">{story.title}</span> {story.draft && <DraftTag />}</span>
          <span className="s">{story.words}낱말 · 제한 시간 {minutesLabel(story.limitSeconds)} · 문제 {story.questions.length}개</span>
        </a>)}
      </div>
      <p className="note">초안은 강PD가 아직 읽고 통과시키지 않은 이야기입니다. 어색한 영어가 섞여 있을 수 있습니다.</p>
    </section>
  </>;
}

function ReadingStoryPage({ id }: { id: string }) {
  const story = getStory(id);
  if (!story) notFound();
  return <>
    <header className="hero">
      <span className="eyebrow">시간 제한 읽기 {story.draft && <DraftTag />}</span>
      <h1 className="en-title">{story.title}</h1>
      <p className="lede">{story.words}낱말을 {minutesLabel(story.limitSeconds)} 안에 읽습니다. 시작하면 본문과 남은 시간이 보입니다. 시간이 끝나거나 다 읽었다고 누르면 본문을 가리고 {story.questions.length}문제를 풉니다.</p>
    </header>
    <TimedReading story={story} />
  </>;
}

function PrepList() {
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
          <span className="s">{work.creator ? `${work.creator} · ` : ""}{work.year} · 유닛 {work.units.length}개 · 표현 {cardCount(work)}개</span>
        </a>)}
      </div>
    </section>)}
    <p className="note">예문과 빈칸 문장은 작품의 한 줄을 그대로 옮기고 카드마다 출처를 적었습니다. 작품 본문이나 자막 전체는 싣지 않습니다.</p>
  </>;
}

function PrepWorkPage({ id }: { id: string }) {
  const work = getWork(id);
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

function PrepUnitPage({ id, n }: { id: string; n: number }) {
  const work = getWork(id);
  const index = work?.units.findIndex(unit => unit.n === n) ?? -1;
  if (!work || index < 0) notFound();
  const unit = work.units[index];
  const prev = work.units[index - 1];
  const next = work.units[index + 1];
  const countLabel = work.kind === "book" ? "책 전체" : "영화 전체";
  return <>
    <header className="hero">
      <span className="eyebrow"><i>{work.title}</i> · 유닛 {unit.n} · {unit.when}</span>
      <h1>{unit.when}에 익힐 표현 {unit.cards.length}개</h1>
      <p className="lede">카드마다 뜻과 감각을 읽고 작품 예문으로 확인한 뒤, 다른 작품 문장의 빈칸을 채웁니다. 대소문자와 앞뒤 공백은 따지지 않습니다.</p>
    </header>
    <section aria-label="표현 카드" className="prep-cards">
      {unit.cards.map((card, i) => <article className="card prep-card" key={card.id} aria-labelledby={`${card.id}-h`}>
        <div className="prep-card-head">
          <h2 id={`${card.id}-h`} className="en prep-expression"><span className="prep-num">{i + 1}</span>{card.expression}</h2>
          <span className="count">{countLabel} {card.count}번{card.countInPart !== undefined ? ` · ${unit.n}부 ${card.countInPart}번` : ""}</span>
        </div>
        <dl className="kv">
          <dt>뜻</dt><dd>{card.meaning}</dd>
          <dt>감각</dt><dd>{card.sense}</dd>
        </dl>
        <figure className="quote prep-example">
          <blockquote className="en">{card.example.text}</blockquote>
          <figcaption className="note">{sourceLabel(work, card.example)}</figcaption>
        </figure>
        <FillDrill cardId={card.id} sentence={card.drill.sentence} answers={card.drill.answers} hint={card.drill.hint} source={sourceLabel(work, card.drill)} />
        <p className="note basis">근거: {card.basis}</p>
      </article>)}
    </section>
    <nav className="pager" aria-label="다른 유닛">
      {prev ? <a href={unitPath(work, prev.n)}><span className="k">이전</span>유닛 {prev.n} · {prev.when}</a> : <a href={`/prep/${work.id}/`}><span className="k">목록</span>{work.title} 유닛</a>}
      {next ? <a className="next" href={unitPath(work, next.n)}><span className="k">다음</span>유닛 {next.n} · {next.when}</a> : <a className="next" href="/prep/"><span className="k">목록</span>다른 작품</a>}
    </nav>
  </>;
}

export function StudyPartView({ part }: { part: StudyPart }) {
  if (part.kind === "reading-list") return <ReadingList />;
  if (part.kind === "reading") return <ReadingStoryPage id={part.id} />;
  if (part.kind === "prep-list") return <PrepList />;
  if (part.kind === "prep-work") return <PrepWorkPage id={part.id} />;
  return <PrepUnitPage id={part.id} n={part.unit} />;
}
