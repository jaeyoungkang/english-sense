import { test, expect, type Page } from "@playwright/test";
import type { ArtifactLearningChatRequest } from "../../lib/learning-chat-contract";
import { openFirstAnswerInput, openQuestionInput } from "./workspace-input";

const storageKey = "english-sense-learning-workspace-v3";
const firstReason = "브라우저 검사 입력: 아이 전체가 떠오릅니다.";
const revisionText = "브라우저 검사 수정: 다른 결을 비교합니다.";
const questionId = (number: number) => `titanic-have-${number}`;
const card = (page: Page, number: number) => page.locator(`.lw-quiz-artifact[data-question-id="${questionId(number)}"]`);
const firstForm = (page: Page, number: number) => page.getByRole("form", { name: `${number}번 퀴즈 첫 답`, exact: true });
const reply = (body: ArtifactLearningChatRequest, text: string) => ({ requestId: body.requestId, artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply: text, mode: "ai" });

async function submitFirstAnswer(page: Page, number = 1) {
  await openFirstAnswerInput(page, number);
  const form = firstForm(page, number);
  await form.locator('input[type="radio"]').nth(1).check();
  await form.getByLabel("그 문장을 고른 까닭").fill(firstReason);
  await form.getByRole("button", { name: "내 답 제출하고 대화하기" }).click();
}
async function submitWriting(page: Page, number: number, text: string) {
  await openFirstAnswerInput(page, number);
  const form = firstForm(page, number);
  await form.getByLabel("내가 쓴 영어 문장").fill(text);
  await form.getByRole("button", { name: "내 답 제출하고 대화하기" }).click();
}
async function addNext(page: Page, number: number) {
  await card(page, number).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).click();
  await expect(card(page, number)).toHaveCount(1);
}
async function target(page: Page, number: number) {
  await card(page, number).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).click();
  await expect(card(page, number).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true })).toHaveAttribute("aria-pressed", "true");
}
async function ask(page: Page, text: string) {
  await openQuestionInput(page);
  await page.getByLabel("이 장면에 대해 질문하기").fill(text);
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
}
async function revise(page: Page, number = 1) {
  await card(page, number).getByRole("button", { name: "답을 고쳐 쓰기", exact: true }).click();
  const form = page.getByRole("form", { name: `${number}번 퀴즈 수정`, exact: true });
  await form.getByLabel("내가 고친 답").fill(revisionText);
  await form.getByRole("button", { name: "수정한 답 남기기", exact: true }).click();
}
async function events(page: Page) {
  return page.locator(".lw-timeline > .lw-timeline-event").evaluateAll(nodes => nodes.map(node => ({ kind: node.getAttribute("data-event-kind"), artifactId: node.getAttribute("data-artifact-id") })));
}
async function seed(page: Page, key: string, raw: string) {
  await page.addInitScript(({ key, raw }) => {
    if (!sessionStorage.getItem("workspace-fixture-seeded")) {
      localStorage.setItem(key, raw);
      sessionStorage.setItem("workspace-fixture-seeded", "yes");
    }
  }, { key, raw });
}

