"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LESSON_CHECK_ENDPOINT, isLessonCheckResponse, type LessonCheckRequest, type LessonCheckResponse } from "@/lib/lesson-contract";
import { acceptLessonCheck, createLessonState, lessonStorageKeys, loadLessonRecord, type LessonDocument, type LessonState } from "@/lib/lesson-workspace-state";
import { Icon } from "@/components/workspace-shell";
import { useRecordStore, type RecordStore } from "@/components/workspace-session";

/**
 * What the story lesson and the cards lesson build the same way: the lesson record, the request to the free judgement route
 * with its failure state, the "판정" item, the old-version notice and the "수업 목록" link.
 * Each kind decides when to show them and what the judgement says; the markup, class names and wording live here once.
 */

/** The lesson record under this lesson's own key (`english-sense-lesson-v4:<lessonId>`) and the shell's document/layout keys. */
export function useLessonRecord(lesson: LessonDocument, overwritePrompt: string) {
  const keys = lessonStorageKeys(lesson.lessonId);
  const store = useRecordStore<LessonState>({
    key: keys.record,
    initial: () => createLessonState(lesson),
    load: () => { const loaded = loadLessonRecord(key => localStorage.getItem(key), lesson, Date.now()); if (!loaded.ok) throw new Error(loaded.message); return loaded.state; },
    overwritePrompt,
  });
  return { keys, store };
}

export const CHECK_TIMEOUT_MS = 20000;
const detailOf = (body: unknown) => body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : "";

export type CheckOutcome = { ok: true; response: LessonCheckResponse } | { ok: false; message: string };

/**
 * Sends one request to `/api/lesson-check/` (judgement or revealing the answers). Judging is free and idempotent,
 * so the same request may be sent again. A failure comes back as a message for the learner; `stale` replaces the
 * message when the server says the lesson's content version changed (409).
 */
export async function postLessonCheck(request: LessonCheckRequest, stale?: string): Promise<CheckOutcome> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(LESSON_CHECK_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.signal });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 409 && stale) return { ok: false, message: stale };
    if (!response.ok || !isLessonCheckResponse(body)) return { ok: false, message: detailOf(body) };
    return { ok: true, response: body };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error && cause.name === "AbortError" ? "판정을 오래 기다려 중단했습니다." : "서버에 연결하지 못했습니다." };
  } finally { clearTimeout(timeout); }
}

/** A judgement request in flight or failed. It is screen state, not part of the record. */
export type CheckState = { pending: boolean; message: string };

/**
 * Judgement requests by artifact. `send` posts one, writes the response into the record only when it answers that request's
 * target (`acceptLessonCheck`), and otherwise keeps the first answer and shows the failure so the learner can judge again.
 * One request per artifact at a time; a reload makes none.
 */
export function useLessonChecks(store: Pick<RecordStore<LessonState>, "recordRef" | "update">, stale?: string) {
  const { recordRef, update } = store;
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const inFlight = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function send(request: LessonCheckRequest) {
    const { artifactId } = request;
    if (inFlight.current.has(artifactId)) return;
    inFlight.current.add(artifactId);
    setChecks(previous => ({ ...previous, [artifactId]: { pending: true, message: "" } }));
    const outcome = await postLessonCheck(request, stale);
    inFlight.current.delete(artifactId);
    if (!alive.current) return;
    let failed = !outcome.ok, message = outcome.ok ? "" : outcome.message;
    if (outcome.ok) {
      const accepted = acceptLessonCheck(recordRef.current, request, outcome.response);
      if (accepted === recordRef.current && !recordRef.current.artifacts.find(item => item.artifactId === artifactId)?.attempts.at(-1)?.check) { failed = true; message = "요청 대상과 맞는 판정을 읽지 못했습니다."; }
      else update(previous => acceptLessonCheck(previous, request, outcome.response));
    }
    setChecks(previous => { const { [artifactId]: _gone, ...rest } = previous; return failed ? { ...rest, [artifactId]: { pending: false, message } } : rest; });
  }
  /** After the record was replaced by a new one. */
  function clear() { inFlight.current.clear(); setChecks({}); }
  return { checks, send, clear };
}

