"use client";

import { useEffect, useRef, useState } from "react";
import type { QuizContent, OptionKind, FillQuestion } from "@/lib/content";

const kinds: Record<OptionKind, [string, string]> = { en: ["영어식", "en-k"], ko: ["한국어식 직역", "ko-k"], la: ["라틴어 계열", "la-k"] };

/** 빈칸 `(     )`는 밑줄 칸으로 그리고, 나머지 글은 그대로 둔다. */
function BlankLine({ text }: { text: string }) {
  return <p className="cur" lang="en">{text.split(/(\(\s+\))/).map((part, index) => /^\(\s+\)$/.test(part) ? <span key={index} className="blank" role="img" aria-label="빈칸">&nbsp;</span> : part)}</p>;
}

function FillBody({ question, id, answer, setAnswer, hintStep, setHintStep, revealed, setRevealed, last, onNext }: {
  question: FillQuestion; id: string; answer: string; setAnswer: (value: string) => void; hintStep: number; setHintStep: (value: number) => void;
  revealed: boolean; setRevealed: (value: boolean) => void; last: boolean; onNext: () => void;
}) {
  return <>
    <div className="passage" lang="en" aria-label="책의 이 대목">{question.before.map((line, index) => <p key={`b${index}`}>{line}</p>)}<BlankLine text={question.blank} />{question.after.map((line, index) => <p key={`a${index}`}>{line}</p>)}</div>
    <p className="hint">뜻: {question.hintKo}</p>
    <label className="hint" htmlFor={id}>빈칸에 들어갈 말을 영어로 쓰십시오. 막히면 힌트를 보거나 빈칸으로 두고 눌러도 됩니다.</label>
    <textarea id={id} value={answer} onChange={event => setAnswer(event.target.value)} spellCheck={false} aria-labelledby="question-prompt" />
    <div className="actions"><button className="btn ghost" type="button" id="hint-more" disabled={hintStep >= 2 || revealed} onClick={() => setHintStep(hintStep + 1)}>{hintStep === 0 ? "힌트 보기" : "힌트 더 보기"}</button><button className="btn" type="button" id="reveal" disabled={revealed} onClick={() => setRevealed(true)}>모범 답 보기</button></div>
    <div aria-live="polite">{hintStep >= 1 && <p className="hint" id="hint-verb">쓸 동사: <span className="en">{question.hintVerb}</span></p>}{hintStep >= 2 && <p className="hint" id="hint-words">쓸 말: <span className="en">{question.hintWords.join(" · ")}</span></p>}</div>
    {revealed && <div className="feedback" id="fb"><div role="status"><p className="verdict ok">모범 답</p><p className="en" style={{ fontSize: "1.25rem" }}>{question.answer}</p>
      <p className="note">{question.book === question.answer ? "책 문장 그대로입니다." : <>책 문장: <span className="en">{question.book}</span></>}</p><p className="feel">{question.feel}</p>
    </div><p className="hint">처음 푼 학습자가 고친 곳</p><ul className="fixes">{question.fixes.map(([text, why], index) => <li key={index}><span className="en">{text}</span><span className="muted">{why}</span></li>)}</ul><div className="actions"><button className="btn" type="button" id="next" onClick={onNext}>{last ? "결과 보기" : "다음 문제"}</button></div></div>}
  </>;
}

export function Quiz({ content }: { content: QuizContent }) {
  const [current, setCurrent] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState("");
  const [hintStep, setHintStep] = useState(0);
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
    setSelected(null); setRevealed(false); setAnswer(""); setHintStep(0); moveFocus.current = true; setCurrent(value => value + 1);
  }
  function restart() {
    setSelected(null); setRevealed(false); setAnswer(""); setHintStep(0); setCorrect(0); moveFocus.current = true; setCurrent(0);
  }
  return <section aria-labelledby="quiz-h" id="quiz">
    <div className="quiz-head"><h2 id="quiz-h">장면에서 골라 보기</h2><span className="progress" id="progress" aria-live="polite">{question ? `${current + 1} / ${content.questions.length}` : "끝"}</span></div>
    <p className="muted">{content.description}</p>
    <div id="quiz-card" className="card quiz-question" ref={questionRef} tabIndex={-1} aria-label={question ? `${current + 1}번 문제` : "연습 결과"}>
      {!question ? <div className="done"><span className="eyebrow">고르기 결과</span><span className="score">{correct} / {nChoose}</span><p>{content.done}</p><div className="actions" style={{ justifyContent: "center" }}><button className="btn ghost" type="button" id="again" onClick={restart}>처음부터 다시</button></div></div> : <>
        <p className="meta">{content.book} {question.ch}장 · 말하는 사람: {question.who}</p>{question.type !== "fill" && <p>{question.scene}</p>}<p className="ask" id="question-prompt">{question.ask}</p>
        {question.type === "choose" ? <>
          <div className="opts" role="group" aria-labelledby="question-prompt">{question.opts.map((option, index) => <button key={index} type="button" disabled={selected !== null} className={`opt${selected !== null && option.k === "en" ? " right" : selected === index && option.k !== "en" ? " wrong" : ""}`} onClick={() => {
            if (selected !== null) return;
            setSelected(index); if (option.k === "en") setCorrect(value => value + 1);
          }}><span className="en">{option.t}</span>{selected !== null && <><span><span className={`tag ${kinds[option.k][1]}`}>{kinds[option.k][0]}</span></span><span className="why">{option.why}</span></>}</button>)}</div>
          {selected !== null && <div className="feedback" id="fb"><div role="status"><p className={`verdict ${question.opts[selected].k === "en" ? "ok" : "no"}`}>{question.opts[selected].k === "en" ? "맞습니다." : "영어 화자라면 초록색 문장을 고릅니다."}</p><p className="feel">{question.feel}</p></div><div className="actions"><button className="btn" type="button" id="next" onClick={advance}>다음 문제</button></div></div>}
        </> : question.type === "fill" ? <FillBody question={question} id={`ans-${current}`} answer={answer} setAnswer={setAnswer} hintStep={hintStep} setHintStep={setHintStep} revealed={revealed} setRevealed={setRevealed} last={current === content.questions.length - 1} onNext={advance} />
        : <>
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
