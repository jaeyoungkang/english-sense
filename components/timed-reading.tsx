"use client";

import { useEffect, useRef, useState } from "react";
import type { ReadingStory } from "@/lib/study-content-types";

type Phase = "ready" | "reading" | "quiz" | "done";

export function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type CardLinks = Record<string, { href: string; expression: string }>;

const kindLabel = { content: "내용", sense: "표현의 감각", expression: "표현" } as const;

export function TimedReading({ story, cards = {} }: { story: ReadingStory; cards?: CardLinks }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [readSeconds, setReadSeconds] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [current, setCurrent] = useState(0);
  const [chosen, setChosen] = useState<(number | null)[]>(() => story.questions.map(() => null));
  const focusRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  const remaining = story.limitSeconds - (now - startedAt) / 1000;

  useEffect(() => {
    if (phase !== "reading") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === "reading" && remaining <= 0) finishReading(true);
  });

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    focusRef.current?.focus({ preventScroll: true });
    focusRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [phase, current]);

  function start() {
    const t = Date.now();
    setStartedAt(t); setNow(t); setTimedOut(false); setCurrent(0);
    setChosen(story.questions.map(() => null));
    moveFocus.current = true; setPhase("reading");
  }
  function finishReading(byTimer: boolean) {
    setReadSeconds(byTimer ? story.limitSeconds : Math.min(story.limitSeconds, (Date.now() - startedAt) / 1000));
    setTimedOut(byTimer);
    moveFocus.current = true; setPhase("quiz");
  }
  function choose(index: number) {
    if (chosen[current] !== null) return;
    const next = [...chosen]; next[current] = index; setChosen(next);
  }
  function advance() {
    moveFocus.current = true;
    if (current + 1 < story.questions.length) setCurrent(current + 1);
    else setPhase("done");
  }

  const score = chosen.filter((value, i) => value === story.questions[i].answer).length;
  const question = story.questions[current];
  const picked = chosen[current];

  if (phase === "ready") return <section aria-labelledby="read-h" className="reading">
    <h2 id="read-h" className="sr-only">읽기 시작</h2>
    <div className="card reading-start">
      <p>제한 시간 <b>{clock(story.limitSeconds)}</b> · {story.words}낱말 · 문제 {story.questions.length}개</p>
      <p className="hint">시작을 누르면 시간이 흐릅니다. 다 읽으면 본문이 가려지니 한 번에 집중해서 읽으십시오.</p>
      <div className="actions"><button className="btn" type="button" onClick={start}>읽기 시작</button></div>
    </div>
  </section>;

  if (phase === "reading") return <section aria-labelledby="read-h" className="reading">
    <div className="timer-bar" role="timer" aria-label="남은 시간">
      <span className={`timer${remaining <= 30 ? " low" : ""}`}>남은 시간 <b>{clock(remaining)}</b></span>
      <button className="btn" type="button" onClick={() => finishReading(false)}>다 읽었습니다</button>
    </div>
    <div className="card story" ref={focusRef} tabIndex={-1} lang="en">
      <h2 id="read-h" className="en">{story.title}</h2>
      {story.paragraphs.map((paragraph, i) => <p key={i}>{paragraph.map((piece, j) => piece.em ? <i key={j}>{piece.text}</i> : piece.text)}</p>)}
    </div>
  </section>;

  return <section aria-labelledby="quiz-h" className="reading" id="quiz">
    <div className="quiz-head">
      <h2 id="quiz-h">본문을 가리고 떠올리기</h2>
      <span className="progress" aria-live="polite">{phase === "done" ? "끝" : `${current + 1} / ${story.questions.length}`}</span>
    </div>
    <p className="muted">{timedOut ? "시간이 끝나 본문을 가렸습니다." : `${clock(readSeconds)} 만에 읽었습니다.`} 이제 본문 없이 답합니다.</p>
    <div className="card quiz-question" ref={focusRef} tabIndex={-1} aria-label={phase === "done" ? "읽기 결과" : `${current + 1}번 문제`}>
      {phase === "done" ? <div className="done">
        <span className="eyebrow">읽기 결과</span>
        <span className="score">{score} / {story.questions.length}</span>
        <p>읽은 시간 {clock(readSeconds)} / 제한 {clock(story.limitSeconds)}{timedOut ? " (시간 끝)" : ""}</p>
        <div className="actions" style={{ justifyContent: "center" }}>
          <button className="btn ghost" type="button" onClick={start}>처음부터 다시 읽기</button>
          <a className="btn ghost" href="/reading/">다른 이야기</a>
        </div>
      </div> : <>
        <p className="meta">{kindLabel[question.kind]}</p>
        <p className="ask en" id="question-prompt">{question.question}</p>
        <div className="opts" role="group" aria-labelledby="question-prompt">{question.options.map((option, index) =>
          <button key={index} type="button" disabled={picked !== null} onClick={() => choose(index)}
            className={`opt${picked !== null && index === question.answer ? " right" : picked === index ? " wrong" : ""}`}>
            <span className="en">{option}</span>
          </button>)}
        </div>
        {picked !== null && <div className="feedback">
          <div role="status">
            <p className={`verdict ${picked === question.answer ? "ok" : "no"}`}>{picked === question.answer ? "맞습니다." : "정답은 초록색 보기입니다."}</p>
            <p className="feel">{question.explain}</p>
            {question.basis && <p className="note">근거: {question.basis}</p>}
            {question.card && cards[question.card] && <p className="card-link"><a href={cards[question.card].href}>카드에서 다시 보기: <span className="en">{cards[question.card].expression}</span></a></p>}
          </div>
          <div className="actions"><button className="btn" type="button" onClick={advance}>{current + 1 < story.questions.length ? "다음 문제" : "결과 보기"}</button></div>
        </div>}
      </>}
    </div>
  </section>;
}
