"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LEARNING_CHAT_ENDPOINT, isArtifactLearningChatResponse, learningChatLimits, type ArtifactInitialAttempt, type ArtifactLearningChatRequest } from "@/lib/learning-chat-contract";
import type { PublicLearningCatalog } from "@/lib/learning-catalog";
import type { ReferenceId, ReferenceMaterial } from "@/lib/reference-materials";
import { ReferenceMaterialContent } from "@/components/reference-material";
import { DOCUMENT_UI_STORAGE_KEY, createDocumentState, restoreDocumentState, addReference, toggleReference, buildDocumentNodes, referenceOutlineId, artifactOutlineId, documentAnchorId, type DocumentWorkspaceState } from "@/lib/document-workspace-state";
import { WORKSPACE_LAYOUT_STORAGE_KEY, createLayoutState, restoreLayoutState, chatRestorePosition, type WorkspaceLayoutState } from "@/lib/workspace-layout-state";
import { WORKSPACE_STORAGE_KEYS, createWorkspace, restoreWorkspace, updateArtifact, selectQuestion, projectDocumentArtifacts, findArtifact, activeThread, submitInitial, addRevision, beginTurn, retryTurn, acceptReply, markTurn, startThread, historyFor, threadLimit, characterCount as chars, type WorkspaceState, type QuizArtifact, type WorkspaceTurn, type WorkspaceEvent } from "@/lib/learning-workspace-state";

