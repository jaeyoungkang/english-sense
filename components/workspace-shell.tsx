"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SiteNavigation } from "@/components/site-navigation";
import type { ReferenceId } from "@/lib/reference-materials";
import { addReference, createDocumentState, documentAnchorId, referenceOutlineId, restoreDocumentState, type DocumentMode, type DocumentWorkspaceState } from "@/lib/document-workspace-state";
import { chatRestorePosition, createLayoutState, restoreLayoutState, type WorkspaceLayoutState } from "@/lib/workspace-layout-state";

/**
 * Document + outline + side chat + toolbar frame shared by every lesson kind.
 * The shell owns reading position, outline, layout, dialog and chat scrolling. It does not know a lesson's
 * record, questions or answer shapes: each kind builds its own body, input forms and chat requests and fills the slots below.
 */

export function Icon({ kind, size = 20 }: { kind: "scene" | "attempt" | "chat" | "arrow" | "book" | "close" | "stop"; size?: number }) {
  const paths: Record<string, ReactNode> = { scene: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m4 16 5-5 4 4 3-3 5 5M16 8h.01" /></>, attempt: <><path d="m4 20 4-1 12-12-3-3L5 16l-1 4ZM14 7l3 3" /></>, chat: <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />, arrow: <path d="M12 20V4m-6 6 6-6 6 6" />, book: <><path d="M12 5v15M3 4c4-1 6-1 9 1 3-2 5-2 9-1v15c-4-1-6-1-9 1-3-2-5-2-9-1V4Z" /></>, close: <path d="m6 6 12 12M6 18 18 6" />, stop: <rect x="6" y="6" width="12" height="12" /> };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

/** One line of the outline. `referenceId` is set only for the have reference materials. */
export type OutlineItem = { id: string; title: string; label: string; referenceId?: ReferenceId };

export type WorkspaceShellOptions = {
  /** Storage keys for the document UI and layout state; `lessonStorageKeys(lessonId)` gives them per lesson. */
  storageKeys: { document: string; layout: string };
  /** "references" is the have document with its reference stack. Other lessons use "plain" (no references). */
  documentMode: DocumentMode;
  /** The record has been read, so restored positions may be applied. */
  hydrated: boolean;
  /** Id of the newest event of the lesson record; a change while the chat is not at its end shows "new response". */
  lastEventId: string | null;
  /** Outline anchor the document starts from when no reading position was saved. */
  defaultAnchor: string;
  /** Newest event id right now, read when a reference is added so its position follows the record. */
  getLastEventId: () => string | null;
};

export function useWorkspaceShell(options: WorkspaceShellOptions) {
  const { storageKeys, documentMode, hydrated, lastEventId, defaultAnchor } = options;
  const [dialog, setDialog] = useState<string | null>(null);
  const [documentState, setDocumentState] = useState<DocumentWorkspaceState>(() => createDocumentState(documentMode));
  const [documentReady, setDocumentReady] = useState(false);
  const [documentNotice, setDocumentNotice] = useState("");
  const [layoutState, setLayoutState] = useState<WorkspaceLayoutState>(createLayoutState);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState("");
  const [unseen, setUnseen] = useState(false);
  const outlineOpen = !layoutState.outlineCollapsed;
  const restoredChat = useRef(false), restoringChat = useRef(false);
  const outlineTrigger = useRef<HTMLButtonElement>(null);
  const restoredReading = useRef(false);
  const allowReadingRestore = useRef(false);
  // The saved reading anchor is taken when the saved state is read: the page may grow at hydration (answers and replies appear in the
  // document), the browser then moves the scroll and the tracker would overwrite the saved anchor before the restore ran.
  const savedAnchor = useRef<string | null>(null), restoreSettled = useRef(true);
  const contentScroll = useRef<HTMLDivElement>(null), chatScroll = useRef<HTMLDivElement>(null), modal = useRef<HTMLDialogElement>(null);
  const stickToEnd = useRef(false), lastEvent = useRef<string | null>(null), returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try { const raw = localStorage.getItem(storageKeys.document); const restored = restoreDocumentState(raw, documentMode); allowReadingRestore.current = raw !== null && !restored.recovered; savedAnchor.current = allowReadingRestore.current ? restored.state.readingAnchor || null : null; restoreSettled.current = !allowReadingRestore.current; setDocumentState(restored.state); if (restored.recovered) setDocumentNotice("탐색 설정만 기본값으로 복구했습니다. 학습 기록은 유지합니다."); }
    catch { setDocumentNotice("탐색 설정을 읽지 못했습니다. 학습 기록과 별도로 기본 목차를 사용합니다."); }
    setDocumentReady(true);
  }, [storageKeys.document, documentMode]);
  useEffect(() => { if (documentReady) { try { localStorage.setItem(storageKeys.document, JSON.stringify(documentState)); } catch { setDocumentNotice("탐색 설정을 임시 저장하지 못했습니다. 학습 기록의 저장 상태와는 별도입니다."); } } }, [documentState, documentReady, storageKeys.document]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKeys.layout), restored = restoreLayoutState(raw);
      const state = (raw === null || restored.recovered) && !window.matchMedia("(min-width:1100px)").matches ? { ...restored.state, outlineCollapsed: true } : restored.state;
      stickToEnd.current = state.chatAtEnd; setLayoutState(state);
      if (restored.recovered) setLayoutNotice("레이아웃 설정만 기본값으로 복구했습니다. 학습과 자료 기록은 유지합니다.");
    } catch { setLayoutNotice("레이아웃 설정을 읽지 못했습니다. 학습 기록과 별도로 기본 배치를 사용합니다."); }
    setLayoutReady(true);
  }, [storageKeys.layout]);
  useEffect(() => { if (layoutReady) { try { localStorage.setItem(storageKeys.layout, JSON.stringify(layoutState)); } catch { setLayoutNotice("레이아웃 읽기 위치를 저장하지 못했습니다. 학습 저장 상태와는 별도입니다."); } } }, [layoutState, layoutReady, storageKeys.layout]);
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
    requestAnimationFrame(() => { const element = document.getElementById(documentAnchorId(savedAnchor.current || defaultAnchor)); if (element) revealDocumentSection(element); restoreSettled.current = true; });
  }, [documentReady, layoutReady, hydrated, documentState.readingAnchor]);
  useEffect(() => {
    if (!hydrated) return;
    if (lastEvent.current !== null && lastEventId !== lastEvent.current) { if (stickToEnd.current && chatScroll.current) chatScroll.current.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "instant" }); else setUnseen(true); }
    lastEvent.current = lastEventId;
  }, [lastEventId, hydrated]);
  useEffect(() => { if (dialog && modal.current) { returnFocus.current = document.activeElement as HTMLElement; modal.current.showModal(); } }, [dialog]);

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
  function moveToContent() { const element = document.getElementById(documentAnchorId(documentState.readingAnchor || defaultAnchor)); if (element) revealDocumentSection(element, true); }
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
    setDocumentState(previous => addReference(previous, id, options.getLastEventId()));
    if (dialog) closeDialog();
    jumpToOutline(referenceOutlineId(id), id);
  }
  return { restoreSettled, documentState, setDocumentState, documentNotice, layoutState, layoutReady, layoutNotice, outlineOpen, dialog, setDialog, unseen, contentScroll, chatScroll, modal, outlineTrigger, closeDialog, goToEnd, captureChatReading, moveToChat, moveToContent, openOutline, closeOutline, jumpToOutline, addMaterial };
}
export type WorkspaceShell = ReturnType<typeof useWorkspaceShell>;

