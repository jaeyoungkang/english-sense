"use client";

import type { FormEvent } from "react";
import { Icon } from "@/components/workspace-shell";
import { learningChatLimits } from "@/lib/learning-chat-contract";
import { characterCount, type WorkspaceTurn } from "@/lib/learning-thread";

/** Conversation pieces every lesson kind shows the same way. `label` names the target ("3번 퀴즈"). */

/** `sentVia` names the button that sent a `submission` turn; the scene lesson sends it from its submit button. */
export function UserRequest({ label, turn, sentVia = "제출 버튼으로 보낸 요청" }: { label: string; turn: WorkspaceTurn; sentVia?: string }) {
  return <div className="lw-user-message"><div className="lw-message-meta">{turn.origin === "submission" ? "피드백 요청" : "나"} · {label}{turn.origin === "submission" && <span>{sentVia}</span>}</div><p>{turn.user}</p></div>;
}

export function AssistantReply({ label, turn }: { label: string; turn: WorkspaceTurn }) {
  return <div className="lw-assistant-message"><div className="lw-message-meta"><span className="lw-reply-mark" aria-hidden="true">e.</span>{turn.mode === "guidance" ? "준비 안내 · AI 호출 없음" : "AI 튜터"} · {label}</div><p>{turn.reply}</p></div>;
}

/** Waiting, failed or cancelled state of a request. Nothing is shown for a completed turn. */
export function RequestStatus({ label, turn, requestId, current, waiting, busy, locked, onRetry, onDismiss }: {
  label: string; turn: WorkspaceTurn; requestId: string;
  /** The turn belongs to the active conversation, so it may be sent again. */
  current: boolean;
  /** What the waiting line says after the label. */
  waiting: string;
  busy: boolean;
  /** The material version no longer matches: sending again is blocked. */
  locked: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (turn.requestId !== requestId) return <p className="lw-old-status">이 요청은 아래에서 다시 시도했습니다.</p>;
  if (turn.status === "complete") return null;
  if (turn.status === "pending") return <div className="lw-waiting" role="status"><span className="lw-pulse" />{label}의 {waiting}</div>;
  return <div className={`lw-request-error ${turn.status === "cancelled" ? "lw-cancelled" : ""}`}><p>{turn.error || "응답 기다리기를 중단했습니다."}</p>{turn.status === "failed" && current && <div><button type="button" onClick={onRetry} disabled={busy || locked}>같은 질문 다시 보내기</button><button type="button" onClick={onDismiss}>이 요청 접기</button></div>}</div>;
}

/** The question box under the conversation. */
export function QuestionComposer({ artifactId, label, value, placeholder, hydrated, busy, blocked, onChange, onSend }: {
  artifactId: string;
  /** Screen reader label of the text box. */
  label: string;
  value: string;
  placeholder: string;
  hydrated: boolean;
  busy: boolean;
  /** Sending is not allowed now (length limit, failed request, other material version). */
  blocked: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  return <form className="lw-composer" data-artifact-id={artifactId} onSubmit={(event: FormEvent) => { event.preventDefault(); onSend(); }}><label className="lw-sr-only" htmlFor="lw-message">{label}</label><textarea id="lw-message" value={value} onChange={event => onChange(event.target.value)} maxLength={learningChatLimits.message} rows={2} placeholder={placeholder} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && !blocked) onSend(); } }} /><div className="lw-composer-bottom"><span>{characterCount(value)} / {learningChatLimits.message}</span>{busy ? <span className="lw-pending-note">응답을 기다리고 있습니다.</span> : <button className="lw-send" type="submit" disabled={!hydrated || !value.trim() || blocked} aria-label="질문 보내기"><Icon kind="arrow" size={20} /></button>}</div></form>;
}