function Icon({ kind, size = 20 }: { kind: "scene" | "attempt" | "chat" | "arrow" | "book" | "close" | "stop"; size?: number }) {
  const paths: Record<string, ReactNode> = { scene: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m4 16 5-5 4 4 3-3 5 5M16 8h.01" /></>, attempt: <><path d="m4 20 4-1 12-12-3-3L5 16l-1 4ZM14 7l3 3" /></>, chat: <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />, arrow: <path d="M12 20V4m-6 6 6-6 6 6" />, book: <><path d="M12 5v15M3 4c4-1 6-1 9 1 3-2 5-2 9-1v15c-4-1-6-1-9 1-3-2-5-2-9-1V4Z" /></>, close: <path d="m6 6 12 12M6 18 18 6" />, stop: <rect x="6" y="6" width="12" height="12" /> };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

export function LearningWorkspace({ catalog, materials }: { catalog: PublicLearningCatalog; materials: ReferenceMaterial[] }) {
  const [record, setRecord] = useState<WorkspaceState>(() => createWorkspace(catalog));
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"loading" | "saved" | "failed">("loading");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"resources" | "records" | null>(null);
  const [notice, setNotice] = useState("");
  const [questionBeforeFor, setQuestionBeforeFor] = useState<string | null>(null);
  const [documentState, setDocumentState] = useState<DocumentWorkspaceState>(createDocumentState);
  const [documentReady, setDocumentReady] = useState(false);
  const [documentNotice, setDocumentNotice] = useState("");
  const [layoutState, setLayoutState] = useState<WorkspaceLayoutState>(createLayoutState);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState("");
  const outlineOpen = !layoutState.outlineCollapsed;
  const restoredChat = useRef(false), restoringChat = useRef(false);
  const outlineTrigger = useRef<HTMLButtonElement>(null);
  const restoredReading = useRef(false);
  const allowReadingRestore = useRef(false);
  const [unseen, setUnseen] = useState(false);
  const recordRef = useRef(record), readBlocked = useRef(false), alive = useRef(true);
  const active = useRef<{ controller: AbortController; artifactId: string; threadId: string; turnId: string; requestId: string } | null>(null);
  const contentScroll = useRef<HTMLDivElement>(null), chatScroll = useRef<HTMLDivElement>(null), modal = useRef<HTMLDialogElement>(null);
  const stickToEnd = useRef(false), lastEvent = useRef<string | null>(null), returnFocus = useRef<HTMLElement | null>(null);
  recordRef.current = record;
  const update = useCallback((change: (previous: WorkspaceState) => WorkspaceState) => { setRecord(previous => { const next = change(previous); recordRef.current = next; return next; }); }, []);

  useEffect(() => {
    alive.current = true;
    try { setRecord(restoreWorkspace({ v3: localStorage.getItem(WORKSPACE_STORAGE_KEYS.v3), v2: localStorage.getItem(WORKSPACE_STORAGE_KEYS.v2), v1: localStorage.getItem(WORKSPACE_STORAGE_KEYS.v1) }, catalog)); }
    catch (cause) { readBlocked.current = true; setSaveState("failed"); setSaveError(cause instanceof Error ? cause.message : "이전 임시 기록을 읽지 못했습니다. 원본을 보존합니다."); }
    setHydrated(true);
    return () => { alive.current = false; active.current?.controller.abort(); active.current = null; };
  }, [catalog]);
  const persist = useCallback((value: WorkspaceState) => {
    try { if (readBlocked.current) throw new Error("blocked"); localStorage.setItem(WORKSPACE_STORAGE_KEYS.v3, JSON.stringify(value)); setSaveState("saved"); setSaveError(""); }
    catch { setSaveState("failed"); }
  }, []);
  useEffect(() => { if (hydrated) persist(record); }, [record, hydrated, persist]);
  useEffect(() => {
    try { const raw = localStorage.getItem(DOCUMENT_UI_STORAGE_KEY); const restored = restoreDocumentState(raw); allowReadingRestore.current = raw !== null && !restored.recovered; setDocumentState(restored.state); if (restored.recovered) setDocumentNotice("탐색 설정만 기본값으로 복구했습니다. 학습 기록은 유지합니다."); }
    catch { setDocumentNotice("탐색 설정을 읽지 못했습니다. 학습 기록과 별도로 기본 목차를 사용합니다."); }
    setDocumentReady(true);
  }, []);
  useEffect(() => { if (documentReady) { try { localStorage.setItem(DOCUMENT_UI_STORAGE_KEY, JSON.stringify(documentState)); } catch { setDocumentNotice("탐색 설정을 임시 저장하지 못했습니다. 학습 기록의 저장 상태와는 별도입니다."); } } }, [documentState, documentReady]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY), restored = restoreLayoutState(raw);
      const state = (raw === null || restored.recovered) && !window.matchMedia("(min-width:1100px)").matches ? { ...restored.state, outlineCollapsed: true } : restored.state;
      stickToEnd.current = state.chatAtEnd; setLayoutState(state);
      if (restored.recovered) setLayoutNotice("레이아웃 설정만 기본값으로 복구했습니다. 학습과 자료 기록은 유지합니다.");
    } catch { setLayoutNotice("레이아웃 설정을 읽지 못했습니다. 학습 기록과 별도로 기본 배치를 사용합니다."); }
    setLayoutReady(true);
  }, []);
  useEffect(() => { if (layoutReady) { try { localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(layoutState)); } catch { setLayoutNotice("레이아웃 읽기 위치를 저장하지 못했습니다. 학습 저장 상태와는 별도입니다."); } } }, [layoutState, layoutReady]);
  useEffect(() => {
    if (!layoutReady || !hydrated || restoredChat.current || !chatScroll.current) return;
    restoredChat.current = true; restoringChat.current = true;
    requestAnimationFrame(() => {
      const element = chatScroll.current;
      if (element) element.scrollTo({ top: chatRestorePosition(layoutState, element.scrollHeight, element.clientHeight), behavior: "instant" });
      stickToEnd.current = layoutState.chatAtEnd;
      requestAnimationFrame(() => { restoringChat.current = false; });
    });
  }, [layoutReady, hydrated, layoutState.chatAtEnd, layoutState.chatScrollTop]);
  useEffect(() => {
    if (!documentReady || !layoutReady || !hydrated || restoredReading.current || !allowReadingRestore.current) return;
    restoredReading.current = true;
    requestAnimationFrame(() => { const element = document.getElementById(documentAnchorId(documentState.readingAnchor || referenceOutlineId("have"))); if (element) revealDocumentSection(element); });
  }, [documentReady, layoutReady, hydrated, documentState.readingAnchor]);

  useEffect(() => {
    if (!hydrated) return;
    const id = record.events.at(-1)?.id || null;
    if (lastEvent.current !== null && id !== lastEvent.current) { if (stickToEnd.current && chatScroll.current) chatScroll.current.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "instant" }); else setUnseen(true); }
    lastEvent.current = id;
  }, [record.events, hydrated]);
  useEffect(() => { if (dialog && modal.current) { returnFocus.current = document.activeElement as HTMLElement; modal.current.showModal(); } }, [dialog]);
  useEffect(() => { const linked = () => { if (["#words", "#resources"].includes(location.hash)) setDialog("resources"); }; linked(); window.addEventListener("hashchange", linked); return () => window.removeEventListener("hashchange", linked); }, []);

  useEffect(() => {
    const reading = () => trackDocumentReading();
    window.addEventListener("scroll", reading, { passive: true });
    return () => window.removeEventListener("scroll", reading);
  }, [record.events, documentState.references]);

  function retryStorage() { if (readBlocked.current && !confirm("읽지 못한 현재 작업 공간의 임시 기록을 화면의 내용으로 바꾸어 저장합니까? 이전 v1/v2 원본 키는 보존합니다.")) return; readBlocked.current = false; persist(recordRef.current); }
  function cancelRequest() {
    const request = active.current; if (!request) return;
    active.current = null; request.controller.abort(); setBusy(false);
    update(previous => markTurn(previous, request.artifactId, request.threadId, request.turnId, request.requestId, "cancelled", "응답 기다리기를 중단했습니다. 이미 시작한 외부 호출의 비용까지 취소되지는 않을 수 있습니다."));
  }
  function closeDialog() { modal.current?.close(); setDialog(null); requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true })); }
  function goToEnd() { stickToEnd.current = true; setUnseen(false); requestAnimationFrame(() => { const element = chatScroll.current; if (element) { element.scrollTo({ top: element.scrollHeight, behavior: "instant" }); setLayoutState(previous => ({ ...previous, chatAtEnd: true, chatScrollTop: Math.max(0, element.scrollHeight - element.clientHeight) })); } }); }
  function captureChatReading(element: HTMLDivElement) {
    if (restoringChat.current) return;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    stickToEnd.current = atEnd; if (atEnd) setUnseen(false);
    setLayoutState(previous => previous.chatAtEnd === atEnd && previous.chatScrollTop === element.scrollTop ? previous : { ...previous, chatAtEnd: atEnd, chatScrollTop: element.scrollTop });
  }
  function setOutlineOpen(open: boolean) { setLayoutState(previous => ({ ...previous, outlineCollapsed: !open })); }
  function moveToChat(input = false) {
    const heading = document.getElementById("lw-chat-heading"), field = document.querySelector<HTMLElement>(".lw-chat-pane .lw-attempt-form input, .lw-chat-pane .lw-attempt-form textarea, #lw-message");
    if (!window.matchMedia("(min-width:1100px)").matches) heading?.scrollIntoView({ block: "start", behavior: "instant" });
    (input ? field : heading)?.focus({ preventScroll: true });
    if (input) field?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  function moveToContent() { const element = document.getElementById(documentAnchorId(documentState.readingAnchor || referenceOutlineId("have"))); if (element) revealDocumentSection(element, true); }
  function revealDocumentSection(element: HTMLElement, focus = false) {
    if (focus) element.focus({ preventScroll: true });
    const heading = element.querySelector<HTMLElement>("h2");
    const stack = document.querySelector<HTMLElement>(".lw-reference-stack");
    const offset = window.matchMedia("(min-width:1100px)").matches ? (document.querySelector<HTMLElement>(".lw-toolbar")?.offsetHeight || 54) + (stack?.getBoundingClientRect().height || 0) + 28 : 16;
    // Keep the section's action and title together whenever the viewport can hold them.
    const sectionTop = element.getBoundingClientRect().top;
    const headingWouldBeClipped = heading && heading.getBoundingClientRect().bottom - sectionTop > window.innerHeight - offset - 12;
    const targetTop = headingWouldBeClipped ? heading.getBoundingClientRect().top : sectionTop;
    window.scrollTo({ top: Math.max(0, window.scrollY + targetTop - offset), behavior: "instant" });
  }
  function openOutline() { setOutlineOpen(true); requestAnimationFrame(() => { if (document.activeElement === outlineTrigger.current) document.querySelector<HTMLElement>("#lw-document-outline nav a")?.focus(); }); }
  function closeOutline() { setOutlineOpen(false); requestAnimationFrame(() => outlineTrigger.current?.focus({ preventScroll: window.matchMedia("(min-width:1100px)").matches })); }
  function jumpToOutline(id: string, referenceId?: ReferenceId) {
    setDocumentState(previous => ({ ...previous, readingAnchor: id, ...(referenceId ? { expandedReferenceId: referenceId } : {}) }));
    if (!window.matchMedia("(min-width:1100px)").matches) setOutlineOpen(false);
    requestAnimationFrame(() => { const element = document.getElementById(documentAnchorId(id)); if (element) revealDocumentSection(element, true); });
  }
  function addMaterial(id: ReferenceId) {
    setDocumentState(previous => addReference(previous, id, recordRef.current.events.at(-1)?.id || null));
    if (dialog) closeDialog();
    jumpToOutline(referenceOutlineId(id), id);
  }
  function trackDocumentReading() {
    const container = contentScroll.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
    const stack = document.querySelector<HTMLElement>(".lw-reference-stack");
    const top = window.matchMedia("(min-width:1100px)").matches ? (document.querySelector<HTMLElement>(".lw-toolbar")?.offsetHeight || 54) + (stack?.getBoundingClientRect().height || 0) + 28 : 0;
    let current = outlineItems[0]?.id;
    for (const item of outlineItems) { const element = document.getElementById(documentAnchorId(item.id)); if (element && element.getBoundingClientRect().top <= top + 60) current = item.id; }
    if (current) setDocumentState(previous => previous.readingAnchor === current ? previous : { ...previous, readingAnchor: current! });
  }
  function chooseTarget(id: string, input = false) { const artifact = documentArtifacts.find(artifact => artifact.artifactId === id); if (!artifact) return; update(previous => selectQuestion(previous, catalog, artifact.question.questionId)); setNotice(""); if (input) requestAnimationFrame(() => moveToChat(true)); }
  function openRevision() { const id = recordRef.current.selectedArtifactId; update(previous => updateArtifact(previous, id, item => ({ ...item, revisionOpen: true }))); goToEnd(); requestAnimationFrame(() => moveToChat(true)); }
  function newConversation() {
    const artifact = findArtifact(recordRef.current, recordRef.current.selectedArtifactId);
    if (!confirm(`${numberOf(artifact)}번 퀴즈의 새 대화를 엽니다. 이 퀴즈의 이전 대화와 미전송 초안, 모든 퀴즈의 수행은 남아 있습니다. 계속합니까?`)) return;
    if (active.current?.artifactId === artifact.artifactId) cancelRequest();
    update(previous => startThread(previous, artifact.artifactId)); setNotice("이 퀴즈의 새 대화를 열었습니다. 이전 대화는 위 흐름과 기록에 남아 있습니다."); goToEnd();
  }
  async function sendMessage(artifactId: string, message: string, origin: WorkspaceTurn["origin"] = "question", initialOverride?: ArtifactInitialAttempt, retry?: { threadId: string; turnId: string }) {
    const current = recordRef.current, artifact = findArtifact(current, artifactId), thread = retry ? artifact.threads.find(item => item.id === retry.threadId) : activeThread(artifact), content = message.trim();
    if (!thread || !content || chars(content) > learningChatLimits.message || active.current) return;
    if (artifact.contentVersion !== catalog.contentVersion) { setNotice("이 퀴즈의 자료 판이 현재 자료와 다릅니다. 당시 기록을 보존하고 AI 전송을 막았습니다."); return; }
    const limit = threadLimit(thread); if (limit) { setNotice(limit); return; }
    if (!retry && thread.turns.some(turn => turn.status === "failed")) { setNotice("이 퀴즈의 실패한 요청을 다시 보내거나 접은 뒤 질문합니다."); return; }
    const requestId = crypto.randomUUID(), turnId = retry?.turnId || crypto.randomUUID(), controller = new AbortController();
    const body: ArtifactLearningChatRequest = { lessonId: catalog.lessonId, questionId: artifact.question.questionId, contentVersion: artifact.contentVersion, artifactId, requestId, initialAttempt: initialOverride || artifact.initialAttempt, revisions: artifact.revisions, messages: historyFor(thread), message: content };
    const request = { controller, requestId, turnId, artifactId, threadId: thread.id }; active.current = request; setBusy(true); setNotice(""); goToEnd();
    update(previous => {
      const next = retry ? retryTurn(previous, artifactId, thread.id, turnId, requestId) : beginTurn(previous, artifactId, { id: turnId, requestId, user: content, origin, status: "pending" });
      return origin === "question" && !retry ? updateArtifact(next, artifactId, item => ({ ...item, messageDraft: "" })) : next;
    });
    const timeout = window.setTimeout(() => controller.abort(), 70000);
    try {
      const response = await fetch(LEARNING_CHAT_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result && typeof result === "object" && "detail" in result && typeof result.detail === "string" ? result.detail : "응답을 받지 못했습니다. 같은 질문을 다시 보낼 수 있습니다.");
      if (!isArtifactLearningChatResponse(result) || result.requestId !== requestId || result.artifactId !== artifactId || result.questionId !== artifact.question.questionId || result.contentVersion !== artifact.contentVersion) throw new Error("요청 대상과 맞는 응답을 읽지 못했습니다. 질문은 남아 있습니다.");
      if (!alive.current || active.current?.requestId !== requestId) return;
      update(previous => acceptReply(previous, result));
    } catch (cause) {
      if (!alive.current || active.current?.requestId !== requestId) return;
      const error = cause instanceof Error && cause.name === "AbortError" ? "응답을 오래 기다려 중단했습니다. 같은 질문을 다시 보낼 수 있습니다." : cause instanceof TypeError ? "서버에 연결하지 못했습니다. 질문은 남아 있습니다." : cause instanceof Error ? cause.message : "응답을 받지 못했습니다. 질문은 남아 있습니다.";
      update(previous => markTurn(previous, artifactId, thread.id, turnId, requestId, "failed", error));
    } finally { window.clearTimeout(timeout); if (active.current?.requestId === requestId) { active.current = null; if (alive.current) setBusy(false); } }
  }
  function numberOf(artifact: QuizArtifact) { return catalog.questions.findIndex(question => question.questionId === artifact.question.questionId) + 1; }
  function submitAnswer(event: FormEvent<HTMLFormElement>, artifact: QuizArtifact) {
    event.preventDefault(); if (artifact.initialAttempt || busy || artifact.contentVersion !== catalog.contentVersion) return;
    const reason = artifact.reason.trim();
    const attempt: ArtifactInitialAttempt = artifact.question.type === "choose" ? { kind: "choose", choice: Number(artifact.choice), reason } : { kind: "produce", text: artifact.answerDraft.trim(), ...(reason ? { reason } : {}) };
    if ((attempt.kind === "choose" && (!artifact.choice || !reason)) || (attempt.kind === "produce" && !attempt.text)) { const field = event.currentTarget.querySelector<HTMLTextAreaElement>(attempt.kind === "choose" ? "[name=reason]" : "[name=answer]"); field?.setCustomValidity("한 글자 이상 적어 주십시오."); field?.reportValidity(); return; }
    update(previous => submitInitial(previous, artifact.artifactId, attempt)); goToEnd();
    void sendMessage(artifact.artifactId, "처음 제출한 답과 이유를 장면에 비추어 설명해 주세요. 제가 떠올린 장면을 함께 살펴보고, 스스로 고쳐 볼 지점을 알려 주세요.", "submission", attempt);
    requestAnimationFrame(() => moveToChat(true));
  }
  function submitRevisionForm(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const artifact = findArtifact(recordRef.current, recordRef.current.selectedArtifactId); if (!artifact.revisionDraft.trim()) { const field = event.currentTarget.querySelector<HTMLTextAreaElement>("textarea"); field?.setCustomValidity("수정한 답을 한 글자 이상 적어 주십시오."); field?.reportValidity(); return; } update(previous => addRevision(previous, artifact.artifactId, artifact.revisionDraft)); setNotice(`${numberOf(artifact)}번 퀴즈의 수정을 남겼습니다. 다음 질문에 함께 전달합니다.`); goToEnd(); requestAnimationFrame(() => moveToChat(true)); }
  const selected = findArtifact(record, record.selectedArtifactId), selectedThread = activeThread(selected), limit = threadLimit(selectedThread), unresolved = selectedThread.turns.some(turn => turn.status === "failed"), changedVersion = selected.contentVersion !== catalog.contentVersion;
  const inputMode = !selected.initialAttempt ? (questionBeforeFor === selected.artifactId ? "question" : "initial") : selected.revisionOpen ? "revision" : "question";
  const documentArtifacts = projectDocumentArtifacts(record, catalog);
  const documentNodes = buildDocumentNodes(documentState, record.events, documentArtifacts);
  type OutlineItem = { id: string; title: string; kind: "reference" | "artifact"; referenceId?: ReferenceId };
  const outlineItems = documentNodes.flatMap<OutlineItem>(node => {
    if (node.kind === "reference") { const material = materials.find(item => item.id === node.reference.id); return material ? [{ id: node.id, title: material.title, kind: "reference" as const, referenceId: material.id }] : []; }
    if (node.kind === "artifact") { const artifact = node.artifact; return [{ id: artifactOutlineId(artifact.artifactId), title: `${numberOf(artifact)}. ${artifact.question.ask}`, kind: "artifact" as const, referenceId: undefined }]; }
    return [];
  });
  const readingMaterial = materials.find(item => item.id === documentState.expandedReferenceId);
  function outlineList() { return <ol>{outlineItems.map((item, index) => <li key={item.id}><a href={`#${documentAnchorId(item.id)}`} aria-current={documentState.readingAnchor === item.id ? "location" : undefined} onClick={event => { event.preventDefault(); jumpToOutline(item.id, item.referenceId); }}><span className="lw-outline-number">{String(index + 1).padStart(2, "0")}</span><span><small>{item.kind === "reference" ? "감각 자료" : "장면 연습"}</small>{item.title}</span></a></li>)}</ol>; }
  const saveText = !hydrated ? "임시 기록 확인 중" : saveState === "failed" ? "임시 저장 실패 · 화면에 유지 중" : "이 브라우저에 임시 저장됨";
  const saveWarning = saveState === "failed" ? <div className="lw-save-warning" role="status"><span>{saveError || "임시 저장하지 못했습니다. 화면을 닫으면 입력을 잃을 수 있습니다."}</span><button type="button" onClick={retryStorage}>저장 다시 시도</button></div> : null;
  function firstAnswer(artifact: QuizArtifact) {
    const attempt = artifact.initialAttempt;
    return attempt && <div className="lw-user-performance"><div className="lw-message-meta">나 · {numberOf(artifact)}번 퀴즈 · 처음 제출한 답</div><p className="lw-first-answer">{attempt.kind === "choose" ? artifact.question.opts?.[attempt.choice]?.t : attempt.text}</p>{attempt.reason && <><h3>{attempt.kind === "choose" ? "고른 까닭" : "그렇게 쓴 까닭"}</h3><p className="lw-preserve">{attempt.reason}</p></>}</div>;
  }
  function revisionAnswer(artifact: QuizArtifact, index: number) { return <div className="lw-user-performance lw-revision-turn"><div className="lw-message-meta">나 · {numberOf(artifact)}번 퀴즈 · 수정 {index + 1}</div><p className="lw-preserve">{artifact.revisions[index]?.text}</p><p className="lw-performance-note">처음 답을 유지하고 따로 남긴 수행입니다.</p></div>; }
  function userRequest(artifact: QuizArtifact, turn: WorkspaceTurn) { return <div className="lw-user-message"><div className="lw-message-meta">{turn.origin === "submission" ? "피드백 요청" : "나"} · {numberOf(artifact)}번 퀴즈{turn.origin === "submission" && <span>제출 버튼으로 보낸 요청</span>}</div><p>{turn.user}</p></div>; }
  function assistantReply(artifact: QuizArtifact, turn: WorkspaceTurn) { return <div className="lw-assistant-message"><div className="lw-message-meta"><span className="lw-reply-mark" aria-hidden="true">e.</span>{turn.mode === "guidance" ? "준비 안내 · AI 호출 없음" : "AI 튜터"} · {numberOf(artifact)}번 퀴즈</div><p>{turn.reply}</p></div>; }
  function requestStatus(artifact: QuizArtifact, threadId: string, turn: WorkspaceTurn, requestId: string) {
    if (turn.requestId !== requestId) return <p className="lw-old-status">이 요청은 아래에서 다시 시도했습니다.</p>;
    if (turn.status === "complete") return null;
    if (turn.status === "pending") return <div className="lw-waiting" role="status"><span className="lw-pulse" />{numberOf(artifact)}번 퀴즈의 {artifact.initialAttempt ? "장면과 내 답을 살펴보고 있습니다…" : "준비 안내를 가져오고 있습니다…"}</div>;
    return <div className={`lw-request-error ${turn.status === "cancelled" ? "lw-cancelled" : ""}`}><p>{turn.error || "응답 기다리기를 중단했습니다."}</p>{turn.status === "failed" && threadId === artifact.activeThreadId && <div><button type="button" onClick={() => void sendMessage(artifact.artifactId, turn.user, turn.origin, undefined, { threadId, turnId: turn.id })} disabled={busy || artifact.contentVersion !== catalog.contentVersion}>같은 질문 다시 보내기</button><button type="button" onClick={() => update(previous => markTurn(previous, artifact.artifactId, threadId, turn.id, requestId, "cancelled", "실패한 요청을 접었습니다. 원래 질문은 그대로 남깁니다."))}>이 요청 접기</button></div>}</div>;
  }
  function initialAnswerForm(artifact: QuizArtifact) {
    const question = artifact.question, number = numberOf(artifact), locked = artifact.contentVersion !== catalog.contentVersion;
    return <form key={artifact.artifactId} className="lw-attempt-form lw-initial-input" aria-label={`${number}번 퀴즈 첫 답`} onSubmit={event => submitAnswer(event, artifact)}>{question.type === "choose" ? <fieldset><legend>어떤 문장을 고르겠습니까?</legend>{question.opts?.map((option, index) => <label className="lw-option" key={index}><input id={`${artifact.artifactId}-choice-${index}`} type="radio" name="choice" value={index} checked={artifact.choice === String(index)} onChange={() => update(previous => updateArtifact(previous, artifact.artifactId, item => ({ ...item, choice: String(index) })))} required /><span>{option.t}</span></label>)}</fieldset> : <><label className="lw-field-label" htmlFor={`${artifact.artifactId}-answer`}>내가 쓴 영어 문장</label><textarea id={`${artifact.artifactId}-answer`} name="answer" value={artifact.answerDraft} onChange={event => update(previous => updateArtifact(previous, artifact.artifactId, item => ({ ...item, answerDraft: event.target.value })))} required maxLength={learningChatLimits.answer} rows={3} placeholder="이 장면을 영어로 써 보십시오." spellCheck={false} /></>}<label className="lw-field-label" htmlFor={`${artifact.artifactId}-reason`}>{question.type === "choose" ? "그 문장을 고른 까닭" : "그렇게 쓴 까닭 (선택)"}</label><textarea id={`${artifact.artifactId}-reason`} name="reason" value={artifact.reason} onChange={event => update(previous => updateArtifact(previous, artifact.artifactId, item => ({ ...item, reason: event.target.value })))} required={question.type === "choose"} maxLength={learningChatLimits.reason} placeholder="어떤 장면이 떠올랐는지 적어 보십시오." rows={3} /><div className="lw-field-foot"><span>확신이 없어도 지금의 생각을 남깁니다.</span><span>{chars(artifact.reason)} / {learningChatLimits.reason}</span></div><button className="lw-button lw-primary" type="submit" disabled={!hydrated || busy || locked || unresolved || !!limit}>내 답 제출하고 대화하기 <span aria-hidden="true">→</span></button><p className="lw-form-note">처음 답을 남긴 뒤 이 퀴즈의 AI 피드백을 요청합니다.</p>{saveWarning}</form>;
  }
  function artifactCard(artifact: QuizArtifact) {
    const question = artifact.question, number = numberOf(artifact), locked = artifact.contentVersion !== catalog.contentVersion;
    return <section className={`lw-quiz-artifact ${record.selectedArtifactId === artifact.artifactId ? "lw-artifact-selected" : ""}`} data-artifact-id={artifact.artifactId} data-question-id={question.questionId} data-content-version={artifact.contentVersion} aria-label={`${number}번 퀴즈`}><header className="lw-artifact-header"><div><span className="lw-artifact-index">퀴즈 {number}</span><span>{question.type === "choose" ? "고르기" : "쓰기"} · {question.ch}장</span></div><button type="button" aria-pressed={record.selectedArtifactId === artifact.artifactId} onClick={() => chooseTarget(artifact.artifactId, true)}>이 퀴즈로 이어 가기</button></header><h2>{question.ask}</h2><p className="lw-scene-text">{question.scene}</p><p className="lw-source">말하는 사람: {question.who} · {artifact.source.author}<br /><cite>{artifact.source.title}</cite></p>
      {question.type === "choose" && <ol className="lw-question-options" aria-label={`${number}번 퀴즈 보기`}>{question.opts?.map((option, index) => <li key={index}>{option.t}</li>)}</ol>}
      {artifact.initialAttempt ? <details className="lw-card-performance"><summary>이 퀴즈의 수행 보기 · 처음 답 유지</summary>{firstAnswer(artifact)}{artifact.revisions.map((_, index) => <div key={index}>{revisionAnswer(artifact, index)}</div>)}</details> : <p className="lw-form-note">첫 답은 대화 영역에서 남깁니다.</p>}{locked && <p className="lw-version-warning">이 퀴즈의 자료 판이 현재 자료와 다릅니다. 당시 기록을 보존하고 AI 전송을 막았습니다.</p>}</section>;
  }
  function legacyGroup(artifact: QuizArtifact) {
    const imported = artifact.legacyImport;
    if (!imported) return null;
    const old = imported.record;
    type OldEvent = NonNullable<typeof old.events>[number];
    function oldTurn(turn: WorkspaceTurn, allowReply = true) { return <div className="lw-legacy-turn" key={turn.id}>{userRequest(artifact, turn)}{allowReply && turn.reply ? assistantReply(artifact, turn) : <p className="lw-old-status">이전 기록에는 이 요청의 응답이 없습니다. 자동으로 다시 전송하지 않습니다.</p>}</div>; }
    function oldEvent(event: OldEvent, turns: WorkspaceTurn[]): ReactNode {
      if (event.kind === "initial") return firstAnswer(artifact);
      if (event.kind === "revision") return revisionAnswer(artifact, event.index);
      if (event.kind === "carry") return <details><summary>이전 대화에서 이어 온 수행</summary>{event.hadInitial && firstAnswer(artifact)}{old.revisions.slice(0, event.revisionCount).map((_, index) => <div key={index}>{revisionAnswer(artifact, index)}</div>)}</details>;
      if (event.kind === "legacy") return <div className="lw-legacy-nested"><p>이 묶음에는 수정과 대화 사이의 작성 순서가 남아 있지 않습니다.</p>{event.hadInitial && firstAnswer(artifact)}{old.revisions.slice(0, event.revisionCount).map((_, index) => <div key={index}>{revisionAnswer(artifact, index)}</div>)}{event.turnIds.map(id => { const turn = turns.find(item => item.id === id); return turn && oldTurn(turn, event.repliedTurnIds.includes(id)); })}</div>;
      if (!("turnId" in event)) return null;
      const turn = turns.find(item => item.id === event.turnId);
      if (!turn) return null;
      if (event.kind === "reply") return assistantReply(artifact, turn);
      if (event.kind === "retry") return <p className="lw-old-status">같은 질문을 다시 보낸 기록입니다.</p>;
      return <div>{userRequest(artifact, turn)}{turn.status !== "complete" && <p className="lw-old-status">이전 기록의 미수신 요청입니다. 자동으로 다시 전송하지 않습니다.</p>}</div>;
    }
    function oldThread(turns: WorkspaceTurn[], events?: OldEvent[]) { return events ? events.map(event => <div className="lw-timeline-event" data-event-kind={event.kind} data-artifact-id={artifact.artifactId} key={event.id}>{oldEvent(event, turns)}</div>) : turns.map(turn => oldTurn(turn)); }
    return <section className="lw-legacy-group" aria-label="이전 기록"><h2>이전 기록을 가져왔습니다</h2><p>{imported.version === 1 ? "이전 버전에는 수정과 대화 사이의 작성 순서가 없습니다. 시각이나 순서를 추정하지 않고 한데 모아 보여 줍니다." : "이전 버전의 대화와 수행 순서를 원래 기록대로 보존했습니다. 순서가 없던 이전 묶음은 따로 표시합니다."} 새로 남기는 내용부터 아래에 실제 순서로 쌓입니다.</p><details><summary>이전 수행과 대화 읽기</summary>{imported.version === 1 && <>{old.initialAttempt && firstAnswer(artifact)}{old.revisions.map((_, index) => <div key={index}>{revisionAnswer(artifact, index)}</div>)}</>}{old.archives.map((archive, index) => <section key={archive.id}><h3>이전 대화 {index + 1}</h3>{oldThread(archive.turns, archive.events)}{archive.draft && <p className="lw-preserve">보내지 않은 초안: {archive.draft}</p>}</section>)}{oldThread(old.turns, old.events)}</details></section>;
  }
  function timelineEvent(event: WorkspaceEvent): ReactNode {
    const artifact = findArtifact(record, event.artifactId);
    if (event.kind === "card") return <div className="lw-chat-card-marker"><span>{numberOf(artifact)}</span><p>{numberOf(artifact)}번 퀴즈가 대화에 연결되었습니다.</p><a href={`#${documentAnchorId(artifactOutlineId(artifact.artifactId))}`} onClick={click => { click.preventDefault(); jumpToOutline(artifactOutlineId(artifact.artifactId)); }}>{numberOf(artifact)}번 퀴즈 본문 보기 <span aria-hidden="true">↗</span></a></div>;
    if (event.kind === "initial") return firstAnswer(artifact);
    if (event.kind === "revision") return revisionAnswer(artifact, event.index);
    if (event.kind === "legacy") return legacyGroup(artifact);
    if (!("threadId" in event)) return null;
    const thread = artifact.threads.find(item => item.id === event.threadId);
    if (!thread) return null;
    if (event.kind === "thread") { const previous = artifact.threads[artifact.threads.indexOf(thread) - 1]; return <div className="lw-thread-divider"><h2>{numberOf(artifact)}번 퀴즈 · 새 대화</h2><p>이전 대화와 처음 답·수정은 남아 있습니다.</p>{previous?.draft && <details><summary>이전 대화의 미전송 초안</summary><p className="lw-preserve">{previous.draft}</p></details>}</div>; }
    if (!("turnId" in event)) return null;
    const turn = thread.turns.find(item => item.id === event.turnId);
    if (!turn) return null;
    if (event.kind === "reply") return assistantReply(artifact, turn);
    if (event.kind === "retry") return <div className="lw-retry-event"><p>{numberOf(artifact)}번 퀴즈의 같은 질문을 다시 보냈습니다.</p>{requestStatus(artifact, thread.id, turn, event.requestId)}</div>;
    return <div className="lw-turn">{userRequest(artifact, turn)}{requestStatus(artifact, thread.id, turn, event.requestId)}</div>;
  }

  return <main id="main-content" className="lw-app lw-document-app lw-split-app" data-layout-ready={layoutReady} onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing && outlineOpen && !dialog && (document.getElementById("lw-document-outline")?.contains(event.target as Node) || outlineTrigger.current?.contains(event.target as Node))) { event.preventDefault(); closeOutline(); } }} onInputCapture={event => { if (event.target instanceof HTMLTextAreaElement) event.target.setCustomValidity(""); }}>
    <header className="lw-toolbar"><div className="lw-lesson-title"><button className="lw-outline-toggle" type="button" ref={outlineTrigger} aria-label={outlineOpen ? "목차 접기" : "목차 펼치기"} aria-expanded={outlineOpen} aria-controls="lw-document-outline" onClick={() => { if (outlineOpen) closeOutline(); else openOutline(); }}><span aria-hidden="true">≡</span><span>목차</span></button><a className="lw-mark" href="/" aria-label="영어 감각 홈">e.</a><h1>영어 감각 <span aria-hidden="true">/</span> <span className="lw-word">have</span></h1></div><div className="lw-toolbar-actions"><button type="button" aria-label="내 수행 기록" title="내 수행 기록" onClick={() => setDialog("records")}><Icon kind="attempt" size={18} /><span>기록</span></button><a href="#resources" aria-label="감각 자료 찾기" title="감각 자료 찾기" onClick={event => { event.preventDefault(); setDialog("resources"); }}><Icon kind="book" size={18} /><span>자료</span></a><button type="button" onClick={newConversation}>이 퀴즈 새 대화</button></div></header>
    <div className="lw-session-status"><span className={saveState === "failed" ? "lw-save-failed" : ""} role="status">{saveText}</span><span>계정·개인 서버 저장 없음</span></div>
    <div className="lw-document-shell" data-outline-collapsed={layoutState.outlineCollapsed}><aside className={`lw-document-toc ${outlineOpen ? "lw-toc-open" : ""}`} id="lw-document-outline"><div className="lw-toc-title"><span>STUDY DOCUMENT</span><h2>영어 감각<br />학습 문서</h2><p>장면을 읽고, 수행과 대화를 남깁니다.</p><button type="button" className="lw-mobile-toc-close" onClick={closeOutline}>목차 닫기 <Icon kind="close" size={17} /></button></div><nav aria-label="학습 문서 목차">{outlineList()}</nav><div className="lw-toc-foot"><p>자료 {documentState.references.length}개 · 문제 {catalog.questions.length}개</p><p>문서 전체의 목차입니다. 읽기와 풀이는 원하는 순서로 합니다.</p>{documentNotice && <p role="status">{documentNotice}</p>}{layoutNotice && <p role="status">{layoutNotice}</p>}</div></aside><div className="lw-document-main lw-split-panels"><section className="lw-content-pane" role="region" aria-label="학습 콘텐츠"><header className="lw-pane-header"><h2 id="lw-content-heading" tabIndex={-1}>콘텐츠 문서</h2><button type="button" onClick={() => moveToChat()}>대화로 이동 <span aria-hidden="true">→</span></button></header>    <section className="lw-reference lw-reference-stack" aria-label="상단 감각 자료 스택"><div className="lw-reference-stack-inner">{[...documentState.references].reverse().map(reference => { const material = materials.find(item => item.id === reference.id); if (!material) return null; const expanded = documentState.expandedReferenceId === material.id; return <section className="lw-reference-item" data-reference-id={material.id} key={material.id}><button className="lw-reference-toggle" type="button" aria-label={`${material.id} 감각 자료 ${expanded ? "접기" : "펼치기"}`} aria-expanded={expanded} aria-controls={`lw-stack-detail-${material.id}`} onClick={() => setDocumentState(previous => toggleReference(previous, material.id))}><span className="lw-reference-word">{material.id}</span><span>{material.sense}</span><span aria-hidden="true">{expanded ? "−" : "+"}</span></button><div id={`lw-stack-detail-${material.id}`} hidden={!expanded}><ReferenceMaterialContent material={material} compact /></div></section>; })}</div></section>
