import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CHECK_TIMEOUT_MS, JudgementItem, JudgementLine, JudgementStatus, LessonListLink, OldVersionNotice, postLessonCheck } from "../components/lesson-common";
import type { LessonCheckRequest } from "../lib/lesson-contract";
import { getLessonContentVersion } from "../lib/server/lesson-catalog";
import { handleLessonCheck } from "../lib/server/lesson-check";
import { readLessonChatResponse, type LessonChatResponse } from "../lib/lesson-chat-contract";
import { storyExplainRequestMessage } from "../lib/story-lesson";
import { isLessonChatRequest, type LessonChatRequest } from "../lib/lesson-chat-contract";
import { explainRequestMessage } from "../lib/card-lesson";
import { getStudySource } from "../lib/server/study-source";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const { reading } = getStudySource();
const story = reading.stories[0];

test("the judgement item is one markup for both lessons: group name, tone, mark, attempt and the kind's own class", () => {
  const same = html(createElement(JudgementItem, { ariaLabel: "문제 1 서버 판정", head: "문제 1 · 정본과 대조한 결과 · AI 아님", tone: "same", children: createElement(JudgementLine, { same: true }) }));
  assert.match(same, /^<div class="lw-judgement" role="group" aria-label="문제 1 서버 판정" data-judgement="same">/);
  assert.match(same, /<span class="lw-judgement-mark">판정<\/span>문제 1 · 정본과 대조한 결과 · AI 아님/);
  assert.match(same, /<p class="lw-judgement-line lw-judgement-same">정본 답과 같습니다\.<\/p>/);
  const card = html(createElement(JudgementItem, { ariaLabel: "카드 1 첫 답 서버 판정", head: "카드 1", tone: "differs", className: "cl-judgement", attempt: 0, children: createElement(JudgementLine, { same: false }) }));
  assert.match(card, /class="lw-judgement cl-judgement"/);
  assert.match(card, /data-judgement="differs" data-attempt-index="0"/);
  assert.match(card, /lw-judgement-differs">정본 답과 다릅니다\./);
  const reveal = html(createElement(JudgementItem, { ariaLabel: "정본 답", head: "카드 1", tone: "reveal", mark: "정본 답", children: "x" }));
  assert.match(reveal, /<span class="lw-judgement-mark">정본 답<\/span>/);
  for (const text of [same, card, reveal]) assert.ok(!text.includes("정답입니다"));
});

test("a first answer without a judgement shows waiting, old version or failed with the reason and a retry button", () => {
  const retry = () => {};
  const pending = html(createElement(JudgementStatus, { state: "pending", label: "문제 2", onRetry: retry }));
  assert.match(pending, /^<div class="lw-judgement-status lw-waiting" role="status"><span class="lw-pulse"><\/span>문제 2의 판정을 기다리고 있습니다…<\/div>$/);
  const old = html(createElement(JudgementStatus, { state: "old", label: "문제 2", onRetry: retry }));
  assert.match(old, /옛 판이라 판정을 받지 않습니다\. 첫 답은 남아 있습니다\./);
  assert.ok(!old.includes("<button"));
  const failed = html(createElement(JudgementStatus, { state: "failed", label: "문제 2", message: "서버에 연결하지 못했습니다.", onRetry: retry }));
  assert.match(failed, /class="lw-judgement-status lw-judgement-failed" role="alert"/);
  assert.match(failed, /판정을 받지 못했습니다\. 답은 남아 있습니다\.<\/p><p class="lw-muted">서버에 연결하지 못했습니다\.<\/p><button type="button">다시 판정<\/button>/);
  assert.ok(!html(createElement(JudgementStatus, { state: "failed", label: "카드 1", onRetry: retry })).includes("lw-muted"));
});

test("the old-version notice and the list link carry the shared wording and the kind's class", () => {
  const notice = html(createElement(OldVersionNotice, { className: "cl-old-banner", role: "status", confirmMessage: "지웁니까?", onRestart: () => {}, children: "옛 판입니다." }));
  assert.match(notice, /^<div class="lw-old-version cl-old-banner" role="status"><p>옛 판입니다\.<\/p><button type="button">이 기록을 지우고 새 판으로 시작<\/button><\/div>$/);
  assert.match(html(createElement(OldVersionNotice, { note: "하나만 지웁니다.", confirmMessage: "x", onRestart: () => {}, children: "a" })), /^<div class="lw-old-version" role="note">.*<p class="lw-form-note">하나만 지웁니다\.<\/p>/);
  const link = html(createElement(LessonListLink, { href: "/prep/wonder/", title: "이 작품의 유닛 목록" }));
  assert.match(link, /^<a href="\/prep\/wonder\/" aria-label="수업 목록" title="이 작품의 유닛 목록">/);
  assert.match(link, /<span>수업 목록<\/span><\/a>$/);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const lessonRequest = async (): Promise<LessonCheckRequest> => ({ action: "check", lessonId: story.id, questionId: story.questions[0].id, contentVersion: await getLessonContentVersion(story.id), artifactId: "quiz-1", requestId: "req-1", attempt: { kind: "choose", choice: 0 } });

test("posting a judgement request: the response, a stale version, a bad body, a lost connection and a timeout each come back as one outcome", async () => {
  const request = await lessonRequest();
  const seen: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
    return handleLessonCheck(new Request("https://english.example/api/lesson-check/", { method: "POST", headers: { "content-type": "application/json" }, body: String(init.body) }));
  }) as typeof fetch;
  const ok = await postLessonCheck(request);
  assert.ok(ok.ok && ok.response.kind === "choose" && ok.response.requestId === "req-1");
  assert.deepEqual(seen.map(item => [item.url, item.method]), [["/api/lesson-check/", "POST"]]);
  assert.deepEqual(seen[0].body, request);
  // The same request again gives the same result: judging is idempotent.
  const again = await postLessonCheck(request);
  assert.deepEqual(again, ok);

  const stale = await postLessonCheck({ ...request, contentVersion: "0".repeat(64) }, "자료 판이 달라졌습니다.");
  assert.deepEqual(stale, { ok: false, message: "자료 판이 달라졌습니다." });
  // Without a stale message the server's own detail is kept.
  const detail = await postLessonCheck({ ...request, contentVersion: "0".repeat(64) });
  assert.equal(detail.ok, false);
  assert.ok(!detail.ok && detail.message.length > 0 && detail.message !== "자료 판이 달라졌습니다.");

  globalThis.fetch = (async () => new Response("<html>", { status: 500 })) as typeof fetch;
  assert.deepEqual(await postLessonCheck(request), { ok: false, message: "" });
  globalThis.fetch = (async () => new Response(JSON.stringify({ any: "thing" }), { status: 200 })) as typeof fetch;
  assert.deepEqual(await postLessonCheck(request), { ok: false, message: "" });
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  assert.deepEqual(await postLessonCheck(request), { ok: false, message: "서버에 연결하지 못했습니다." });
  globalThis.fetch = (async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as typeof fetch;
  const started = Date.now(), timers: (() => void)[] = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => { assert.equal(delay, CHECK_TIMEOUT_MS); timers.push(callback); return realSetTimeout(() => {}, 0); }) as typeof setTimeout;
  try {
    const waiting = postLessonCheck(request);
    timers[0]();
    assert.deepEqual(await waiting, { ok: false, message: "판정을 오래 기다려 중단했습니다." });
  } finally { globalThis.setTimeout = realSetTimeout; }
  assert.ok(Date.now() - started < CHECK_TIMEOUT_MS);
});

test("a chat response is read only for the request it answers", () => {
  const request = { requestId: "req-1", lessonId: story.id, questionId: story.questions[0].id, artifactId: "quiz-1", contentVersion: "a".repeat(64) };
  const response: LessonChatResponse = { ...request, reply: "설명입니다.", mode: "ai" };
  assert.deepEqual(readLessonChatResponse(response, request), response);
  for (const other of [{ requestId: "req-2" }, { lessonId: reading.stories[1].id }, { questionId: story.questions[1].id }, { artifactId: "quiz-2" }, { contentVersion: "b".repeat(64) }]) {
    assert.equal(readLessonChatResponse(response, { ...request, ...other }), null, JSON.stringify(other));
  }
  assert.equal(readLessonChatResponse({ ...response, extra: 1 }, request), null);
  assert.equal(readLessonChatResponse(null, request), null);
});

test("the story's explain request is a question about the first choice, the judgement and the passage, and fits the chat request contract", async () => {
  assert.notEqual(storyExplainRequestMessage, explainRequestMessage);
  for (const word of ["장면", "이유", "빈칸"]) assert.ok(!storyExplainRequestMessage.includes(word), word);
  for (const phrase of ["처음 고른 보기", "서버 판정", "정본 해설", "다른 보기", "본문의 어느 부분"]) assert.ok(storyExplainRequestMessage.includes(phrase), phrase);
  assert.ok(!/정답입니다|맞습니다/.test(storyExplainRequestMessage));
  const request: LessonChatRequest = {
    lessonId: story.id, questionId: story.questions[0].id, contentVersion: await getLessonContentVersion(story.id), artifactId: "quiz-1", requestId: "req-1",
    initialAttempt: { kind: "choose", choice: 1 }, revisions: [], messages: [], message: storyExplainRequestMessage,
  };
  assert.ok(isLessonChatRequest(request));
});
