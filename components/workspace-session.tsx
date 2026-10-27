"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { markTurn, type ThreadedState } from "@/lib/learning-thread";

/**
 * Record storage and the chat request lifecycle shared by every lesson kind.
 * A kind decides what the record is (learning v3 or lesson v4), how it is read and which request it sends.
 */

type Recorded = ThreadedState;
export type SaveState = "loading" | "saved" | "failed";

export type RecordStore<S extends Recorded> = {
  record: S;
  recordRef: MutableRefObject<S>;
  update: (change: (previous: S) => S) => void;
  hydrated: boolean;
  saveState: SaveState;
  saveError: string;
  /** Text for the session status line. */
  saveText: string;
  retry: () => void;
  /** After a deliberate reset the unreadable record may be overwritten. */
  unblock: () => void;
};

export function useRecordStore<S extends Recorded>(options: {
  key: string;
  initial: () => S;
  /** Reads and validates the stored record. Throws when the stored record cannot be used; the stored text is then kept. */
  load: () => S;
  /** Asked before the unreadable record is replaced by what is on screen. */
  overwritePrompt: string;
}): RecordStore<S> {
  const [record, setRecord] = useState<S>(options.initial);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [saveError, setSaveError] = useState("");
  const recordRef = useRef(record), readBlocked = useRef(false);
  const latest = useRef(options);
  recordRef.current = record;
  latest.current = options;
  const update = useCallback((change: (previous: S) => S) => { setRecord(previous => { const next = change(previous); recordRef.current = next; return next; }); }, []);
  useEffect(() => {
    try { setRecord(latest.current.load()); }
    catch (cause) { readBlocked.current = true; setSaveState("failed"); setSaveError(cause instanceof Error ? cause.message : "이전 임시 기록을 읽지 못했습니다. 원본을 보존합니다."); }
    setHydrated(true);
  }, [options.key]);
  const persist = useCallback((value: S) => {
    try { if (readBlocked.current) throw new Error("blocked"); localStorage.setItem(latest.current.key, JSON.stringify(value)); setSaveState("saved"); setSaveError(""); }
    catch { setSaveState("failed"); }
  }, []);
  useEffect(() => { if (hydrated) persist(record); }, [record, hydrated, persist]);
  function retry() { if (readBlocked.current && !confirm(latest.current.overwritePrompt)) return; readBlocked.current = false; persist(recordRef.current); }
  function unblock() { readBlocked.current = false; }
  const saveText = !hydrated ? "임시 기록 확인 중" : saveState === "failed" ? "임시 저장 실패 · 화면에 유지 중" : "이 브라우저에 임시 저장됨";
  return { record, recordRef, update, hydrated, saveState, saveError, saveText, retry, unblock };
}

export function SaveWarning({ store }: { store: Pick<RecordStore<Recorded>, "saveState" | "saveError" | "retry"> }) {
  return store.saveState === "failed" ? <div className="lw-save-warning" role="status"><span>{store.saveError || "임시 저장하지 못했습니다. 화면을 닫으면 입력을 잃을 수 있습니다."}</span><button type="button" onClick={store.retry}>저장 다시 시도</button></div> : null;
}

export type ActiveRequest = { controller: AbortController; artifactId: string; threadId: string; turnId: string; requestId: string };

/** One chat request at a time. The kind supplies the request body, how a reply is read, and how the record takes it. */
export type TurnPlan<S extends Recorded, R> = {
  artifactId: string;
  threadId: string;
  /** Set when the same turn is sent again. */
  turnId?: string;
  endpoint: string;
  body: (requestId: string) => unknown;
  /** Writes the turn into the record before sending. */
  begin: (previous: S, ids: { requestId: string; turnId: string }) => S;
  /** Runs once the request is registered (clear notices, follow the end of the chat). */
  onStart: () => void;
  /** Returns the reply only if it answers exactly this request's target; null otherwise. */
  read: (result: unknown, requestId: string) => R | null;
  accept: (previous: S, reply: R) => S;
};

export function useTurnRequests<S extends Recorded>(store: Pick<RecordStore<S>, "update">) {
  const { update } = store;
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const active = useRef<ActiveRequest | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; active.current?.controller.abort(); active.current = null; };
  }, []);
  function cancel() {
    const request = active.current; if (!request) return;
    active.current = null; request.controller.abort(); setBusy(false);
    update(previous => markTurn(previous, request.artifactId, request.threadId, request.turnId, request.requestId, "cancelled", "응답 기다리기를 중단했습니다. 이미 시작한 외부 호출의 비용까지 취소되지는 않을 수 있습니다."));
  }
  async function send<R>(plan: TurnPlan<S, R>) {
    const { artifactId, threadId } = plan;
    const requestId = crypto.randomUUID(), turnId = plan.turnId || crypto.randomUUID(), controller = new AbortController();
    const request = { controller, requestId, turnId, artifactId, threadId }; active.current = request; setBusy(true); plan.onStart();
    update(previous => plan.begin(previous, { requestId, turnId }));
    const timeout = window.setTimeout(() => controller.abort(), 70000);
    try {
      const response = await fetch(plan.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan.body(requestId)), signal: controller.signal });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result && typeof result === "object" && "detail" in result && typeof result.detail === "string" ? result.detail : "응답을 받지 못했습니다. 같은 질문을 다시 보낼 수 있습니다.");
      const reply = plan.read(result, requestId);
      if (reply === null) throw new Error("요청 대상과 맞는 응답을 읽지 못했습니다. 질문은 남아 있습니다.");
      if (!alive.current || active.current?.requestId !== requestId) return;
      update(previous => plan.accept(previous, reply));
    } catch (cause) {
      if (!alive.current || active.current?.requestId !== requestId) return;
      const error = cause instanceof Error && cause.name === "AbortError" ? "응답을 오래 기다려 중단했습니다. 같은 질문을 다시 보낼 수 있습니다." : cause instanceof TypeError ? "서버에 연결하지 못했습니다. 질문은 남아 있습니다." : cause instanceof Error ? cause.message : "응답을 받지 못했습니다. 질문은 남아 있습니다.";
      update(previous => markTurn(previous, artifactId, threadId, turnId, requestId, "failed", error));
    } finally { window.clearTimeout(timeout); if (active.current?.requestId === requestId) { active.current = null; if (alive.current) setBusy(false); } }
  }
  return { busy, active, cancel, send };
}