<div className="lw-content-scroll" ref={contentScroll} onScroll={trackDocumentReading}><div className="lw-document-flow"><header className="lw-document-heading"><p>ENGLISH SENSE · PERSONAL NOTES</p><h2>영어 감각 학습 노트</h2><div><span>{catalog.source.title}</span><span>감각 자료 · 풀이 · 이어지는 대화</span></div></header>{documentNodes.map(node => {
      if (node.kind === "reference") { const material = materials.find(item => item.id === node.reference.id); if (!material) return null; const section = outlineItems.findIndex(item => item.id === node.id) + 1; return <section className="lw-document-reference" data-reference-id={material.id} data-outline-id={node.id} id={documentAnchorId(node.id)} tabIndex={-1} key={node.id}><div className="lw-document-section-label">{String(section).padStart(2, "0")} / 감각 자료</div><h2>{material.title}<span>{material.sense}</span></h2>{node.orphaned && <p className="lw-orphan-notice">추가 위치를 확인하지 못해 문서 끝에 보관한 자료입니다.</p>}<ReferenceMaterialContent material={material} /></section>; }
      const artifact = node.artifact, section = outlineItems.findIndex(item => item.id === node.id) + 1;
      return <div className="lw-content-artifact" data-outline-id={node.id} id={documentAnchorId(node.id)} tabIndex={-1} key={node.id}><div className="lw-document-section-label">{String(section).padStart(2, "0")} / 장면 연습</div>{artifactCard(artifact)}</div>;
    })}<p className="lw-document-end">have 학습 문서 끝 · 일곱 문제 가운데 원하는 문제를 골라 풀 수 있습니다.</p>
