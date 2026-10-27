"use client";

import { Fragment, useState } from "react";
import { checkBlanks, splitBlanks } from "@/lib/fill-blank";

type Props = { cardId: string; sentence: string; answers: string[]; hint: string; source: string };
type Result = "idle" | "right" | "wrong" | "revealed";

export function FillDrill({ cardId, sentence, answers, hint, source }: Props) {
  const pieces = splitBlanks(sentence);
  const [inputs, setInputs] = useState(() => answers.map(() => ""));
  const [result, setResult] = useState<Result>("idle");
  const [each, setEach] = useState<boolean[]>([]);
  const locked = result === "right" || result === "revealed";
  const many = answers.length > 1;

  function check() {
    if (locked) return;
    const checked = checkBlanks(inputs, answers);
    setEach(checked.each);
    setResult(checked.correct ? "right" : "wrong");
  }

  return <form className="drill" aria-label="빈칸 채우기" onSubmit={event => { event.preventDefault(); check(); }}>
    <p className="hint drill-label">빈칸 채우기 · 한국어 힌트: {hint}</p>
    <p className="en drill-sentence">{pieces.map((piece, i) => <Fragment key={i}>
      {piece}
      {i < answers.length && <input
        className={`blank${result === "wrong" && !each[i] ? " miss" : ""}${result === "right" ? " done" : result === "revealed" ? " shown" : ""}`}
        id={`${cardId}-blank-${i}`} aria-label={many ? `빈칸 ${i + 1}` : "빈칸"}
        value={result === "revealed" ? answers[i] : inputs[i]} readOnly={locked}
        autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        size={12}
        onChange={event => { const next = [...inputs]; next[i] = event.target.value; setInputs(next); if (result === "wrong") setResult("idle"); }} />}
    </Fragment>)}</p>
    <p className="note">{source}</p>
    <div className="actions">
      <button className="btn" type="submit" disabled={locked}>확인</button>
      <button className="btn ghost" type="button" disabled={locked} onClick={() => setResult("revealed")}>답 보기</button>
    </div>
    <p className="drill-result" role="status" aria-live="polite">
      {result === "right" && <span className="verdict ok">맞습니다.</span>}
      {result === "wrong" && <span className="verdict no">아직 아닙니다. 고쳐 쓰거나 답을 보십시오.</span>}
      {result === "revealed" && <span className="verdict">답: <span className="en">{answers.join(" … ")}</span></span>}
    </p>
  </form>;
}