// All provider responses below are mocks. These inputs are not learner records.
test("seven quiz artifacts retain targets, first answers, drafts, event order and writing across reload", async ({ page }) => {
  const requests: ArtifactLearningChatRequest[] = [];
  let releaseReply: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    const number = requests.length;
    if (body.message === "검사용 1번 지연 질문") await new Promise<void>(resolve => { releaseReply = resolve; });
    await route.fulfill({ json: reply(body, `검사용 모의 응답 ${number}`) });
  });
  await page.goto("/practice/have/");
  await expect(page.locator(".lw-reference").getByAltText(/사람을 둘러싼 연두색 타원/)).toBeVisible();
  await expect(page.locator(".lw-reference .lw-sense-image img")).toHaveAttribute("src", "/assets/learning/have-sense.webp");
  await expect(page.getByRole("log", { name: "학습 수행과 대화" })).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await submitFirstAnswer(page);
  await expect(page.getByText("검사용 모의 응답 1", { exact: true })).toBeVisible();
  const firstId = await card(page, 1).getAttribute("data-artifact-id");
  expect(requests[0]).toMatchObject({ lessonId: "titanic-have", questionId: questionId(1), artifactId: firstId, initialAttempt: { kind: "choose", choice: 1, reason: firstReason }, messages: [] });
  expect(requests[0].contentVersion).toMatch(/^[a-f0-9]{64}$/);
  await addNext(page, 2);
  const secondId = await card(page, 2).getAttribute("data-artifact-id");
  await target(page, 1);
  await openQuestionInput(page);
  await page.getByLabel("이 장면에 대해 질문하기").fill("아직 보내지 않은 1번 초안");
  await target(page, 2);
  await openQuestionInput(page);
  await page.getByLabel("이 장면에 대해 질문하기").fill("아직 보내지 않은 2번 초안");
  await target(page, 1);
  await openQuestionInput(page);
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("아직 보내지 않은 1번 초안");
  await ask(page, "검사용 1번 지연 질문");
  await expect.poll(() => !!releaseReply).toBe(true);
  await revise(page, 1);
  await target(page, 2);
  await openQuestionInput(page);
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("아직 보내지 않은 2번 초안");
  releaseReply!();
  const delayed = page.locator(`.lw-timeline-event[data-event-kind="reply"][data-artifact-id="${firstId}"]`).filter({ hasText: "검사용 모의 응답 2" });
  await expect(delayed).toHaveCount(1);
  await expect(page.locator(`.lw-timeline-event[data-artifact-id="${secondId}"]`).filter({ hasText: "검사용 모의 응답 2" })).toHaveCount(0);
  expect(requests[1].initialAttempt).toEqual(requests[0].initialAttempt);
  expect(requests[1].artifactId).toBe(firstId);
  expect(requests[1].messages).toContainEqual({ role: "assistant", content: "검사용 모의 응답 1" });
  expect(JSON.stringify(requests[1])).not.toContain("아직 보내지 않은 2번 초안");
  const mixed = await events(page);
  expect(mixed.map(event => event.kind)).toEqual(["card", "initial", "request", "reply", "card", "request", "revision", "reply"]);
  expect(mixed.slice(5).every(event => event.artifactId === firstId)).toBe(true);
  await target(page, 1);
  await ask(page, "검사용 1번 수정 후 질문");
  await expect(page.getByText("검사용 모의 응답 3", { exact: true })).toBeVisible();
  expect(requests[2].revisions).toEqual([{ text: revisionText }]);
  expect(requests[2].initialAttempt).toEqual(requests[0].initialAttempt);
  await target(page, 2);
  for (let number = 2; number <= 5; number++) {
    await submitFirstAnswer(page, number);
    await expect(page.getByText(`검사용 모의 응답 ${number + 2}`, { exact: true })).toBeVisible();
    await addNext(page, number + 1);
  }
  await submitWriting(page, 6, "Browser test: I have a small light.");
  await expect(page.getByText("검사용 모의 응답 8", { exact: true })).toBeVisible();
  expect(requests[7]).toMatchObject({ questionId: questionId(6), initialAttempt: { kind: "produce", text: "Browser test: I have a small light." }, messages: [], revisions: [] });
  await addNext(page, 7);
  await submitWriting(page, 7, "Browser test: She has a quiet moment.");
  await expect(page.getByText("검사용 모의 응답 9", { exact: true })).toBeVisible();
  expect(requests[8]).toMatchObject({ questionId: questionId(7), initialAttempt: { kind: "produce", text: "Browser test: She has a quiet moment." }, messages: [] });
  await openQuestionInput(page);
  await page.getByLabel("이 장면에 대해 질문하기").fill("아직 보내지 않은 7번 초안");
  const beforeReload = await events(page);
  await page.reload();
  await openQuestionInput(page);
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("아직 보내지 않은 7번 초안");
  await expect(page.locator(".lw-quiz-artifact")).toHaveCount(7);
  expect(await events(page)).toEqual(beforeReload);
  expect(requests).toHaveLength(9);
  await target(page, 2);
  await openQuestionInput(page);
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("아직 보내지 않은 2번 초안");
  await target(page, 1);
  // The conversation keeps one line of the first answer; the answer and its reason are in the quiz.
  await expect(page.locator(`.lw-timeline-event[data-event-kind="initial"][data-artifact-id="${firstId}"]`)).toContainText("첫 답을 남겼습니다");
  await expect(page.locator(`.lw-timeline-event[data-event-kind="initial"][data-artifact-id="${firstId}"]`)).not.toContainText(firstReason);
  await expect(card(page, 1).locator(".lw-doc-performance")).toContainText(firstReason);
  await page.getByRole("button", { name: "내 수행 기록", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(firstReason);
  await expect(page.getByRole("dialog")).toContainText(revisionText);
  await page.getByRole("button", { name: "닫고 학습으로 돌아가기" }).click();
  await target(page, 7);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "이 퀴즈 새 대화", exact: true }).click();
  await ask(page, "검사용 새 대화의 7번 질문");
  await expect(page.getByText("검사용 모의 응답 10", { exact: true })).toBeVisible();
  expect(requests[9]).toMatchObject({ questionId: questionId(7), initialAttempt: requests[8].initialAttempt, messages: [] });
  await page.reload();
  await expect(page.getByText("검사용 모의 응답 10", { exact: true })).toHaveCount(1);
  expect(requests).toHaveLength(10);
  await page.getByRole("button", { name: "내 수행 기록", exact: true }).click();
  await page.locator(".lw-archive summary").last().click();
  await expect(page.locator(".lw-archive").last()).toContainText("검사용 모의 응답 9");
  await expect(page.locator(".lw-archive").last()).toContainText("아직 보내지 않은 7번 초안");
});