export type WorkspaceFrameProps = {
  shell: WorkspaceShell;
  /** Lesson word after "영어 감각 /" in the toolbar heading. */
  lessonWord: ReactNode;
  toolbarActions: ReactNode;
  currentList?: { href: string; title: string };
  /** Session status line: where the record is kept and whether the last save worked. */
  save: { text: string; failed: boolean };
  serverConnected?: boolean;
  syncBar?: ReactNode;
  outline: OutlineItem[];
  toc: { title: ReactNode; lead: string; /** Counts and the reading note, shown above the notices. */ summary: ReactNode };
  /** Reference stack section. Null for lessons without references. */
  referenceStack: ReactNode | null;
  documentHeading: ReactNode;
  /** The document sections, in document order. */
  document: ReactNode;
  documentEnd: ReactNode;
  /** Chat: what is being worked on (target, stage, judgement status), the conversation, the current input form, and the composer. */
  chat: { context: ReactNode; timeline: ReactNode; input: ReactNode; composer: ReactNode };
  dialog: { heading: string; body: ReactNode } | null;
  /** Fixed layers of the kind (the pen-note tools). They render inside the main landmark, after the dialog. */
  layer?: ReactNode;
};

export function WorkspaceFrame({ shell, lessonWord, toolbarActions, currentList, save, serverConnected, syncBar, outline, toc, referenceStack, documentHeading, document: documentBody, documentEnd, chat, dialog, layer }: WorkspaceFrameProps) {
  const { documentState, layoutState, outlineOpen } = shell;
  const outlineRef = useRef(outline);
  outlineRef.current = outline;
  function trackDocumentReading() {
    const container = shell.contentScroll.current;
    if (!container || !shell.restoreSettled.current) return;
    const bounds = container.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
    const stack = document.querySelector<HTMLElement>(".lw-reference-stack");
    const top = window.matchMedia("(min-width:1100px)").matches ? (document.querySelector<HTMLElement>(".lw-toolbar")?.offsetHeight || 54) + (stack?.getBoundingClientRect().height || 0) + 28 : 0;
    let current = outlineRef.current[0]?.id;
    for (const item of outlineRef.current) { const element = document.getElementById(documentAnchorId(item.id)); if (element && element.getBoundingClientRect().top <= top + 60) current = item.id; }
    if (current) shell.setDocumentState(previous => previous.readingAnchor === current ? previous : { ...previous, readingAnchor: current! });
  }
  useEffect(() => {
    window.addEventListener("scroll", trackDocumentReading, { passive: true });
    return () => window.removeEventListener("scroll", trackDocumentReading);
  }, []);
  return <main id="main-content" className="lw-app lw-document-app lw-split-app" data-layout-ready={shell.layoutReady} onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing && outlineOpen && !shell.dialog && (document.getElementById("lw-document-outline")?.contains(event.target as Node) || shell.outlineTrigger.current?.contains(event.target as Node))) { event.preventDefault(); shell.closeOutline(); } }} onInputCapture={event => { if (event.target instanceof HTMLTextAreaElement) event.target.setCustomValidity(""); }}>
    <header className="lw-toolbar"><div className="lw-lesson-title"><button className="lw-outline-toggle" type="button" ref={shell.outlineTrigger} aria-label={outlineOpen ? "목차 접기" : "목차 펼치기"} aria-expanded={outlineOpen} aria-controls="lw-document-outline" onClick={() => { if (outlineOpen) shell.closeOutline(); else shell.openOutline(); }}><span aria-hidden="true">≡</span><span>목차</span></button><a className="lw-mark" href="/" aria-label="영어 감각 홈">e.</a><h1>영어 감각 <span aria-hidden="true">/</span> <span className="lw-word">{lessonWord}</span></h1></div><SiteNavigation currentList={currentList} /><div className="lw-toolbar-actions">{toolbarActions}</div></header>
    <div className="lw-session-status"><span className={save.failed ? "lw-save-failed" : ""} role="status">{save.text}</span>{serverConnected && <span>개인 서버 보관 연결됨</span>}</div>
    <div className="lw-document-shell" data-outline-collapsed={layoutState.outlineCollapsed}><aside className={`lw-document-toc ${outlineOpen ? "lw-toc-open" : ""}`} id="lw-document-outline"><div className="lw-toc-title"><span>STUDY DOCUMENT</span><h2>{toc.title}</h2><p>{toc.lead}</p><button type="button" className="lw-mobile-toc-close" onClick={shell.closeOutline}>목차 닫기 <Icon kind="close" size={17} /></button></div><nav aria-label="학습 문서 목차"><ol>{outline.map((item, index) => <li key={item.id}><a href={`#${documentAnchorId(item.id)}`} aria-current={documentState.readingAnchor === item.id ? "location" : undefined} onClick={event => { event.preventDefault(); shell.jumpToOutline(item.id, item.referenceId); }}><span className="lw-outline-number">{String(index + 1).padStart(2, "0")}</span><span><small>{item.label}</small>{item.title}</span></a></li>)}</ol></nav><div className="lw-toc-foot">{toc.summary}{shell.documentNotice && <p role="status">{shell.documentNotice}</p>}{shell.layoutNotice && <p role="status">{shell.layoutNotice}</p>}</div></aside><div className="lw-document-main lw-split-panels"><section className="lw-content-pane" role="region" aria-label="학습 콘텐츠"><header className="lw-pane-header"><h2 id="lw-content-heading" tabIndex={-1}>콘텐츠 문서</h2><button type="button" onClick={() => shell.moveToChat()}>대화로 이동 <span aria-hidden="true">→</span></button></header>    {referenceStack}
