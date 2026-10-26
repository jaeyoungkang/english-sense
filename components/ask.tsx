"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import askData from "@/content/ask.json";

type Mode = "explain" | "translate";
type Explanation = {
  english: string; korean: string; picture: string; note: string;
  headwords: { word: string; in_sentence: string; image: string; nuance: string }[];
  contrasts: { kind: string; text: string; note: string }[];
  alternatives: string[];
};
const contrastKinds: Record<string, string> = { "영어식": "en-k", "한국어식 직역": "ko-k", "라틴어 계열": "la-k" };
const contrastOrder = ["영어식", "한국어식 직역", "라틴어 계열"];
const modes: Mode[] = ["explain", "translate"];
const failureMessage = "해설을 만들지 못했습니다. 잠시 뒤 다시 써 주십시오.";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isExplanation(value: unknown): value is Explanation {
  if (!isRecord(value)) return false;
  return ["english", "korean", "picture", "note"].every(key => typeof value[key] === "string") &&
    Array.isArray(value.headwords) && value.headwords.every(h => isRecord(h) && ["word", "in_sentence", "image", "nuance"].every(key => typeof h[key] === "string")) &&
    Array.isArray(value.contrasts) && value.contrasts.every(c => isRecord(c) && ["kind", "text", "note"].every(key => typeof c[key] === "string")) &&
    Array.isArray(value.alternatives) && value.alternatives.every(item => typeof item === "string");
}
function ExplanationResult({ data }: { data: Explanation }) {
  if (!data.english && data.note) return <p>{data.note}</p>;
  return <>
    <div><p className="en-big">{data.english}</p><p className="muted">{data.korean}</p></div>
    <p className="feel">{data.picture}</p>
    {!!data.headwords.length && <div className="hw"><h3>표제어의 감각</h3>{data.headwords.map((headword, index) => <div className="hwc" key={index}><span className="w">{headword.word}</span><span className="muted en">{headword.in_sentence}</span><p><b>이미지</b> {headword.image}</p><p><b>뉘앙스</b> {headword.nuance}</p></div>)}</div>}
    {!!data.contrasts.length && <div className="compare"><h3>같은 장면, 세 문장</h3>{[...data.contrasts].sort((a, b) => contrastOrder.indexOf(a.kind) - contrastOrder.indexOf(b.kind)).map((contrast, index) => <div className={`row${contrast.kind === "영어식" ? " win" : ""}`} key={index}><span><span className={`tag ${contrastKinds[contrast.kind] || "la-k"}`}>{contrast.kind}</span></span><p className="en">{contrast.text}</p><p className="muted">{contrast.note}</p></div>)}</div>}
    {!!data.alternatives.length && <div><h3>다른 장면이라면</h3><ul className="fixes">{data.alternatives.map((alternative, index) => <li key={index}>{alternative}</li>)}</ul></div>}
    {data.note && <p className="hint">{data.note}</p>}
  </>;
}
export function Ask() {
  const [mode, setMode] = useState<Mode>("explain");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Explanation>(askData.sample);
  const [sample, setSample] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  function navigateTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || busy) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? modes.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + modes.length) % modes.length;
    setMode(modes[next]); tabRefs.current[next]?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controllerRef.current) return;
    const trimmed = text.trim();
    if (!trimmed) { inputRef.current?.focus(); return; }
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true); setError(""); setSample(false);
    const timer = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(`/api/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: trimmed }), signal: controller.signal });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(isRecord(data) && typeof data.detail === "string" ? data.detail : failureMessage);
      if (!isExplanation(data)) throw new Error("해설을 읽지 못했습니다. 다시 써 주십시오.");
      setResult(data);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") setError("해설을 기다리는 시간이 길어졌습니다. 잠시 뒤 다시 써 주십시오.");
      else if (cause instanceof TypeError) setError("해설 서버에 닿지 못했습니다. 잠시 뒤 다시 써 주십시오.");
      else setError(cause instanceof Error ? cause.message : failureMessage);
    } finally {
      window.clearTimeout(timer); controllerRef.current = null; setBusy(false);
    }
  }
  return <>
    <section aria-labelledby="ask-h"><h2 className="sr-only" id="ask-h">문장 넣기</h2>
      <form className="card" ref={formRef} onSubmit={submit}>
        <div className="tabs" role="tablist" aria-label="해설 종류">{modes.map((value, index) => <button key={value} className="tab" role="tab" id={`tab-${value}`} aria-controls="ask-input-panel" aria-selected={mode === value} tabIndex={mode === value ? 0 : -1} disabled={busy} type="button" ref={node => { tabRefs.current[index] = node; }} onClick={() => setMode(value)} onKeyDown={event => navigateTab(event, index)}>{value === "explain" ? "영어 문장 해설" : "한국어를 영어로"}</button>)}</div>
        <div className="ask-input-panel" id="ask-input-panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
          <label className="hint" id="input-label" htmlFor="input">{mode === "explain" ? "해설할 영어 문장을 넣으십시오." : "영어로 옮길 한국어 문장을 넣으십시오."}</label>
          <textarea id="input" ref={inputRef} value={text} maxLength={300} placeholder={mode === "explain" ? "I don't get it." : "그 말이 이해가 안 돼."} onChange={event => setText(event.target.value)} aria-describedby="count ask-note" onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); formRef.current?.requestSubmit(); } }} />
          <div className="examples" id="examples" aria-label="예시 문장">{askData.examples[mode].map(example => <button type="button" className="ex" key={example} disabled={busy} onClick={() => { setText(example); inputRef.current?.focus(); }}>{example}</button>)}</div>
        </div>
        <div className="actions" style={{ alignItems: "center" }}><button className="btn" type="submit" id="go" disabled={busy}>{mode === "explain" ? "해설 보기" : "영어로 옮기기"}</button><span className="count" id="count">{text.length} / 300</span></div>
        <p className="note" id="ask-note">AI(Claude)가 감각 사전을 바탕으로 만든 해설입니다. 틀릴 수 있습니다. 한 사람이 하루 30번까지 쓸 수 있습니다.</p>
      </form>
    </section>
    <section aria-labelledby="res-h"><div className="quiz-head"><h2 id="res-h">해설</h2><span className="badge" id="res-badge">{sample ? "예시 해설" : ""}</span></div>
      <div className="card result" id="result" aria-live="polite" aria-busy={busy}>{busy ? <p className="muted"><span className="spin" aria-hidden="true" /> 해설을 만들고 있습니다. 10초쯤 걸립니다.</p> : error ? <p className="err" role="alert">{error}</p> : <ExplanationResult data={result} />}</div>
    </section>
  </>;
}
