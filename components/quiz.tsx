"use client";

import { useEffect, useRef, useState } from "react";
import type { QuizContent, OptionKind } from "@/lib/content";

const kinds: Record<OptionKind, [string, string]> = { en: ["영어식", "en-k"], ko: ["한국어식 직역", "ko-k"], la: ["라틴어 계열", "la-k"] };

export function Quiz({ content }: { content: QuizContent }) {
  const [current, setCurrent] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState("");
  const questionRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const question = content.questions[current];
  const nChoose = content.questions.filter(q => q.type === "choose").length;
  useEffect(() => {
    if (!moveFocus.current) return;
    questionRef.current?.focus({ preventScroll: true });
    questionRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [current]);
  function advance() {
    setSelected(null); setRevealed(false); setAnswer(""); moveFocus.current = true; setCurrent(value => value + 1);
  }
  function restart() {
    setSelected(null); setRevealed(false); setAnswer(""); setCorrect(0); moveFocus.current = true; setCurrent(0);
  }
  return <section aria-labelledby="quiz-h" id="quiz">
    <div className="quiz-head"><h2 id="quiz-h">장면에서 골라 보기</h2><span className="progress" id="progress" aria-live="polite">{question ? `${current + 1} / ${content.questions.length}` : "끝"}</span></div>
    <p className="muted">{content.description}</p>
    <div id="quiz-card" className="card quiz-question" ref={questionRef} tabIndex={-1} aria-label={question ? `${current + 1}번 문제` : "연습 결과"}>
      {!question ? <div className="done"><span className="eyebrow">고르기 결과</span><span className="score">{correct} / {nChoose}</span><p>{content.done}</p><div className="actions" style={{ justifyContent: "center" }}><button className="btn ghost" type="button" id="again" onClick={restart}>처음부터 다시</button></div></div> : <>
        <p className="meta">{content.book} {question.ch}장 · 말하는 사람: {question.who}</p><p>{question.scene}</p><p className="ask" id="question-prompt">{question.ask}</p>
        {question.type === "choose" ? <>
          <div className="opts" role="group" aria-labelledby="question-prompt">{question.opts.map((option, index) => <button key={index} type="button" disabled={selected !== null} className={`opt${selected !== null && option.k === "en" ? " right" : selected === index && option.k !== "en" ? " wrong" : ""}`} onClick={() => {
            if (selected !== null) return;
            setSelected(index); if (option.k === "en") setCorrect(value => value + 1);
          }}><span className="en">{option.t}</span>{selected !== null && <><span><span className={`tag ${kinds[option.k][1]}`}>{kinds[option.k][0]}</span></span><span className="why">{option.why}</span></>}</button>)}</div>
          {selected !== null && <div className="feedback" id="fb"><div role="status"><p className={`verdict ${question.opts[selected].k === "en" ? "ok" : "no"}`}>{question.opts[selected].k === "en" ? "맞습니다." : "영어 화자라면 초록색 문장을 고릅니다."}</p><p className="feel">{question.feel}</p></div><div className="actions"><button className="btn" type="button" id="next" onClick={advance}>다음 문제</button></div></div>}
        </> : <>
          <label className="hint" htmlFor={`ans-${current}`}>영어로 쓰고 답을 확인하십시오. 막히면 빈칸으로 두고 눌러도 됩니다.</label>
          <textarea id={`ans-${current}`} value={answer} onChange={event => setAnswer(event.target.value)} spellCheck={false} aria-labelledby="question-prompt" />
          <div className="actions"><button className="btn" type="button" id="reveal" disabled={revealed} onClick={() => setRevealed(true)}>모범 답 보기</button></div>
          {revealed && <div className="feedback" id="fb"><div role="status"><p className="verdict ok">모범 답</p><p className="en" style={{ fontSize: "1.25rem" }}>{question.answer}</p>
            <p className="note">{question.book === null ? "책 장면에 맞게 지은 문장입니다." : question.book === question.answer ? "책 문장 그대로입니다." : <>책 문장: <span className="en">{question.book}</span></>}</p>
          </div><p className="hint">처음 푼 학습자가 고친 곳</p><ul className="fixes">{question.fixes.map(([text, why], index) => <li key={index}><span className="en">{text}</span><span className="muted">{why}</span></li>)}</ul><div className="actions"><button className="btn" type="button" id="next" onClick={advance}>{current === content.questions.length - 1 ? "결과 보기" : "다음 문제"}</button></div></div>}
        </>}
      </>}
    </div>
  </section>;
}
