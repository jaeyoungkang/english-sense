"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LEARNING_CHAT_ENDPOINT, isArtifactLearningChatResponse, learningChatLimits, type ArtifactInitialAttempt, type ArtifactLearningChatRequest } from "@/lib/learning-chat-contract";
import type { PublicLearningCatalog } from "@/lib/learning-catalog";
import type { ReferenceMaterial } from "@/lib/reference-materials";
import type { LessonListing } from "@/lib/lesson-list";
import { LessonListDialog } from "@/components/lesson-list-dialog";
import { ReferenceMaterialContent } from "@/components/reference-material";
import { Icon, WorkspaceFrame, useWorkspaceShell, type OutlineItem } from "@/components/workspace-shell";
import { SaveWarning, useRecordStore, useTurnRequests } from "@/components/workspace-session";
import { AssistantReply, QuestionComposer, RequestStatus, UserRequest } from "@/components/workspace-chat";
import { DOCUMENT_UI_STORAGE_KEY, toggleReference, buildDocumentNodes, referenceOutlineId, artifactOutlineId, documentAnchorId } from "@/lib/document-workspace-state";
import { WORKSPACE_LAYOUT_STORAGE_KEY } from "@/lib/workspace-layout-state";
import { WORKSPACE_STORAGE_KEYS, createWorkspace, restoreWorkspace, updateArtifact, selectQuestion, projectDocumentArtifacts, findArtifact, activeThread, submitInitial, addRevision, beginTurn, retryTurn, acceptReply, markTurn, startThread, historyFor, threadLimit, characterCount as chars, type WorkspaceState, type QuizArtifact, type WorkspaceTurn, type WorkspaceEvent } from "@/lib/learning-workspace-state";

const SHELL_STORAGE_KEYS = { document: DOCUMENT_UI_STORAGE_KEY, layout: WORKSPACE_LAYOUT_STORAGE_KEY };

/**
 * The scene lesson (`titanic-have`): learning record v3 and the have reference stack on the shared workspace shell.
 * The shell, record store and request lifecycle are in `workspace-shell.tsx` and `workspace-session.tsx`.
 */