</div></div></section><section className="lw-chat-pane" role="region" aria-label="AI 대화"><header className="lw-pane-header"><h2 id="lw-chat-heading" tabIndex={-1}>AI와 함께 풀기</h2><button type="button" onClick={moveToContent}>콘텐츠로 이동 <span aria-hidden="true">↗</span></button></header><div className="lw-input-context"><p className="lw-reading-context">펼친 감각 자료: <strong>{readingMaterial?.id || "모두 접힘"}</strong><span>입력 대상: have · {numberOf(selected)}번 퀴즈</span></p><div className="lw-target-selector"><label htmlFor="lw-target">함께 풀 문제</label><select id="lw-target" aria-label="함께 풀 문제" value={record.selectedArtifactId} onChange={event => chooseTarget(event.target.value)}>{documentArtifacts.map(artifact => <option key={artifact.artifactId} value={artifact.artifactId}>{numberOf(artifact)}번 퀴즈 · {artifact.question.type === "choose" ? "고르기" : "쓰기"}</option>)}</select><span>{selected.initialAttempt ? "처음 답·수정·이 대화만 전달" : "첫 답 · 아직 제출 전"}</span></div><p className="lw-target-question">{selected.question.ask}</p><p className="lw-input-stage" role="status">{inputMode === "initial" ? "첫 답과 이유를 남깁니다" : inputMode === "revision" ? "수정한 답을 따로 남깁니다" : "이 퀴즈에 관해 질문합니다"}</p></div><div className="lw-conversation-area"><div className="lw-transcript" ref={chatScroll} onScroll={event => captureChatReading(event.currentTarget)}><div className="lw-transcript-inner"><div className="lw-timeline" role="log" aria-label="학습 수행과 대화" aria-live="polite" aria-relevant="additions text">{record.events.map(event => <div className="lw-timeline-event" data-event-kind={event.kind} data-artifact-id={event.artifactId} key={event.id}>{timelineEvent(event)}</div>)}</div>      {inputMode === "initial" && initialAnswerForm(selected)}
      {inputMode === "revision" && <form key={selected.artifactId} className="lw-attempt-form lw-inline-revision" aria-label={`${numberOf(selected)}번 퀴즈 수정`} data-artifact-id={selected.artifactId} onSubmit={submitRevisionForm}><div className="lw-message-meta">{numberOf(selected)}번 퀴즈 · 답을 고쳐 쓰기 · 아직 제출 전</div><label className="lw-field-label" htmlFor="lw-revision">내가 고친 답</label><textarea id="lw-revision" value={selected.revisionDraft} onChange={event => update(previous => updateArtifact(previous, selected.artifactId, item => ({ ...item, revisionDraft: event.target.value })))} required maxLength={learningChatLimits.revision} rows={3} placeholder="처음 답을 덮어쓰지 않고 따로 남깁니다." /><div className="lw-field-foot"><span>{selected.revisions.length} / {learningChatLimits.revisions}회 수정</span><span>{chars(selected.revisionDraft)} / {learningChatLimits.revision}</span></div><div className="lw-form-actions"><button className="lw-button lw-primary" type="submit" disabled={selected.revisions.length >= learningChatLimits.revisions || changedVersion}>수정한 답 남기기</button><button className="lw-text-button" type="button" onClick={() => { update(previous => updateArtifact(previous, selected.artifactId, item => ({ ...item, revisionOpen: false }))); requestAnimationFrame(() => moveToChat(true)); }}>초안을 두고 나중에 쓰기</button></div>{saveWarning}</form>}
