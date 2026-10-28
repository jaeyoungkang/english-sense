"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import askData from "@/content/ask.json";
import "./ask.css";

import { ASK_FOLLOWUP_ENDPOINT, askFollowupLimits, isAskFollowupResponse, isExplanation, type AskMode as Mode, type Explanation } from "@/lib/ask-contract";
import { appendAskEntry, appendAskTurn, askHistoryWindow, completeAskEntry, completeAskTurn, createAskEntry, createAskTurn, failAskEntry, failAskTurn, interruptAskRequest, selectAskEntry, serializeAskRecords, setAskComposer, setAskFollowupDraft, type AskEntry, type AskTurn } from "@/lib/ask-records";
import { useAskRecordStore } from "@/components/ask-record-store";

const contrastOrder = ["영어식", "한국어식 직역", "라틴어 계열"];
const modes: Mode[] = ["explain", "translate"];
const failureMessage = "해설을 만들지 못했습니다. 잠시 뒤 다시 써 주십시오.";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

const statusLabel = { pending: "응답 대기 중", succeeded: "응답 받음", failed: "응답을 받지 못함", unknown: "결과 확인 못함" };
const modeLabel = (mode: Mode) => mode === "explain" ? "영어 해설" : "한국어 변환";
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR");

function downloadRecords(raw: string, original = false) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = `english-sense-ask${original ? "-original" : ""}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Ask() {
  const store = useAskRecordStore();
  const { record, recordRef, update, hydrated, saveState } = store;
  const { mode, text } = record.composer;
  const selected = record.entries.find(entry => entry.id === record.selectedId) ?? null;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const active = useRef<{ controller: AbortController; entryId: string; requestId: string } | null>(null);
  const alive = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.controller.abort(); }; }, []);
  const setComposer = (next: Partial<typeof record.composer>) => update(previous => setAskComposer(previous, { ...previous.composer, ...next }));
  function navigateTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || busy) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? modes.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + modes.length) % modes.length;
    setComposer({ mode: modes[next] }); tabRefs.current[next]?.focus();
  }
  async function execute(entryId: string, requestId: string, endpoint: string, body: unknown, success: (data: unknown) => void, fail: (message: string) => void) {
    const controller = new AbortController();
    let leaving = false;
    const onLeave = () => {
      if (leaving) return;
      leaving = true; controller.abort();
      // Also updates the current page so a bfcache return or cancelled navigation is resumable.
      update(previous => interruptAskRequest(previous, entryId, requestId));
    };
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onLeave);
    active.current = { controller, entryId, requestId }; setBusy(true); setNotice("");
    const timer = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(isRecord(data) && typeof data.detail === "string" ? data.detail : failureMessage);
      if (!leaving && alive.current && active.current?.requestId === requestId) success(data);
    } catch (cause) {
      if (leaving || !alive.current || active.current?.requestId !== requestId) return;
      const error = cause instanceof Error && cause.name === "AbortError" ? "응답을 기다리는 시간이 길어졌습니다. 결과를 확인하지 못했습니다. 다시 요청하면 사용 횟수가 추가로 차감될 수 있습니다." : cause instanceof TypeError ? "서버에 닿지 못했습니다. 요청은 기록에 남아 있습니다. 다시 요청하면 사용 횟수가 추가로 차감될 수 있습니다." : cause instanceof Error ? cause.message : failureMessage;
      fail(error);
    } finally {
      window.clearTimeout(timer);
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pagehide", onLeave);
      if (active.current?.requestId === requestId) { active.current = null; if (alive.current) setBusy(false); }
    }
  }
  async function requestExplanation(retry?: AskEntry) {
    if (!hydrated || active.current || store.blocked.current) return;
    const current = recordRef.current.composer;
    const requestMode = retry?.mode ?? current.mode, trimmed = (retry?.text ?? current.text).trim();
    if (!trimmed) { inputRef.current?.focus(); return; }
    const entry = createAskEntry({ id: crypto.randomUUID(), mode: requestMode, text: trimmed, createdAt: new Date().toISOString(), ...(retry ? { retryOf: retry.id } : {}) });
    const fail = (message: string) => update(previous => failAskEntry(previous, entry.id, message, new Date().toISOString()));
    if (!update(previous => appendAskEntry(previous, entry))) { fail("기록을 저장하지 못해 해설 요청을 보내지 않았습니다."); return; }
    await execute(entry.id, entry.id, `/api/${requestMode}`, { text: trimmed }, data => {
      if (!isExplanation(data)) throw new Error("해설을 읽지 못했습니다. 요청은 기록에 남아 있습니다.");
      update(previous => completeAskEntry(previous, entry.id, data, new Date().toISOString()));
    }, fail);
  }
  async function sendFollowup(entryId: string, retry?: AskTurn) {
    if (!hydrated || active.current || store.blocked.current) return;
    const entry = recordRef.current.entries.find(item => item.id === entryId);
    if (!entry?.result || entry.status !== "succeeded") return;
    const draftAtSend = entry.followupDraft;
    const message = (retry?.message ?? draftAtSend).trim();
    if (!message) return;
    const turn = createAskTurn({ id: crypto.randomUUID(), message, createdAt: new Date().toISOString(), ...(retry ? { retryOf: retry.id } : {}) });
    const history = askHistoryWindow(entry);
    const fail = (error: string) => update(previous => failAskTurn(previous, entry.id, turn.id, error, new Date().toISOString()));
    if (!update(previous => appendAskTurn(previous, entry.id, turn))) { fail("기록을 저장하지 못해 질문을 보내지 않았습니다."); return; }
    await execute(entry.id, turn.id, ASK_FOLLOWUP_ENDPOINT, { recordId: entry.id, requestId: turn.id, mode: entry.mode, text: entry.text, explanation: entry.result, messages: history.messages, message }, data => {
      if (!isAskFollowupResponse(data) || data.recordId !== entry.id || data.requestId !== turn.id) throw new Error("요청한 해설과 맞는 응답을 읽지 못했습니다. 질문은 남아 있습니다.");
      update(previous => {
        const next = completeAskTurn(previous, entry.id, turn.id, data.reply, new Date().toISOString());
        return draftAtSend.trim() === message && next.entries.find(item => item.id === entry.id)?.followupDraft === draftAtSend ? setAskFollowupDraft(next, entry.id, "") : next;
      });
    }, fail);
  }
  function exportRecords(original = false) {
    try {
      const raw = original ? store.original() : serializeAskRecords(recordRef.current);
      if (raw === null) { setNotice("내려받을 원본 기록을 찾지 못했습니다."); return; }
      downloadRecords(raw, original);
    } catch { setNotice("기록 파일을 만들지 못했습니다. 화면을 닫지 말고 다시 시도해 주십시오."); }
  }
  const ownPending = selected?.status === "pending";
  const ownFailed = selected?.status === "failed" || selected?.status === "unknown";
  const contextWindow = selected ? askHistoryWindow(selected) : null;
  return <div className="ask-workspace">
    <section className="ask-entry" aria-labelledby="ask-h">
      <header className="ask-pane-heading"><span aria-hidden="true">01</span><h2 id="ask-h">문장 넣기</h2></header>
      <form className="ask-entry-form" ref={formRef} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void requestExplanation(); }}>
        <div className="ask-modes" role="tablist" aria-label="해설 종류">{modes.map((value, index) => <button key={value} className="ask-mode" role="tab" id={`tab-${value}`} aria-controls="ask-input-panel" aria-selected={mode === value} tabIndex={mode === value ? 0 : -1} disabled={!hydrated || busy} type="button" ref={node => { tabRefs.current[index] = node; }} onClick={() => setComposer({ mode: value })} onKeyDown={event => navigateTab(event, index)}>{value === "explain" ? "영어 문장 해설" : "한국어를 영어로"}</button>)}</div>
        <div className="ask-input-panel" id="ask-input-panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
          <label id="input-label" htmlFor="input">{mode === "explain" ? "해설할 영어 문장을 넣으십시오." : "영어로 옮길 한국어 문장을 넣으십시오."}</label>
          <textarea id="input" ref={inputRef} value={text} disabled={!hydrated} rows={5} maxLength={300} lang={mode === "explain" ? "en" : "ko"} placeholder={mode === "explain" ? "I don't get it." : "그 말이 이해가 안 돼."} onChange={event => setComposer({ text: event.target.value })} aria-describedby="count ask-shortcut ask-note" onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); formRef.current?.requestSubmit(); } }} />
          <div className="ask-input-foot"><span id="ask-shortcut">Ctrl / ⌘ + Enter로 보내기</span><span className="ask-count" id="count">{text.length} / 300</span></div>
          <div className="ask-examples" id="examples" aria-label="예시 문장"><p>이런 문장으로 시작해 보십시오</p>{askData.examples[mode].map(example => <button type="button" lang={mode === "explain" ? "en" : "ko"} key={example} disabled={!hydrated || busy} onClick={() => { setComposer({ text: example }); inputRef.current?.focus(); }}>{example}<span aria-hidden="true">↗</span></button>)}</div>
        </div>
        <button className="ask-submit" type="submit" id="go" disabled={!hydrated || busy || store.blocked.current}>{mode === "explain" ? "해설 보기" : "영어로 옮기기"}<span aria-hidden="true">→</span></button>
        <p className="ask-usage-note" id="ask-note">AI(Claude)가 감각 사전을 바탕으로 만든 해설입니다. 틀릴 수 있습니다. 해설과 추가 질문은 같은 일일 사용 한도를 씁니다.</p>
        <a className="ask-result-jump" href="#res-h">선택한 해설과 대화로 이동 <span aria-hidden="true">↓</span></a>
      </form>
      <section className="ask-archive" aria-labelledby="ask-archive-h"><div className="ask-archive-heading"><h2 id="ask-archive-h">해설 기록 <span>{record.entries.length}개</span></h2><button type="button" disabled={!hydrated || !record.entries.length} onClick={() => exportRecords()}>기록 내려받기</button></div>
        <p className="ask-storage-fact" role="status">{!hydrated ? "기록 확인 중" : saveState === "failed" ? "저장 실패 · 화면에 유지 중" : "이 브라우저에 임시 보관"} · 서버 보관·기기 간 동기화 없음</p>
        {saveState === "failed" && <div className="ask-store-warning" role="status"><p>{store.error}</p>{!store.blocked.current && <button type="button" onClick={store.retry}>저장 다시 시도</button>}<button type="button" onClick={() => exportRecords(true)}>원본 기록 내려받기</button></div>}
        {notice && <p className="ask-store-warning" role="status">{notice}</p>}
        <p className="ask-archive-note">브라우저 데이터를 지우면 기록을 잃을 수 있습니다. 내려받은 파일은 별도로 보관하십시오.</p>
        {record.entries.length ? <ol>{[...record.entries].reverse().map(entry => <li key={entry.id}><button type="button" aria-pressed={selected?.id === entry.id} onClick={() => update(previous => selectAskEntry(previous, entry.id))}><span className="ask-history-meta">{modeLabel(entry.mode)} · <time dateTime={entry.createdAt}>{when(entry.createdAt)}</time></span><span className="ask-history-text" lang={entry.mode === "explain" ? "en" : "ko"}>{entry.text}</span><span className="ask-history-status">{statusLabel[entry.status]}{entry.turns.length > 0 ? ` · 추가 질문 ${entry.turns.length}개` : ""}{entry.retryOf ? " · 다시 요청" : ""}</span></button></li>)}</ol> : <p className="ask-archive-note">아직 남긴 해설 요청이 없습니다. 예시 해설은 기록에 넣지 않습니다.</p>}
      </section>
    </section>
    <section className="ask-result-pane" aria-labelledby="res-h">
      <header className="ask-pane-heading"><span aria-hidden="true">02</span><h2 id="res-h" tabIndex={-1}>해설</h2><span className="ask-result-state" id="res-badge" role="status">{!selected ? "예시 해설" : statusLabel[selected.status]}</span></header>
      {selected && <div className="ask-submitted"><p>{selected.mode === "explain" ? "해설할 영어 문장" : "영어로 옮길 한국어 문장"} · <time dateTime={selected.createdAt}>{when(selected.createdAt)}</time></p><blockquote lang={selected.mode === "explain" ? "en" : "ko"}>{selected.text}</blockquote></div>}
      <div className="ask-result" id="result" aria-live="polite" aria-busy={!!ownPending}>{ownPending ? <div className="ask-waiting"><span className="ask-waiting-mark" aria-hidden="true" /><p>해설을 만들고 있습니다.<span>다른 기록을 열어도 응답은 이 요청에 남습니다.</span></p></div> : ownFailed ? <div className="ask-error"><p role="alert">{selected.error || "페이지를 떠난 요청의 결과는 확인하지 못했습니다. 자동으로 다시 보내지 않았습니다."}</p><p>요청 원문은 기록에 남아 있습니다. 다시 요청하면 새 기록으로 남고 사용 횟수가 추가로 차감될 수 있습니다.</p><button type="button" disabled={busy || store.blocked.current} onClick={() => void requestExplanation(selected)}>이 문장 다시 요청</button></div> : <ExplanationResult data={selected?.result ?? askData.sample as Explanation} />}</div>
      {selected?.result && <section className="ask-followups" aria-labelledby="ask-followups-h"><h2 id="ask-followups-h">이 해설에서 이어 묻기</h2><p className="ask-followup-guide">요청한 문장과 해설, 앞선 질답을 함께 읽고 답합니다. 추가 질문도 기록에 남습니다.</p>
        {selected.turns.length > 0 && <ol className="ask-conversation" aria-label="이 해설의 추가 질문과 답변">{selected.turns.map(turn => <li key={turn.id} data-turn-id={turn.id}><div className="ask-user-turn"><p className="ask-turn-label">내 질문 · <time dateTime={turn.createdAt}>{when(turn.createdAt)}</time>{turn.retryOf ? " · 다시 보냄" : ""}</p><p>{turn.message}</p></div>{turn.status === "succeeded" ? <div className="ask-assistant-turn"><p className="ask-turn-label">AI 답변</p><p>{turn.reply}</p></div> : turn.status === "pending" ? <p className="ask-turn-state" role="status">응답을 기다리고 있습니다.</p> : <div className="ask-turn-state"><p role="status">{turn.error || "페이지를 떠난 요청의 응답을 확인하지 못했습니다. 자동으로 다시 보내지 않았습니다."}</p><button type="button" disabled={busy || store.blocked.current} onClick={() => void sendFollowup(selected.id, turn)}>이 질문 다시 보내기</button><p className="ask-archive-note">새 요청으로 기록하며 사용 횟수가 추가로 차감될 수 있습니다.</p></div>}</li>)}</ol>}
        <form className="ask-followup-form" onSubmit={event => { event.preventDefault(); void sendFollowup(selected.id); }}><label htmlFor="ask-followup">이 해설에 대해 추가 질문하기</label><textarea id="ask-followup" value={selected.followupDraft} maxLength={askFollowupLimits.message} rows={3} onChange={event => { const value = event.target.value; update(previous => setAskFollowupDraft(previous, selected.id, value)); }} aria-describedby="ask-followup-context" onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div className="ask-input-foot"><span>Ctrl / ⌘ + Enter로 보내기</span><span>{[...selected.followupDraft].length} / {askFollowupLimits.message}</span></div><p id="ask-followup-context" className="ask-archive-note">{contextWindow?.droppedCount ? `원래 해설과 최근 질답 ${contextWindow.messages.length / 2}개를 AI에게 보냅니다. 앞선 질답 ${contextWindow.droppedCount}개도 기록에는 남아 있습니다.` : "원래 해설과 이 기록의 앞선 질답을 함께 보냅니다."}</p><button className="ask-submit" type="submit" disabled={busy || !selected.followupDraft.trim() || store.blocked.current}>추가 질문 보내기 <span aria-hidden="true">→</span></button>{busy && active.current?.entryId !== selected.id && <p className="ask-archive-note">다른 기록의 응답을 기다리고 있습니다. 질문 초안은 계속 쓸 수 있습니다.</p>}</form>
      </section>}
    </section>
  </div>;
}
