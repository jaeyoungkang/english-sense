import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { WorkspaceFrame, useWorkspaceShell, type OutlineItem } from "../components/workspace-shell";
import { SaveWarning, useRecordStore } from "../components/workspace-session";
import { AssistantReply, QuestionComposer, RequestStatus, UserRequest } from "../components/workspace-chat";
import { DOCUMENT_UI_STORAGE_KEY, createDocumentState, isDocumentState, restoreDocumentState } from "../lib/document-workspace-state";
import { lessonStorageKeys } from "../lib/lesson-workspace-state";
import { WORKSPACE_LAYOUT_STORAGE_KEY } from "../lib/workspace-layout-state";
import type { WorkspaceTurn } from "../lib/learning-thread";

/**
 * 테스트 전용 가짜 수업 종류. 셸이 수업 종류를 모르고도 문서·목차·대화·입력·상태 칸을 채워 그릴 수 있는지 본다.
 * 프로덕션 경로에는 들어가지 않는다.
 */
type FakeRecord = { artifacts: []; events: { id: string }[]; note: string };
function FakeLesson({ lessonId, withDialog = false }: { lessonId: string; withDialog?: boolean }): ReactNode {
  const keys = lessonStorageKeys(lessonId);
  const store = useRecordStore<FakeRecord>({ key: keys.record, initial: () => ({ artifacts: [], events: [], note: "fake" }), load: () => { throw new Error("서버 렌더링에서는 읽지 않는다."); }, overwritePrompt: "바꿉니까?" });
  const shell = useWorkspaceShell({ storageKeys: { document: keys.document, layout: keys.layout }, documentMode: "plain", hydrated: store.hydrated, lastEventId: null, defaultAnchor: "fake-1", getLastEventId: () => null });
  const outline: OutlineItem[] = [{ id: "fake-1", title: "가짜 구역", label: "읽기" }, { id: "fake-2", title: "가짜 문제", label: "문제" }];
  const turn: WorkspaceTurn = { id: "t1", requestId: "r1", user: "질문입니다", origin: "question", status: "failed", error: "실패했습니다." };
  return createElement(WorkspaceFrame, {
    shell, lessonWord: "fake", save: { text: store.saveText, failed: store.saveState === "failed" }, outline,
    toolbarActions: createElement("button", { type: "button" }, "가짜 도구"),
    toc: { title: "가짜 문서", lead: "가짜 안내", summary: createElement("p", null, "구역 2개") },
    referenceStack: null,
    documentHeading: createElement("h2", null, "가짜 제목"),
    document: outline.map(item => createElement("section", { key: item.id, id: `doc-${item.id}` }, createElement("h2", null, item.title))),
    documentEnd: createElement("p", null, "끝"),
    chat: {
      context: createElement("p", { role: "status" }, "판정 대기 중"),
      timeline: [createElement(UserRequest, { key: "u", label: "가짜 1", turn }), createElement(AssistantReply, { key: "a", label: "가짜 1", turn: { ...turn, status: "complete", reply: "응답입니다", mode: "ai" } }), createElement(RequestStatus, { key: "s", label: "가짜 1", turn, requestId: "r1", current: true, waiting: "기다립니다", busy: false, locked: false, onRetry: () => {}, onDismiss: () => {} })],
      input: createElement("form", { className: "lw-attempt-form" }, createElement("input", { type: "text", name: "fake" })),
      composer: [createElement(QuestionComposer, { key: "q", artifactId: "fake", label: "질문", value: "", placeholder: "묻기", hydrated: false, busy: false, blocked: false, onChange: () => {}, onSend: () => {} }), createElement(SaveWarning, { key: "w", store })],
    },
    dialog: withDialog ? { heading: "가짜 창", body: createElement("p", null, "가짜 내용") } : null,
  });
}
const render = (props: Parameters<typeof FakeLesson>[0]) => renderToStaticMarkup(createElement(FakeLesson, props));