/**
 * A "판정" item of the conversation: the server's comparison with the canonical answer, drawn apart from the AI's bubbles.
 * `tone` colours the item (same, differs, or the answers the learner asked to see); the kind writes the body as children.
 */
export function JudgementItem({ ariaLabel, head, tone, className, attempt, mark = "판정", children }: {
  ariaLabel: string; head: ReactNode; tone: "same" | "differs" | "reveal"; className?: string; attempt?: number; mark?: string; children: ReactNode;
}) {
  return <div className={`lw-judgement${className ? ` ${className}` : ""}`} role="group" aria-label={ariaLabel} data-judgement={tone} data-attempt-index={attempt}>
    <div className="lw-message-meta"><span className="lw-judgement-mark">{mark}</span>{head}</div>
    {children}
  </div>;
}

/** "정본 답과 같습니다/다릅니다." The wording says the answer was compared, not that it is right. */
export function JudgementLine({ same }: { same: boolean }) {
  return <p className={`lw-judgement-line ${same ? "lw-judgement-same" : "lw-judgement-differs"}`}>{same ? "정본 답과 같습니다." : "정본 답과 다릅니다."}</p>;
}

/**
 * Where a first answer stands without a judgement: waiting for the server, kept as an old version's record (not judged), or
 * failed. A failed judgement keeps the answer and offers to judge again; `message` adds the reason when there is one.
 */
export function JudgementStatus({ state, label, message, onRetry }: { state: "pending" | "old" | "failed"; label: string; message?: string; onRetry: () => void }) {
  if (state === "pending") return <div className="lw-judgement-status lw-waiting" role="status"><span className="lw-pulse" />{label}의 판정을 기다리고 있습니다…</div>;
  if (state === "old") return <div className="lw-judgement-status" role="status"><p>이 기록은 옛 판이라 판정을 받지 않습니다. 첫 답은 남아 있습니다.</p></div>;
  return <div className="lw-judgement-status lw-judgement-failed" role="alert"><p>판정을 받지 못했습니다. 답은 남아 있습니다.</p>{message && <p className="lw-muted">{message}</p>}<button type="button" onClick={onRetry}>다시 판정</button></div>;
}

/**
 * The notice of a record kept from an older content version: it is read only, and one confirmed click replaces
 * this lesson's record with a new one (`onRestart` does that and nothing more). The learner is told it cannot be undone.
 */
export function OldVersionNotice({ className, role = "note", confirmMessage, note, onRestart, children }: {
  className?: string; role?: "note" | "status"; confirmMessage: string; note?: string; onRestart: () => void; children: ReactNode;
}) {
  return <div className={`lw-old-version${className ? ` ${className}` : ""}`} role={role}>
    <p>{children}</p>
    <button type="button" onClick={() => { if (confirm(confirmMessage)) onRestart(); }}>이 기록을 지우고 새 판으로 시작</button>
    {note && <p className="lw-form-note">{note}</p>}
  </div>;
}

/** The toolbar link to the list this lesson belongs to (`/reading/` for a story, `/prep/<작품>/` for a unit). */
export function LessonListLink({ href, title }: { href: string; title?: string }) {
  return <a href={href} aria-label="수업 목록" title={title}><Icon kind="book" size={18} /><span>수업 목록</span></a>;
}

/**
 * One line of the conversation's timeline for an answer, a judgement or a revealed answer. The full judgement and the canonical
 * explanation stay in the document at the question or card; `onJump` offers the way back to them.
 */
export function EventLine({ text, questionId, jumpLabel, onJump }: { text: string; questionId: string; jumpLabel?: string; onJump?: () => void }) {
  return <p className="lw-event-line" data-summary-of={questionId}><span>{text}</span>{onJump && <button type="button" onClick={onJump}>{jumpLabel}</button>}</p>;
}
