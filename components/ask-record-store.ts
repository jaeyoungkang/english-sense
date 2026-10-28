"use client";

import { useEffect, useRef, useState } from "react";
import { createAskRecords, restoreAskRecords, serializeAskRecords, type AskRecords } from "@/lib/ask-records";

export const ASK_RECORD_KEY = "english-sense-ask-v1";

/** Browser recovery copy. A successful write here never claims server/canonical preservation. */
export function useAskRecordStore() {
  const [record, setRecord] = useState<AskRecords>(createAskRecords);
  const recordRef = useRef(record);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"loading" | "saved" | "failed">("loading");
  const [error, setError] = useState("");
  const blocked = useRef(false), lastSaved = useRef<string | null>(null);
  function persist(value: AskRecords): boolean {
    try {
      if (blocked.current) return false;
      if (localStorage.getItem(ASK_RECORD_KEY) !== lastSaved.current) {
        blocked.current = true;
        throw new Error("다른 탭에서 기록이 바뀌었습니다. 화면의 기록을 내려받은 뒤 새로고침해 주십시오. 다른 탭의 기록은 덮지 않았습니다.");
      }
      const raw = serializeAskRecords(value);
      localStorage.setItem(ASK_RECORD_KEY, raw);
      lastSaved.current = raw;
      setSaveState("saved"); setError("");
      return true;
    } catch (cause) {
      setSaveState("failed");
      setError(blocked.current && cause instanceof Error ? cause.message : "이 브라우저에 저장하지 못했습니다. 화면의 기록을 내려받아 보관할 수 있습니다.");
      return false;
    }
  }
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ASK_RECORD_KEY);
      lastSaved.current = raw;
      const next = raw === null ? createAskRecords() : restoreAskRecords(raw);
      recordRef.current = next; setRecord(next);
      setSaveState("saved");
      // A request interrupted by leaving the page stays unknown; never re-send on restoration.
      if (raw !== null && serializeAskRecords(next) !== raw) persist(next);
    } catch {
      blocked.current = true;
      setSaveState("failed");
      setError("이전 해설 기록을 읽지 못해 원문을 그대로 보존합니다. 원본 기록을 내려받아 복구할 수 있습니다.");
    }
    setHydrated(true);
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== ASK_RECORD_KEY && event.key !== null)) return;
      if (event.newValue === lastSaved.current && event.key !== null) return;
      blocked.current = true; setSaveState("failed");
      setError("다른 탭에서 기록이 바뀌었습니다. 화면의 기록을 내려받은 뒤 새로고침해 주십시오. 다른 탭의 기록은 덮지 않았습니다.");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  function update(change: (previous: AskRecords) => AskRecords): boolean {
    const next = change(recordRef.current);
    recordRef.current = next; setRecord(next);
    return persist(next);
  }
  const retry = () => persist(recordRef.current);
  const original = () => localStorage.getItem(ASK_RECORD_KEY);
  return { record, recordRef, hydrated, saveState, error, blocked, update, retry, original };
}