test("retry and cancellation retain the original target and reject a cancelled late response", async ({ page }) => {
  let count = 0;
  let releaseLate: (() => void) | undefined;
  const requests: ArtifactLearningChatRequest[] = [];
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body); count++;
    if (count === 1) return route.fulfill({ status: 503, json: { detail: "검사용 일시 실패" } });
    if (body.message === "검사용 느린 2번 질문") {
      await new Promise<void>(resolve => { releaseLate = resolve; });
      await route.fulfill({ json: reply(body, "도착하면 안 되는 옛 응답") }).catch(() => {});
      return;
    }
    await route.fulfill({ json: reply(body, "검사용 현재 응답") });
  });
  await page.goto("/practice/have/");
  await submitFirstAnswer(page);
  await expect(page.getByText("검사용 일시 실패", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "같은 질문 다시 보내기" }).click();
  await expect(page.getByText("검사용 현재 응답", { exact: true })).toBeVisible();
  expect(requests[1].artifactId).toBe(requests[0].artifactId);
  expect(requests[1].requestId).not.toBe(requests[0].requestId);
  expect((await events(page)).map(event => event.kind)).toEqual(["card", "initial", "request", "retry", "reply"]);
  await addNext(page, 2);
  await ask(page, "검사용 느린 2번 질문");
  await expect.poll(() => !!releaseLate).toBe(true);
  await target(page, 1);
  await page.getByRole("button", { name: "2번 응답 중단", exact: true }).click();
  await ask(page, "검사용 새 1번 질문");
  await expect(page.getByText("검사용 현재 응답", { exact: true })).toHaveCount(2);
  releaseLate!();
  await expect(page.getByText("도착하면 안 되는 옛 응답", { exact: true })).toHaveCount(0);
  await expect(page.locator(".lw-cancelled")).toContainText("중단");
  expect(requests[2].questionId).toBe(questionId(2));
  expect(requests[3].questionId).toBe(questionId(1));
  expect(requests[3].messages).not.toContainEqual({ role: "user", content: "검사용 느린 2번 질문" });
});

test("image failure, blocked storage and IME input preserve the quiz and composer drafts", async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException("blocked", "QuotaExceededError"); }; });
  await page.route("**/assets/learning/have-sense.webp", route => route.abort());
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => { calls++; await route.abort(); });
  await page.goto("/practice/have/");
  await expect(page.locator(".lw-reference").getByText("이미지 대신 감각 도식을 표시합니다.", { exact: true })).toBeVisible();
  const fallback = page.locator(".lw-reference .lw-image-fallback").getByRole("img");
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAccessibleName(/have의 감각/);
  await firstForm(page, 1).getByLabel("그 문장을 고른 까닭").fill("저장 차단 검사용 초안");
  await expect(page.getByText("임시 저장 실패 · 화면에 유지 중", { exact: true })).toBeVisible();
  await expect(firstForm(page, 1).getByLabel("그 문장을 고른 까닭")).toHaveValue("저장 차단 검사용 초안");
  await openQuestionInput(page);
  const input = page.getByLabel("이 장면에 대해 질문하기");
  await input.fill("아직 조합 중인 검사용 질문");
  await input.evaluate(element => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true })));
  await input.press("Enter");
  expect(calls).toBe(0);
  await expect(input).toHaveValue("아직 조합 중인 검사용 질문\n");
  await openFirstAnswerInput(page, 1);
  await expect(firstForm(page, 1).getByLabel("그 문장을 고른 까닭")).toHaveValue("저장 차단 검사용 초안");
});