export function LearningWorkspace({ catalog, materials, lessons }: { catalog: PublicLearningCatalog; materials: ReferenceMaterial[]; lessons: LessonListing }) {
  const store = useRecordStore<WorkspaceState>({
    key: WORKSPACE_STORAGE_KEYS.v3,
    initial: () => createWorkspace(catalog),
    load: () => restoreWorkspace({ v3: localStorage.getItem(WORKSPACE_STORAGE_KEYS.v3), v2: localStorage.getItem(WORKSPACE_STORAGE_KEYS.v2), v1: localStorage.getItem(WORKSPACE_STORAGE_KEYS.v1) }, catalog),
    overwritePrompt: "읽지 못한 현재 작업 공간의 임시 기록을 화면의 내용으로 바꾸어 저장합니까? 이전 v1/v2 원본 키는 보존합니다.",
  });
  const { record, recordRef, update, hydrated } = store;
  const turns = useTurnRequests(store);
  const { busy, active } = turns;
  const [notice, setNotice] = useState("");
  const [questionBeforeFor, setQuestionBeforeFor] = useState<string | null>(null);
  const shell = useWorkspaceShell({ storageKeys: SHELL_STORAGE_KEYS, documentMode: "references", hydrated, lastEventId: record.events.at(-1)?.id || null, defaultAnchor: referenceOutlineId("have"), getLastEventId: () => recordRef.current.events.at(-1)?.id || null });
  const { documentState, dialog, setDialog, closeDialog, goToEnd, moveToChat, jumpToOutline, addMaterial } = shell;
  useEffect(() => { const linked = () => { if (["#words", "#resources"].includes(location.hash)) setDialog("resources"); }; linked(); window.addEventListener("hashchange", linked); return () => window.removeEventListener("hashchange", linked); }, []);

  function chooseTarget(id: string, input = false) { const artifact = documentArtifacts.find(artifact => artifact.artifactId === id); if (!artifact) return; update(previous => selectQuestion(previous, catalog, artifact.question.questionId)); setNotice(""); if (input) requestAnimationFrame(() => moveToChat(true)); }
  function openRevision() { const id = recordRef.current.selectedArtifactId; update(previous => updateArtifact(previous, id, item => ({ ...item, revisionOpen: true }))); goToEnd(); requestAnimationFrame(() => moveToChat(true)); }
  function newConversation() {
    const artifact = findArtifact(recordRef.current, recordRef.current.selectedArtifactId);
    if (!confirm(`${numberOf(artifact)}번 퀴즈의 새 대화를 엽니다. 이 퀴즈의 이전 대화와 미전송 초안, 모든 퀴즈의 수행은 남아 있습니다. 계속합니까?`)) return;
    if (active.current?.artifactId === artifact.artifactId) turns.cancel();
    update(previous => startThread(previous, artifact.artifactId)); setNotice("이 퀴즈의 새 대화를 열었습니다. 이전 대화는 위 흐름과 기록에 남아 있습니다."); goToEnd();
  }
  async function sendMessage(artifactId: string, message: string, origin: WorkspaceTurn["origin"] = "question", initialOverride?: ArtifactInitialAttempt, retry?: { threadId: string; turnId: string }) {
    const current = recordRef.current, artifact = findArtifact(current, artifactId), thread = retry ? artifact.threads.find(item => item.id === retry.threadId) : activeThread(artifact), content = message.trim();
    if (!thread || !content || chars(content) > learningChatLimits.message || active.current) return;
    if (artifact.contentVersion !== catalog.contentVersion) { setNotice("이 퀴즈의 자료 판이 현재 자료와 다릅니다. 당시 기록을 보존하고 AI 전송을 막았습니다."); return; }
    const limit = threadLimit(thread); if (limit) { setNotice(limit); return; }
    if (!retry && thread.turns.some(turn => turn.status === "failed")) { setNotice("이 퀴즈의 실패한 요청을 다시 보내거나 접은 뒤 질문합니다."); return; }
    await turns.send({
      artifactId, threadId: thread.id, turnId: retry?.turnId, endpoint: LEARNING_CHAT_ENDPOINT,
      body: (requestId): ArtifactLearningChatRequest => ({ lessonId: catalog.lessonId, questionId: artifact.question.questionId, contentVersion: artifact.contentVersion, artifactId, requestId, initialAttempt: initialOverride || artifact.initialAttempt, revisions: artifact.revisions, messages: historyFor(thread), message: content }),
      onStart: () => { setNotice(""); goToEnd(); },
      begin: (previous, { requestId, turnId }) => {
        const next = retry ? retryTurn(previous, artifactId, thread.id, turnId, requestId) : beginTurn(previous, artifactId, { id: turnId, requestId, user: content, origin, status: "pending" });
        return origin === "question" && !retry ? updateArtifact(next, artifactId, item => ({ ...item, messageDraft: "" })) : next;
      },
      read: (result, requestId) => isArtifactLearningChatResponse(result) && result.requestId === requestId && result.artifactId === artifactId && result.questionId === artifact.question.questionId && result.contentVersion === artifact.contentVersion ? result : null,
      accept: (previous, reply) => acceptReply(previous, reply),
    });
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
  const outlineItems = documentNodes.flatMap<OutlineItem>(node => {
    if (node.kind === "reference") { const material = materials.find(item => item.id === node.reference.id); return material ? [{ id: node.id, title: material.title, label: "감각 자료", referenceId: material.id }] : []; }
    if (node.kind === "artifact") { const artifact = node.artifact; return [{ id: artifactOutlineId(artifact.artifactId), title: `${numberOf(artifact)}. ${artifact.question.ask}`, label: "장면 연습", referenceId: undefined }]; }
    return [];
  });
  const readingMaterial = materials.find(item => item.id === documentState.expandedReferenceId);
  const saveWarning = <SaveWarning store={store} />;
  function firstAnswer(artifact: QuizArtifact) {
    const attempt = artifact.initialAttempt;
    return attempt && <div className="lw-user-performance"><div className="lw-message-meta">나 · {numberOf(artifact)}번 퀴즈 · 처음 제출한 답</div><p className="lw-first-answer">{attempt.kind === "choose" ? artifact.question.opts?.[attempt.choice]?.t : attempt.text}</p>{attempt.reason && <><h3>{attempt.kind === "choose" ? "고른 까닭" : "그렇게 쓴 까닭"}</h3><p className="lw-preserve">{attempt.reason}</p></>}</div>;
  }
  function revisionAnswer(artifact: QuizArtifact, index: number) { return <div className="lw-user-performance lw-revision-turn"><div className="lw-message-meta">나 · {numberOf(artifact)}번 퀴즈 · 수정 {index + 1}</div><p className="lw-preserve">{artifact.revisions[index]?.text}</p><p className="lw-performance-note">처음 답을 유지하고 따로 남긴 수행입니다.</p></div>; }
  const targetLabel = (artifact: QuizArtifact) => `${numberOf(artifact)}번 퀴즈`;
  function userRequest(artifact: QuizArtifact, turn: WorkspaceTurn) { return <UserRequest label={targetLabel(artifact)} turn={turn} />; }
  function assistantReply(artifact: QuizArtifact, turn: WorkspaceTurn) { return <AssistantReply label={targetLabel(artifact)} turn={turn} />; }
  function requestStatus(artifact: QuizArtifact, threadId: string, turn: WorkspaceTurn, requestId: string) {
    return <RequestStatus label={targetLabel(artifact)} turn={turn} requestId={requestId} current={threadId === artifact.activeThreadId} waiting={artifact.initialAttempt ? "장면과 내 답을 살펴보고 있습니다…" : "준비 안내를 가져오고 있습니다…"} busy={busy} locked={artifact.contentVersion !== catalog.contentVersion}
      onRetry={() => void sendMessage(artifact.artifactId, turn.user, turn.origin, undefined, { threadId, turnId: turn.id })}
      onDismiss={() => update(previous => markTurn(previous, artifact.artifactId, threadId, turn.id, requestId, "cancelled", "실패한 요청을 접었습니다. 원래 질문은 그대로 남깁니다."))} />;
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

  return <WorkspaceFrame shell={shell} lessonWord="have" save={{ text: store.saveText, failed: store.saveState === "failed" }} outline={outlineItems}
    toolbarActions={<><button type="button" aria-label="내 수행 기록" title="내 수행 기록" onClick={() => setDialog("records")}><Icon kind="attempt" size={18} /><span>기록</span></button><a href="#resources" aria-label="감각 자료 찾기" title="감각 자료 찾기" onClick={event => { event.preventDefault(); setDialog("resources"); }}><Icon kind="book" size={18} /><span>자료</span></a><button type="button" aria-label="수업 목록" title="수업 목록" onClick={() => setDialog("lessons")}><Icon kind="book" size={18} /><span>수업 목록</span></button><button type="button" onClick={newConversation}>이 퀴즈 새 대화</button></>}
    toc={{ title: <>영어 감각<br />학습 문서</>, lead: "장면을 읽고, 수행과 대화를 남깁니다.", summary: <><p>자료 {documentState.references.length}개 · 문제 {catalog.questions.length}개</p><p>문서 전체의 목차입니다. 읽기와 풀이는 원하는 순서로 합니다.</p></> }}
    referenceStack={<section className="lw-reference lw-reference-stack" aria-label="상단 감각 자료 스택"><div className="lw-reference-stack-inner">{[...documentState.references].reverse().map(reference => { const material = materials.find(item => item.id === reference.id); if (!material) return null; const expanded = documentState.expandedReferenceId === material.id; return <section className="lw-reference-item" data-reference-id={material.id} key={material.id}><button className="lw-reference-toggle" type="button" aria-label={`${material.id} 감각 자료 ${expanded ? "접기" : "펼치기"}`} aria-expanded={expanded} aria-controls={`lw-stack-detail-${material.id}`} onClick={() => shell.setDocumentState(previous => toggleReference(previous, material.id))}><span className="lw-reference-word">{material.id}</span><span>{material.sense}</span><span aria-hidden="true">{expanded ? "−" : "+"}</span></button><div id={`lw-stack-detail-${material.id}`} hidden={!expanded}><ReferenceMaterialContent material={material} compact /></div></section>; })}</div></section>}
    documentHeading={<><p>ENGLISH SENSE · PERSONAL NOTES</p><h2>영어 감각 학습 노트</h2><div><span>{catalog.source.title}</span><span>감각 자료 · 풀이 · 이어지는 대화</span></div></>}
    document={<>{documentNodes.map(node => {
      if (node.kind === "reference") { const material = materials.find(item => item.id === node.reference.id); if (!material) return null; const section = outlineItems.findIndex(item => item.id === node.id) + 1; return <section className="lw-document-reference" data-reference-id={material.id} data-outline-id={node.id} id={documentAnchorId(node.id)} tabIndex={-1} key={node.id}><div className="lw-document-section-label">{String(section).padStart(2, "0")} / 감각 자료</div><h2>{material.title}<span>{material.sense}</span></h2>{node.orphaned && <p className="lw-orphan-notice">추가 위치를 확인하지 못해 문서 끝에 보관한 자료입니다.</p>}<ReferenceMaterialContent material={material} /></section>; }
      const artifact = node.artifact, section = outlineItems.findIndex(item => item.id === node.id) + 1;
      return <div className="lw-content-artifact" data-outline-id={node.id} id={documentAnchorId(node.id)} tabIndex={-1} key={node.id}><div className="lw-document-section-label">{String(section).padStart(2, "0")} / 장면 연습</div>{artifactCard(artifact)}</div>;
    })}</>}
    documentEnd={<p className="lw-document-end">have 학습 문서 끝 · 일곱 문제 가운데 원하는 문제를 골라 풀 수 있습니다.</p>}
    chat={{ context: <><p className="lw-reading-context">펼친 감각 자료: <strong>{readingMaterial?.id || "모두 접힘"}</strong><span>입력 대상: have · {numberOf(selected)}번 퀴즈</span></p><div className="lw-target-selector"><label htmlFor="lw-target">함께 풀 문제</label><select id="lw-target" aria-label="함께 풀 문제" value={record.selectedArtifactId} onChange={event => chooseTarget(event.target.value)}>{documentArtifacts.map(artifact => <option key={artifact.artifactId} value={artifact.artifactId}>{numberOf(artifact)}번 퀴즈 · {artifact.question.type === "choose" ? "고르기" : "쓰기"}</option>)}</select><span>{selected.initialAttempt ? "처음 답·수정·이 대화만 전달" : "첫 답 · 아직 제출 전"}</span></div><p className="lw-target-question">{selected.question.ask}</p><p className="lw-input-stage" role="status">{inputMode === "initial" ? "첫 답과 이유를 남깁니다" : inputMode === "revision" ? "수정한 답을 따로 남깁니다" : "이 퀴즈에 관해 질문합니다"}</p></>, timeline: <>{record.events.map(event => <div className="lw-timeline-event" data-event-kind={event.kind} data-artifact-id={event.artifactId} key={event.id}>{timelineEvent(event)}</div>)}</>, input: <>{inputMode === "initial" && initialAnswerForm(selected)}
      {inputMode === "revision" && <form key={selected.artifactId} className="lw-attempt-form lw-inline-revision" aria-label={`${numberOf(selected)}번 퀴즈 수정`} data-artifact-id={selected.artifactId} onSubmit={submitRevisionForm}><div className="lw-message-meta">{numberOf(selected)}번 퀴즈 · 답을 고쳐 쓰기 · 아직 제출 전</div><label className="lw-field-label" htmlFor="lw-revision">내가 고친 답</label><textarea id="lw-revision" value={selected.revisionDraft} onChange={event => update(previous => updateArtifact(previous, selected.artifactId, item => ({ ...item, revisionDraft: event.target.value })))} required maxLength={learningChatLimits.revision} rows={3} placeholder="처음 답을 덮어쓰지 않고 따로 남깁니다." /><div className="lw-field-foot"><span>{selected.revisions.length} / {learningChatLimits.revisions}회 수정</span><span>{chars(selected.revisionDraft)} / {learningChatLimits.revision}</span></div><div className="lw-form-actions"><button className="lw-button lw-primary" type="submit" disabled={selected.revisions.length >= learningChatLimits.revisions || changedVersion}>수정한 답 남기기</button><button className="lw-text-button" type="button" onClick={() => { update(previous => updateArtifact(previous, selected.artifactId, item => ({ ...item, revisionOpen: false }))); requestAnimationFrame(() => moveToChat(true)); }}>초안을 두고 나중에 쓰기</button></div>{saveWarning}</form>}</>, composer: <>{(limit || notice || changedVersion) && <div className="lw-chat-notice" role="status"><p>{changedVersion ? "이 퀴즈의 자료 판이 현재 자료와 다릅니다. 당시 기록을 보존하고 AI 전송을 막았습니다." : limit || notice}</p>{limit && <button type="button" onClick={newConversation}>수행을 유지하고 이 퀴즈 새 대화</button>}</div>}<div className="lw-composer-tools"><span>{inputMode === "initial" ? "확신이 없어도 지금의 생각을 남깁니다." : inputMode === "revision" ? "처음 답은 그대로 유지합니다." : selected.initialAttempt ? `${numberOf(selected)}번 퀴즈에서 이어 가는 대화` : "답 제출 전 · 무료 준비 안내"}</span>{!selected.initialAttempt ? <button type="button" onClick={() => { setQuestionBeforeFor(inputMode === "initial" ? selected.artifactId : null); requestAnimationFrame(() => moveToChat(true)); }}>{inputMode === "initial" ? "답하기 전에 질문하기" : "첫 답 이어 쓰기"}</button> : inputMode === "question" ? <button type="button" disabled={selected.revisions.length >= learningChatLimits.revisions || changedVersion} onClick={openRevision}><Icon kind="attempt" size={14} />{selected.revisionDraft ? "작성하던 수정 이어 쓰기" : "답을 고쳐 쓰기"}</button> : null}{busy && <button type="button" className="lw-send lw-stop" onClick={turns.cancel}><Icon kind="stop" size={15} /><span>{active.current ? numberOf(findArtifact(record, active.current.artifactId)) : ""}번 응답 중단</span></button>}</div>{inputMode === "question" && <QuestionComposer artifactId={selected.artifactId} label="이 장면에 대해 질문하기" value={selected.messageDraft} placeholder={selected.initialAttempt ? `${numberOf(selected)}번 퀴즈에서 막힌 부분을 물어보십시오…` : "풀기 전에 궁금한 점을 물어보십시오…"} hydrated={hydrated} busy={busy} blocked={!!limit || unresolved || changedVersion} onChange={value => update(previous => updateArtifact(previous, selected.artifactId, item => ({ ...item, messageDraft: value })))} onSend={() => void sendMessage(selected.artifactId, selected.messageDraft)} />}<p className="lw-ai-note">{selected.initialAttempt ? "AI의 답은 틀릴 수 있습니다. 배움이나 완료로 자동 기록하지 않습니다." : "답 제출 전에는 AI 대신 무료 준비 안내를 제공합니다."}</p>{saveWarning}</> }}
    dialog={dialog ? { heading: dialog === "resources" ? "감각 자료 찾기" : dialog === "lessons" ? "수업 목록" : "이 브라우저의 수행과 대화", body: dialog === "lessons" ? <LessonListDialog listing={lessons} /> : <>{dialog === "resources" ? <><p className="lw-dialog-intro">감각 자료를 문서에 추가하거나 이미 추가한 자료를 펼칩니다. 자료를 읽어도 AI 질문 대상과 작성 중인 답은 바뀌지 않습니다.</p><div className="lw-resource-list">{materials.map(material => { const exists = documentState.references.some(item => item.id === material.id); return <div className="lw-resource-row" key={material.id}><div><strong>{material.id}</strong><span>{material.sense}</span></div><button type="button" aria-label={`${material.id} 감각 자료 ${exists ? "펼치기" : "추가"}`} onClick={() => addMaterial(material.id)}>{exists ? "자료 펼치기" : "문서에 추가"}<span aria-hidden="true">＋</span></button><a href={material.href} target="_blank" rel="noopener">공개 설명 ↗<span className="lw-sr-only">새 창</span></a></div>; })}</div><a className="lw-book-resource" href={catalog.source.path} target="_blank" rel="noopener"><Icon kind="book" />책의 장면과 줄거리 읽기 ↗<span className="lw-sr-only">새 창</span></a></> : <><p className="lw-dialog-intro">직접 제출한 수행과 받은 응답만 보입니다. 서버 저장·기기 간 동기화·학습 정본 반영은 제공하지 않습니다.</p>{record.artifacts.map(artifact => <section className="lw-record-block" key={artifact.artifactId}><h3>{numberOf(artifact)}번 퀴즈 · {artifact.question.type === "choose" ? "고르기" : "쓰기"}</h3>{artifact.initialAttempt ? firstAnswer(artifact) : <p className="lw-muted">아직 제출한 답이 없습니다. 작성 중인 답은 해당 퀴즈의 대화 입력에서 이어 씁니다.</p>}{artifact.revisions.map((_, index) => <div key={index}>{revisionAnswer(artifact, index)}</div>)}<h3 className="lw-archive-heading">지난 대화</h3>{artifact.threads.filter(thread => thread.id !== artifact.activeThreadId).map((thread, index) => <details className="lw-archive" key={thread.id}><summary>{numberOf(artifact)}번 퀴즈 대화 {index + 1} · {thread.turns.length}개 요청</summary>{thread.turns.map(turn => <div key={turn.id}><h3>내 요청</h3><p>{turn.user}</p>{turn.reply ? <><h3>{turn.mode === "ai" ? "AI 응답" : "준비 안내"}</h3><p>{turn.reply}</p></> : <p className="lw-muted">응답 없음 · {turn.status === "cancelled" ? "중단" : "실패"}</p>}</div>)}{thread.draft && <div><h3>보내지 않은 메시지</h3><p>{thread.draft}</p></div>}</details>)}{artifact.threads.length === 1 && <p className="lw-muted">지난 대화가 없습니다. 현재 대화는 학습 흐름에 이어져 있습니다.</p>}</section>)}<div className="lw-reset-area"><p>초기화하면 현재 작업 공간의 퀴즈·답·수정·대화·초안을 지웁니다. 가져온 v1/v2 원본은 보존합니다.</p><button type="button" onClick={() => { if (!confirm("현재 작업 공간의 모든 퀴즈·답·수정·대화·초안을 초기화합니까? 이전 버전에서 가져온 원본 키는 보존합니다.")) return; turns.cancel(); store.unblock(); update(() => createWorkspace(catalog)); setNotice(""); closeDialog(); }}>이 장면의 학습 초기화</button></div></>}</> } : null} />;
}
export default LearningWorkspace;