test("a fake lesson kind fills the shell's slots from the registry's storage keys without a reference stack", () => {
  const html = render({ lessonId: "green-umbrella", withDialog: true });
  assert.equal((html.match(/<li>/g) || []).length, 2, "outline items come from the kind");
  assert.match(html, /<small>읽기<\/small>가짜 구역/);
  assert.match(html, /<small>문제<\/small>가짜 문제/);
  assert.match(html, /<span class="lw-word">fake<\/span>/);
  assert.doesNotMatch(html, /lw-reference-stack/);
  assert.match(html, /id="doc-fake-1"/);
  assert.match(html, /role="log"[^>]*>.*가짜 1.*응답입니다.*실패했습니다.*<\/div>/s, "conversation goes in the log region");
  assert.match(html, /판정 대기 중/);
  assert.match(html, /name="fake"/);
  assert.match(html, /id="lw-message"/);
  assert.match(html, /role="status">임시 기록 확인 중<\/span>/);
  assert.match(html, /<dialog class="lw-dialog"[^>]*><header><h2 id="lw-dialog-heading">가짜 창<\/h2>/);
  assert.match(html, /가짜 내용/);
  assert.doesNotMatch(render({ lessonId: "green-umbrella" }), /<dialog/);
});

test("the shell's server render does not read any browser record", () => {
  // renderToString runs without effects, so storage is never touched; a throwing loader proves it.
  assert.doesNotThrow(() => renderToString(createElement(FakeLesson, { lessonId: "wonder-unit-0" })));
});

test("a lesson without references keeps a plain document state under its own key", () => {
  const plain = createDocumentState("plain");
  assert.deepEqual(plain, { version: 1, references: [], expandedReferenceId: null, readingAnchor: null });
  assert.equal(isDocumentState(plain, "plain"), true);
  assert.equal(isDocumentState(plain), false, "the have document always starts from the have reference");
  assert.equal(isDocumentState(createDocumentState()), true);
  assert.equal(isDocumentState(createDocumentState(), "plain"), false, "a plain document has no references");
  assert.equal(isDocumentState({ ...plain, readingAnchor: "artifact-q-green-umbrella-content-1-0123456789ab" }, "plain"), true);
  for (const bad of [{ ...plain, readingAnchor: "a b" }, { ...plain, readingAnchor: 3 }, { ...plain, expandedReferenceId: "have" }, { ...plain, references: [{ id: "have", afterEventId: null }] }, { ...plain, extra: 1 }]) assert.equal(isDocumentState(bad, "plain"), false);
  assert.deepEqual(restoreDocumentState(null, "plain"), { state: plain, recovered: false });
  assert.deepEqual(restoreDocumentState(JSON.stringify(createDocumentState()), "plain"), { state: plain, recovered: true });
  assert.deepEqual(restoreDocumentState("{broken", "plain"), { state: plain, recovered: true });
  const saved = JSON.stringify({ ...plain, readingAnchor: "reading" });
  assert.deepEqual(restoreDocumentState(saved, "plain"), { state: { ...plain, readingAnchor: "reading" }, recovered: false });
});

test("have keeps its existing UI keys and the other lessons get their own", () => {
  assert.deepEqual(lessonStorageKeys("titanic-have"), { recordVersion: 3, record: "english-sense-learning-workspace-v3", document: DOCUMENT_UI_STORAGE_KEY, layout: WORKSPACE_LAYOUT_STORAGE_KEY });
  const story = lessonStorageKeys("green-umbrella"), cards = lessonStorageKeys("wonder-unit-0");
  assert.equal(new Set([story.document, story.layout, cards.document, cards.layout, DOCUMENT_UI_STORAGE_KEY, WORKSPACE_LAYOUT_STORAGE_KEY]).size, 6);
});

test("the shell modules stay free of lesson data and server code", () => {
  for (const name of ["workspace-shell", "workspace-session", "workspace-chat"]) {
    const source = readFileSync(join(import.meta.dirname, "..", "components", `${name}.tsx`), "utf8");
    assert.doesNotMatch(source, /lesson-registry|lib\/server|learning-workspace-state|lesson-workspace-state/, `${name} must not know a lesson's record or registry`);
  }
});