for (const version of [1, 2] as const) {
  test(`v${version} source stays intact during v3 migration and a pending request is never resent`, async ({ page }) => {
    const key = `english-sense-learning-workspace-v${version}`;
    const turns = [
      { id: "old-complete", requestId: "old-request", user: "검사용 이전 질문", origin: "question", status: "complete", reply: "검사용 이전 응답", mode: "ai" },
      { id: "old-pending", requestId: "old-pending-request", user: "검사용 복원 대기 질문", origin: "question", status: "pending" },
    ];
    const raw = JSON.stringify({
      version, lessonId: "titanic-have-1", choice: "1", reason: firstReason,
      initialAttempt: { choice: 1, reason: firstReason }, revisionDraft: "이전 수정 초안", revisions: [{ text: revisionText }], messageDraft: "이전 질문 초안", turns,
      archives: [{ id: "old-archive", draft: "이전 보관 초안", turns: [{ id: "archived-turn", requestId: "archived-request", user: "검사용 보관 질문", origin: "question", status: "complete", reply: "검사용 보관 응답", mode: "ai" }] }],
      ...(version === 1 ? { pane: "chat" } : { revisionOpen: true, events: [
        { id: "old-initial", kind: "initial" }, { id: "old-revision", kind: "revision", index: 0 },
        { id: "old-request-event", kind: "request", turnId: "old-complete", requestId: "old-request" },
        { id: "old-reply-event", kind: "reply", turnId: "old-complete", requestId: "old-request" },
        { id: "old-pending-event", kind: "request", turnId: "old-pending", requestId: "old-pending-request" },
      ] }),
    });
    await seed(page, key, raw);
    let calls = 0;
    await page.route("**/api/learn-chat/**", async route => {
      calls++;
      const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
      await route.fulfill({ json: reply(body, "검사용 이관 후 응답") });
    });
    await page.goto("/practice/have/");
    await openQuestionInput(page);
    await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("이전 질문 초안");
    await expect.poll(async () => page.evaluate(key => localStorage.getItem(key) !== null, storageKey)).toBe(true);
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
    expect(calls).toBe(0);
    if (version === 1) {
      await expect(page.locator(".lw-legacy-group")).toContainText("작성 순서가 없습니다");
      await page.getByText("이전 수행과 대화 읽기", { exact: true }).click();
    }
    await expect(page.locator(".lw-timeline")).toContainText(firstReason);
    await expect(page.locator(".lw-timeline")).toContainText(revisionText);
    await expect(page.locator(".lw-timeline")).toContainText("검사용 이전 응답");
    const prior = await events(page);
    await page.reload();
    await openQuestionInput(page);
    await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("이전 질문 초안");
    expect(await events(page)).toEqual(prior);
    expect(calls).toBe(0);
    await ask(page, "검사용 이관 후 질문");
    await expect(page.getByText("검사용 이관 후 응답", { exact: true })).toBeVisible();
    expect(calls).toBe(1);
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
    await page.getByRole("button", { name: "내 수행 기록", exact: true }).click();
    await page.locator(".lw-archive summary").click();
    await expect(page.locator(".lw-archive")).toContainText("검사용 보관 응답");
    await expect(page.locator(".lw-archive")).toContainText("이전 보관 초안");
  });
}