</div></div><div className="lw-composer-area">{unseen && <button className="lw-new-response" type="button" onClick={goToEnd}>새 응답 보기 <span aria-hidden="true">↓</span></button>}<div className="lw-composer-inner">{(limit || notice || changedVersion) && <div className="lw-chat-notice" role="status"><p>{changedVersion ? "이 퀴즈의 자료 판이 현재 자료와 다릅니다. 당시 기록을 보존하고 AI 전송을 막았습니다." : limit || notice}</p>{limit && <button type="button" onClick={newConversation}>수행을 유지하고 이 퀴즈 새 대화</button>}</div>}<div className="lw-composer-tools"><span>{inputMode === "initial" ? "확신이 없어도 지금의 생각을 남깁니다." : inputMode === "revision" ? "처음 답은 그대로 유지합니다." : selected.initialAttempt ? `${numberOf(selected)}번 퀴즈에서 이어 가는 대화` : "답 제출 전 · 무료 준비 안내"}</span>{!selected.initialAttempt ? <button type="button" onClick={() => { setQuestionBeforeFor(inputMode === "initial" ? selected.artifactId : null); requestAnimationFrame(() => moveToChat(true)); }}>{inputMode === "initial" ? "답하기 전에 질문하기" : "첫 답 이어 쓰기"}</button> : inputMode === "question" ? <button type="button" disabled={selected.revisions.length >= learningChatLimits.revisions || changedVersion} onClick={openRevision}><Icon kind="attempt" size={14} />{selected.revisionDraft ? "작성하던 수정 이어 쓰기" : "답을 고쳐 쓰기"}</button> : null}{busy && <button type="button" className="lw-send lw-stop" onClick={cancelRequest}><Icon kind="stop" size={15} /><span>{active.current ? numberOf(findArtifact(record, active.current.artifactId)) : ""}번 응답 중단</span></button>}</div>{inputMode === "question" && <form className="lw-composer" data-artifact-id={selected.artifactId} onSubmit={event => { event.preventDefault(); void sendMessage(selected.artifactId, selected.messageDraft); }}><label className="lw-sr-only" htmlFor="lw-message">이 장면에 대해 질문하기</label><textarea id="lw-message" value={selected.messageDraft} onChange={event => update(previous => updateArtifact(previous, selected.artifactId, item => ({ ...item, messageDraft: event.target.value })))} maxLength={learningChatLimits.message} rows={2} placeholder={selected.initialAttempt ? `${numberOf(selected)}번 퀴즈에서 막힌 부분을 물어보십시오…` : "풀기 전에 궁금한 점을 물어보십시오…"} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && !limit && !unresolved && !changedVersion) void sendMessage(selected.artifactId, selected.messageDraft); } }} /><div className="lw-composer-bottom"><span>{chars(selected.messageDraft)} / {learningChatLimits.message}</span>{busy ? <span className="lw-pending-note">응답을 기다리고 있습니다.</span> : <button className="lw-send" type="submit" disabled={!hydrated || !selected.messageDraft.trim() || !!limit || unresolved || changedVersion} aria-label="질문 보내기"><Icon kind="arrow" size={20} /></button>}</div></form>}<p className="lw-ai-note">{selected.initialAttempt ? "AI의 답은 틀릴 수 있습니다. 배움이나 완료로 자동 기록하지 않습니다." : "답 제출 전에는 AI 대신 무료 준비 안내를 제공합니다."}</p>{saveWarning}</div></div></div></section></div></div>
    {dialog && <dialog className="lw-dialog" ref={modal} onCancel={event => { event.preventDefault(); closeDialog(); }} aria-labelledby="lw-dialog-heading"><header><h2 id="lw-dialog-heading">{dialog === "resources" ? "감각 자료 찾기" : "이 브라우저의 수행과 대화"}</h2><button type="button" onClick={closeDialog} aria-label="닫고 학습으로 돌아가기"><Icon kind="close" /></button></header><div className="lw-dialog-scroll">{dialog === "resources" ? <><p className="lw-dialog-intro">감각 자료를 문서에 추가하거나 이미 추가한 자료를 펼칩니다. 자료를 읽어도 AI 질문 대상과 작성 중인 답은 바뀌지 않습니다.</p><div className="lw-resource-list">{materials.map(material => { const exists = documentState.references.some(item => item.id === material.id); return <div className="lw-resource-row" key={material.id}><div><strong>{material.id}</strong><span>{material.sense}</span></div><button type="button" aria-label={`${material.id} 감각 자료 ${exists ? "펼치기" : "추가"}`} onClick={() => addMaterial(material.id)}>{exists ? "자료 펼치기" : "문서에 추가"}<span aria-hidden="true">＋</span></button><a href={material.href} target="_blank" rel="noopener">공개 설명 ↗<span className="lw-sr-only">새 창</span></a></div>; })}</div><a className="lw-book-resource" href={catalog.source.path} target="_blank" rel="noopener"><Icon kind="book" />책의 장면과 줄거리 읽기 ↗<span className="lw-sr-only">새 창</span></a></> : <><p className="lw-dialog-intro">직접 제출한 수행과 받은 응답만 보입니다. 서버 저장·기기 간 동기화·학습 정본 반영은 제공하지 않습니다.</p>{record.artifacts.map(artifact => <section className="lw-record-block" key={artifact.artifactId}><h3>{numberOf(artifact)}번 퀴즈 · {artifact.question.type === "choose" ? "고르기" : "쓰기"}</h3>{artifact.initialAttempt ? firstAnswer(artifact) : <p className="lw-muted">아직 제출한 답이 없습니다. 작성 중인 답은 해당 퀴즈의 대화 입력에서 이어 씁니다.</p>}{artifact.revisions.map((_, index) => <div key={index}>{revisionAnswer(artifact, index)}</div>)}<h3 className="lw-archive-heading">지난 대화</h3>{artifact.threads.filter(thread => thread.id !== artifact.activeThreadId).map((thread, index) => <details className="lw-archive" key={thread.id}><summary>{numberOf(artifact)}번 퀴즈 대화 {index + 1} · {thread.turns.length}개 요청</summary>{thread.turns.map(turn => <div key={turn.id}><h3>내 요청</h3><p>{turn.user}</p>{turn.reply ? <><h3>{turn.mode === "ai" ? "AI 응답" : "준비 안내"}</h3><p>{turn.reply}</p></> : <p className="lw-muted">응답 없음 · {turn.status === "cancelled" ? "중단" : "실패"}</p>}</div>)}{thread.draft && <div><h3>보내지 않은 메시지</h3><p>{thread.draft}</p></div>}</details>)}{artifact.threads.length === 1 && <p className="lw-muted">지난 대화가 없습니다. 현재 대화는 학습 흐름에 이어져 있습니다.</p>}</section>)}<div className="lw-reset-area"><p>초기화하면 현재 작업 공간의 퀴즈·답·수정·대화·초안을 지웁니다. 가져온 v1/v2 원본은 보존합니다.</p><button type="button" onClick={() => { if (!confirm("현재 작업 공간의 모든 퀴즈·답·수정·대화·초안을 초기화합니까? 이전 버전에서 가져온 원본 키는 보존합니다.")) return; cancelRequest(); readBlocked.current = false; update(() => createWorkspace(catalog)); setNotice(""); closeDialog(); }}>이 장면의 학습 초기화</button></div></>}</div></dialog>}
  </main>;
}
export default LearningWorkspace;
