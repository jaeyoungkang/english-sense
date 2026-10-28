"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import askData from "@/content/ask.json";
import "./ask.css";

type Mode = "explain" | "translate";
type Explanation = {
  english: string; korean: string; picture: string; note: string;
  headwords: { word: string; in_sentence: string; image: string; nuance: string }[];
  contrasts: { kind: string; text: string; note: string }[];
  alternatives: string[];
};
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
  if (!data.english && data.note) return <p className="ask-response-note">{data.note}</p>;
  return <div className="ask-explanation">
    <div className="ask-answer"><p className="en-big" lang="en">{data.english}</p><p className="ask-korean">{data.korean}</p></div>
    {data.picture && <div className="ask-picture"><h3>문장의 그림</h3><p>{data.picture}</p></div>}
    {!!data.headwords.length && <div className="ask-headwords"><h3>표제어의 감각</h3>{data.headwords.map((headword, index) => <div className="ask-headword" key={index}><h4 lang="en">{headword.word}</h4><p className="ask-in-sentence" lang="en">{headword.in_sentence}</p><dl><div><dt>이미지</dt><dd>{headword.image}</dd></div><div><dt>뉘앙스</dt><dd>{headword.nuance}</dd></div></dl></div>)}</div>}
    {!!data.contrasts.length && <div className="ask-contrasts"><h3>같은 장면, 세 문장</h3>{[...data.contrasts].sort((a, b) => contrastOrder.indexOf(a.kind) - contrastOrder.indexOf(b.kind)).map((contrast, index) => <div className="ask-contrast" data-kind={contrast.kind} key={index}><h4>{contrast.kind}</h4><p className="en" lang="en">{contrast.text}</p><p className="ask-contrast-note">{contrast.note}</p></div>)}</div>}
    {!!data.alternatives.length && <div className="ask-alternatives"><h3>다른 장면이라면</h3><ul>{data.alternatives.map((alternative, index) => <li lang="en" key={index}>{alternative}</li>)}</ul></div>}
    {data.note && <p className="ask-response-note">{data.note}</p>}
  </div>;
}
export function Ask() {
  const [mode, setMode] = useState<Mode>("explain");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Explanation>(askData.sample);
  const [sample, setSample] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<{ mode: Mode; text: string } | null>(null);
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
    setSubmitted({ mode, text: trimmed });
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
  return <div className="ask-workspace">
    <section className="ask-entry" aria-labelledby="ask-h">
      <header className="ask-pane-heading"><span aria-hidden="true">01</span><h2 id="ask-h">문장 넣기</h2></header>
      <form className="ask-entry-form" ref={formRef} onSubmit={submit}>
        <div className="ask-modes" role="tablist" aria-label="해설 종류">{modes.map((value, index) => <button key={value} className="ask-mode" role="tab" id={`tab-${value}`} aria-controls="ask-input-panel" aria-selected={mode === value} tabIndex={mode === value ? 0 : -1} disabled={busy} type="button" ref={node => { tabRefs.current[index] = node; }} onClick={() => setMode(value)} onKeyDown={event => navigateTab(event, index)}>{value === "explain" ? "영어 문장 해설" : "한국어를 영어로"}</button>)}</div>
        <div className="ask-input-panel" id="ask-input-panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
          <label id="input-label" htmlFor="input">{mode === "explain" ? "해설할 영어 문장을 넣으십시오." : "영어로 옮길 한국어 문장을 넣으십시오."}</label>
          <textarea id="input" ref={inputRef} value={text} rows={7} maxLength={300} lang={mode === "explain" ? "en" : "ko"} placeholder={mode === "explain" ? "I don't get it." : "그 말이 이해가 안 돼."} onChange={event => setText(event.target.value)} aria-describedby="count ask-shortcut ask-note" onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); formRef.current?.requestSubmit(); } }} />
          <div className="ask-input-foot"><span id="ask-shortcut">Ctrl / ⌘ + Enter로 보내기</span><span className="ask-count" id="count">{text.length} / 300</span></div>
          <div className="ask-examples" id="examples" aria-label="예시 문장"><p>이런 문장으로 시작해 보십시오</p>{askData.examples[mode].map(example => <button type="button" lang={mode === "explain" ? "en" : "ko"} key={example} disabled={busy} onClick={() => { setText(example); inputRef.current?.focus(); }}>{example}<span aria-hidden="true">↗</span></button>)}</div>
        </div>
        <button className="ask-submit" type="submit" id="go" disabled={busy}>{mode === "explain" ? "해설 보기" : "영어로 옮기기"}<span aria-hidden="true">→</span></button>
        <p className="ask-usage-note" id="ask-note">AI(Claude)가 감각 사전을 바탕으로 만든 해설입니다. 틀릴 수 있습니다. 한 사람이 하루 30번까지 쓸 수 있습니다.</p>
      </form>
    </section>
    <section className="ask-result-pane" aria-labelledby="res-h">
      <header className="ask-pane-heading"><span aria-hidden="true">02</span><h2 id="res-h">해설</h2><span className="ask-result-state" id="res-badge" role="status">{sample ? "예시 해설" : busy ? "만드는 중" : error ? "응답을 받지 못했습니다" : "AI 해설"}</span></header>
      {submitted && <div className="ask-submitted"><p>{submitted.mode === "explain" ? "해설할 영어 문장" : "영어로 옮길 한국어 문장"}</p><blockquote lang={submitted.mode === "explain" ? "en" : "ko"}>{submitted.text}</blockquote></div>}
      <div className="ask-result" id="result" aria-live="polite" aria-busy={busy}>{busy ? <div className="ask-waiting"><span className="ask-waiting-mark" aria-hidden="true" /><p>해설을 만들고 있습니다.<span>10초쯤 걸립니다.</span></p></div> : error ? <div className="ask-error"><p role="alert">{error}</p><p>작성 중인 문장은 그대로 남아 있습니다. 다시 보내려면 입력 칸의 단추를 누르십시오.</p></div> : <ExplanationResult data={result} />}</div>
    </section>
  </div>;
}