test("restoring a v3 pending response preserves its input without automatically sending it again", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => {
    calls++;
    if (calls === 1) {
      const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
      await route.fulfill({ json: reply(body, "검사용 첫 응답") });
    } else await route.abort();
  });
  await page.goto("/practice/have/");
  await submitFirstAnswer(page);
  await expect(page.getByText("검사용 첫 응답", { exact: true })).toBeVisible();
  // Save a valid in-flight state from the UI, then reload before any reply is accepted.
  let release: (() => void) | undefined;
  await page.unroute("**/api/learn-chat/**");
  await page.route("**/api/learn-chat/**", async route => {
    calls++;
    await new Promise<void>(resolve => { release = resolve; });
    await route.abort().catch(() => {});
  });
  await ask(page, "검사용 v3 복원 대기 질문");
  await expect.poll(() => !!release).toBe(true);
  await page.reload();
  await expect(page.locator(".lw-timeline")).toContainText("검사용 v3 복원 대기 질문");
  await expect(page.locator(".lw-cancelled")).toContainText("자동으로 다시 전송하지 않습니다");
  expect(calls).toBe(2);
  release!();
});

test("reading earlier chat stays put on a new reply and the narrow flow keeps materials and questions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let calls = 0;
  let releaseReply: (() => void) | undefined;
  const quick = 9;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    calls++;
    if (calls === quick + 2) await new Promise<void>(resolve => { releaseReply = resolve; });
    await route.fulfill({ json: reply(body, calls === 1 ? "검사용 긴 모의 응답\n".repeat(70) : calls === quick + 2 ? "검사용 읽기 중 새 응답" : `검사용 짧은 응답 ${calls}`) });
  });
  await page.goto("/practice/have/");
  await submitFirstAnswer(page);
  await expect(page.locator(".lw-assistant-message")).toHaveCount(1);
  // The conversation holds one line per request and reply, so it needs many of them to be longer than its pane.
  for (let index = 0; index < quick; index++) { await ask(page, `검사용 짧은 질문 ${index + 1}`); await expect(page.locator(".lw-assistant-message")).toHaveCount(index + 2); }
  await ask(page, "검사용 읽는 동안 기다리는 질문");
  await expect.poll(() => !!releaseReply).toBe(true);
  const transcript = page.locator(".lw-transcript");
  expect(await transcript.evaluate(element => element.scrollHeight > element.clientHeight + 100)).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await transcript.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  const pinned = await page.locator(".lw-reference").boundingBox();
  releaseReply!();
  await expect(page.getByRole("button", { name: "새 응답 보기" })).toBeVisible();
  expect(await transcript.evaluate(element => element.scrollTop)).toBeLessThan(5);
  expect((await page.locator(".lw-reference").boundingBox())?.y).toBe(pinned?.y);
  await page.getByRole("button", { name: "새 응답 보기" }).click();
  await expect(page.getByText("검사용 읽기 중 새 응답", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 430 });
  await page.getByRole("button", { name: "콘텐츠로 이동", exact: true }).click();
  const haveReference = page.locator(".lw-reference").getByRole("button", { name: /^have 감각 자료 (펼치기|접기)$/ });
  if (await haveReference.getAttribute("aria-expanded") === "true") await haveReference.click();
  await haveReference.click();
  await expect(haveReference).toHaveAttribute("aria-expanded", "true");
  await page.locator(".lw-reference .lw-sense-image img").scrollIntoViewIfNeeded();
  await expect(page.locator(".lw-reference .lw-sense-image img")).toBeInViewport();
  await haveReference.click();
  await page.getByRole("button", { name: "대화로 이동", exact: true }).click();
  await openQuestionInput(page);
  const input = page.getByLabel("이 장면에 대해 질문하기");
  await input.fill("좁은 화면에서 직접 이어 쓰는 검사 초안");
  await input.focus();
  const bounds = await input.evaluate(element => {
    const field = element.getBoundingClientRect();
    const hit = document.elementFromPoint(field.left + field.width / 2, field.top + field.height / 2);
    return { top: field.top, bottom: field.bottom, viewport: innerHeight, visible: !!hit && element.contains(hit), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport);
  expect(bounds.visible).toBe(true);
  expect(bounds.overflow).toBe(false);
});