<div className="lw-content-scroll" ref={shell.contentScroll} onScroll={trackDocumentReading}><div className="lw-document-flow"><header className="lw-document-heading">{documentHeading}</header>{documentBody}{documentEnd}{syncBar}
</div></div></section><section className="lw-chat-pane" role="region" aria-label="AI 대화"><header className="lw-pane-header"><h2 id="lw-chat-heading" tabIndex={-1}>AI와 함께 풀기</h2><button type="button" onClick={shell.moveToContent}>콘텐츠로 이동 <span aria-hidden="true">↗</span></button></header><div className="lw-input-context">{chat.context}</div><div className="lw-conversation-area"><div className="lw-transcript" ref={shell.chatScroll} onScroll={event => shell.captureChatReading(event.currentTarget)}><div className="lw-transcript-inner"><div className="lw-timeline" role="log" aria-label="학습 수행과 대화" aria-live="polite" aria-relevant="additions text">{chat.timeline}</div>      {chat.input}
</div></div><div className="lw-composer-area">{shell.unseen && <button className="lw-new-response" type="button" onClick={shell.goToEnd}>새 응답 보기 <span aria-hidden="true">↓</span></button>}<div className="lw-composer-inner">{chat.composer}</div></div></div></section></div></div>
    {dialog && <dialog className="lw-dialog" ref={shell.modal} onCancel={event => { event.preventDefault(); shell.closeDialog(); }} aria-labelledby="lw-dialog-heading"><header><h2 id="lw-dialog-heading">{dialog.heading}</h2><button type="button" onClick={shell.closeDialog} aria-label="닫고 학습으로 돌아가기"><Icon kind="close" /></button></header><div className="lw-dialog-scroll">{dialog.body}</div></dialog>}
    {layer}
  </main>;
}