test("an archive missing its required events is rejected without replacing the v2 source", async ({ page }) => {
  const key = "english-sense-learning-workspace-v2";
  const raw = JSON.stringify({
    version: 2, lessonId: "titanic-have-1", choice: "", reason: "", initialAttempt: null,
    revisionDraft: "", revisions: [], messageDraft: "", turns: [], events: [], revisionOpen: false,
    archives: [{ id: "broken-archive", draft: "보관한 검사 초안", events: [], turns: [
      { id: "missing-event", requestId: "old-request", user: "보관한 검사 질문", origin: "question", status: "complete", reply: "보관한 검사 응답", mode: "ai" },
    ] }],
  });
  await seed(page, key, raw);
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => { calls++; await route.abort(); });
  await page.goto("/practice/have/");
  await expect(page.getByText("임시 저장 실패 · 화면에 유지 중", { exact: true })).toBeVisible();
  await firstForm(page, 1).getByLabel("그 문장을 고른 까닭").fill("새 입력으로 원본을 덮어쓰지 않는 검사");
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  expect(calls).toBe(0);
});

test("a changed material version shows its original snapshot and prevents AI transmission", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => {
    calls++;
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    await route.fulfill({ json: reply(body, "검사용 자료 판 변경 전 응답") });
  });
  await page.goto("/practice/have/");
  await submitFirstAnswer(page);
  await expect(page.getByText("검사용 자료 판 변경 전 응답", { exact: true })).toBeVisible();
  await page.evaluate(key => {
    const previous = JSON.parse(localStorage.getItem(key)!);
    previous.artifacts[0].contentVersion = "0".repeat(64);
    previous.artifacts[0].question.ask = "검사용 이전 자료의 발문을 그대로 보존합니다.";
    localStorage.setItem(key, JSON.stringify(previous));
  }, storageKey);
  await page.reload();
  await expect(card(page, 1)).toContainText("검사용 이전 자료의 발문을 그대로 보존합니다.");
  await expect(card(page, 1).locator(".lw-doc-performance")).toContainText(firstReason);
  await expect(page.locator('.lw-timeline-event[data-event-kind="initial"]')).toContainText("첫 답을 남겼습니다");
  await expect(card(page, 1).getByRole("button", { name: "답을 고쳐 쓰기", exact: true })).toBeDisabled();
  await expect(page.locator(".lw-chat-notice")).toContainText("이 퀴즈의 자료 판이 현재 자료와 다릅니다. 당시 기록을 보존하고 AI 전송을 막았습니다.");
  await expect(page.getByRole("button", { name: "질문 보내기", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "다음 퀴즈 추가", exact: true })).toHaveCount(0);
  expect(calls).toBe(1);
});

test("a migrated legacy group keeps a retried reply only at its later reply event", async ({ page }) => {
  const key = "english-sense-learning-workspace-v2";
  const lateReply = "검사용 재시도 뒤 도착한 이전 응답";
  const raw = JSON.stringify({
    version: 2, lessonId: "titanic-have-1", choice: "1", reason: firstReason,
    initialAttempt: { choice: 1, reason: firstReason }, revisionDraft: "", revisions: [],
    messageDraft: "", revisionOpen: false, archives: [],
    turns: [{ id: "t", requestId: "retry", user: "검사용 이전 미응답 질문", origin: "question", status: "complete", reply: lateReply, mode: "ai" }],
    events: [
      { id: "original-legacy-group", kind: "legacy", hadInitial: true, revisionCount: 0, turnIds: ["t"], repliedTurnIds: [] },
      { id: "later-retry", kind: "retry", turnId: "t", requestId: "retry" },
      { id: "later-reply", kind: "reply", turnId: "t", requestId: "retry" },
    ],
  });
  await seed(page, key, raw);
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => { calls++; await route.abort(); });
  await page.goto("/practice/have/");
  await page.getByText("이전 수행과 대화 읽기", { exact: true }).click();
  const originalGroup = page.locator(".lw-legacy-nested");
  await expect(originalGroup).toContainText("검사용 이전 미응답 질문");
  await expect(originalGroup.getByText(lateReply, { exact: true })).toHaveCount(0);
  await expect(page.locator('.lw-legacy-group .lw-timeline-event[data-event-kind="reply"]')).toContainText(lateReply);
  await expect(page.locator(".lw-legacy-group").getByText(lateReply, { exact: true })).toHaveCount(1);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  expect(calls).toBe(0);
});
