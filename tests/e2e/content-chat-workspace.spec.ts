import { test, expect, type Page, type Locator } from "@playwright/test";
import type { ArtifactLearningChatRequest } from "../../lib/learning-chat-contract";
import { openFirstAnswerInput, openQuestionInput, chooseQuiz, expectQuizTarget } from "./workspace-input";

const learningKey = "english-sense-learning-workspace-v3";
const documentKey = "english-sense-document-ui-v1";
const layoutKey = "english-sense-workspace-layout-v1";
const longReply = Array.from({ length: 70 }, (_, index) => `검사용 긴 응답 ${String(index + 1).padStart(2, "0")}: 장면과 내 답의 표현을 천천히 비교합니다.`).join("\n");
const excerpt = longReply.split("\n").slice(-3).join("\n");
const content = (page: Page) => page.locator(".lw-content-scroll");
const chat = (page: Page) => page.locator(".lw-transcript");
const input = (page: Page) => page.getByLabel("이 장면에 대해 질문하기");
const response = (body: ArtifactLearningChatRequest, reply: string) => ({ requestId: body.requestId, artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply, mode: "ai" });

async function firstAnswer(page: Page) {
  await openFirstAnswerInput(page, 1);
  const form = page.getByRole("form", { name: "1번 퀴즈 첫 답", exact: true });
  await form.locator('input[type="radio"]').nth(1).check();
  await form.getByLabel("그 문장을 고른 까닭").fill("분리 화면 검사 입력: 보이는 장면을 떠올립니다.");
  await form.getByRole("button", { name: "내 답 제출하고 대화하기" }).click();
}
async function addGet(page: Page) {
  await page.getByRole("link", { name: "감각 자료 찾기", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "get 감각 자료 추가", exact: true }).click();
  await expect(page.locator('.lw-document-reference[data-reference-id="get"]')).toHaveCount(1);
}
async function openOutline(page: Page) {
  const open = page.getByRole("button", { name: "목차 펼치기", exact: true });
  if (await open.isVisible()) await open.click();
}
async function jump(page: Page, outlineId: string) {
  await openOutline(page);
  await page.getByRole("navigation", { name: "학습 문서 목차", exact: true }).locator(`a[href="#doc-${outlineId}"]`).click();
  await expect(page.locator(`#doc-${outlineId}`)).toBeFocused();
}
/** Where a document section sits in the viewport: the reader's place does not move when a reply lands in a quiz above it. */
async function sectionTop(page: Page, selector: string) { return page.locator(selector).evaluate(element => element.getBoundingClientRect().top); }
/** The conversation keeps one line per request and reply, so it is longer than its pane only after several short exchanges. */
async function fillChatUntilScrollable(page: Page) {
  const scrollable = () => chat(page).evaluate(element => element.scrollHeight > element.clientHeight + 120);
  for (let sent = 0; sent < 8 && !(await scrollable()); sent++) {
    const before = await page.locator(".lw-assistant-message").count();
    await input(page).fill(`검사용 채움 질문 ${sent + 1}`);
    await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
    await expect(page.locator(".lw-assistant-message")).toHaveCount(before + 1);
  }
  expect(await scrollable()).toBe(true);
}
async function scrollTop(locator: Locator) { return locator.evaluate(element => element.scrollTop); }
async function unobscured(locator: Locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && !!hit && element.contains(hit);
  });
}

// These are mocked browser interactions, not evidence of learner performance or learning effects.
test("wide content and chat remain readable together while long replies, retries and target changes preserve the content draft", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests: ArtifactLearningChatRequest[] = [];
  let release: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    if (requests.length === 2) return route.fulfill({ status: 503, json: { detail: "검사용 분리 화면 일시 실패" } });
    if (requests.length === 3) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: response(body, longReply) });
  });
  await page.goto("/practice/have/");
  await firstAnswer(page);
  await expect(page.locator(".lw-assistant-message > p")).toHaveText(longReply);
  await page.locator('.lw-quiz-artifact[data-question-id="titanic-have-2"]').getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).click();
  const form = page.getByRole("form", { name: "2번 퀴즈 첫 답", exact: true });
  const draft = form.getByLabel("그 문장을 고른 까닭");
  await draft.fill("AI 응답이 길어져도 유지할 2번 답 초안");
  const firstId = requests[0].artifactId;
  const secondId = await page.locator('.lw-quiz-artifact[data-question-id="titanic-have-2"]').getAttribute("data-artifact-id");
  await chooseQuiz(page, firstId);
  await jump(page, `artifact-${secondId}`);
  const secondTop = `#doc-artifact-${secondId}`;
  const originalContentTop = await sectionTop(page, secondTop);
  await input(page).fill("검사용 실패 뒤 재시도하는 1번 질문");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect(page.getByText("검사용 분리 화면 일시 실패", { exact: true })).toBeVisible();
  expect(Math.abs((await sectionTop(page, secondTop)) - originalContentTop)).toBeLessThanOrEqual(1);
  await expect.poll(async () => page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)!).artifacts.find((artifact: { artifactId: string }) => artifact.artifactId === id).reason, { key: learningKey, id: secondId })).toBe("AI 응답이 길어져도 유지할 2번 답 초안");
  await page.getByRole("button", { name: "같은 질문 다시 보내기", exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await chooseQuiz(page, secondId!);
  await jump(page, `artifact-${secondId}`);
  const heldTop = await sectionTop(page, secondTop);
  await openQuestionInput(page);
  await input(page).fill("재시도 응답 대기 중인 2번 질문 초안");
  release!();
  // The reply is long and lands in the first quiz, above the reader: the second quiz stays where it was.
  await expect(page.locator(".lw-assistant-message > p")).toHaveCount(2);
  await expect(page.locator(".lw-assistant-message > p").last()).toHaveText(longReply);
  await expect.poll(async () => chat(page).evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  expect(Math.abs((await sectionTop(page, secondTop)) - heldTop)).toBeLessThanOrEqual(1);
  await expect.poll(async () => page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)!).artifacts.find((artifact: { artifactId: string }) => artifact.artifactId === id).reason, { key: learningKey, id: secondId })).toBe("AI 응답이 길어져도 유지할 2번 답 초안");
  await expect(input(page)).toHaveValue("재시도 응답 대기 중인 2번 질문 초안");
  expect(requests[2].artifactId).toBe(firstId);
  await expect(page.locator(`.lw-timeline-event[data-event-kind="reply"][data-artifact-id="${firstId}"]`)).toHaveCount(2);
  await expect(page.locator(".lw-content-scroll .lw-quiz-artifact")).toHaveCount(7);
  await expect(page.locator(".lw-transcript .lw-quiz-artifact")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "AI 대화", exact: true }).getByRole("form", { name: "2번 퀴즈 첫 답", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "학습 콘텐츠", exact: true }).getByRole("form", { name: "2번 퀴즈 첫 답", exact: true })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "AI 대화", exact: true }).getByLabel("이 장면에 대해 질문하기")).toHaveCount(1);

  const secondCard = page.locator('.lw-quiz-artifact[data-question-id="titanic-have-2"]');
  await expect(secondCard.locator("h2")).toBeInViewport({ ratio: 1 });
  await expect(secondCard.locator(".lw-scene-text")).toBeInViewport({ ratio: 1 });
  // The long reply is in the document next to the conversation; the conversation shows one line of it and keeps its composer in view.
  const readable = await page.locator(".lw-assistant-message > p").last().evaluate((element, sample) => {
    const node = element.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) throw new Error("검사용 AI 본문 텍스트를 찾지 못했습니다.");
    const start = node.textContent!.indexOf(sample);
    if (start < 0) throw new Error("동시에 읽을 AI 문단을 찾지 못했습니다.");
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + sample.length);
    const text = range.getBoundingClientRect(), log = document.querySelector(".lw-transcript")!.getBoundingClientRect();
    const documentPane = document.querySelector(".lw-content-scroll")!.getBoundingClientRect();
    const line = [...document.querySelectorAll(".lw-transcript .lw-event-line")].at(-1)!.getBoundingClientRect();
    const composer = document.querySelector(".lw-composer")!.getBoundingClientRect();
    return { textLeft: text.left, textRight: text.right, documentLeft: documentPane.left, contentRight: documentPane.right, chatLeft: log.left, chatRight: log.right, lineLeft: line.left, lineRight: line.right, composerLeft: composer.left, composerRight: composer.right, composerBottom: composer.bottom, viewport: innerHeight };
  }, excerpt);
  expect(readable.contentRight).toBeLessThanOrEqual(readable.chatLeft);
  expect(readable.textLeft).toBeGreaterThanOrEqual(readable.documentLeft);
  expect(readable.textRight).toBeLessThanOrEqual(readable.contentRight);
  expect(readable.lineLeft).toBeGreaterThanOrEqual(readable.chatLeft);
  expect(readable.lineRight).toBeLessThanOrEqual(readable.chatRight);
  expect(readable.composerLeft).toBeGreaterThanOrEqual(readable.chatLeft);
  expect(readable.composerRight).toBeLessThanOrEqual(readable.chatRight);
  expect(readable.composerBottom).toBeLessThanOrEqual(readable.viewport);
  // The conversation scrolls by itself: it needs to be longer than its pane, so a few short exchanges are added in a short window.
  await page.setViewportSize({ width: 1440, height: 640 });
  await fillChatUntilScrollable(page);
  await input(page).fill("재시도 응답 대기 중인 2번 질문 초안");
  await chat(page).evaluate(element => { element.scrollTop = 100; element.dispatchEvent(new Event("scroll")); });
  const originalChatTop = await scrollTop(chat(page));
  expect(originalChatTop).toBeGreaterThan(0);
  await page.evaluate(() => scrollTo(0, 0));
  expect(await scrollTop(chat(page))).toBe(originalChatTop);
  await expect(input(page)).toHaveValue("재시도 응답 대기 중인 2번 질문 초안");
  await openFirstAnswerInput(page, 2);
  await expect(form).toHaveCount(1);
  await expect(draft).toHaveValue("AI 응답이 길어져도 유지할 2번 답 초안");
});

test("outline collapse and independent reading positions restore without changing learning or resending requests", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => {
    calls++;
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    await route.fulfill({ json: response(body, calls === 1 ? longReply : "검사용 짧은 응답") });
  });
  await page.goto("/practice/have/");
  await firstAnswer(page);
  await expect(page.locator(".lw-assistant-message > p")).toHaveText(longReply);
  await addGet(page);
  await fillChatUntilScrollable(page);
  const sentCalls = calls;
  await openOutline(page);
  const expandedWidth = await content(page).evaluate(element => element.clientWidth);
  await input(page).fill("Escape로 초점을 빼앗기지 않는 검사용 초안");
  await input(page).focus();
  await input(page).press("Escape");
  await expect(input(page)).toBeFocused();
  await expect(page.getByRole("navigation", { name: "학습 문서 목차", exact: true })).toBeVisible();
  await expect(input(page)).toHaveValue("Escape로 초점을 빼앗기지 않는 검사용 초안");
  const collapse = page.getByRole("button", { name: "목차 접기", exact: true });
  await collapse.focus(); await collapse.press("Enter");
  const expand = page.getByRole("button", { name: "목차 펼치기", exact: true });
  await expect(expand).toBeFocused();
  expect(await unobscured(expand)).toBe(true);
  expect(await content(page).evaluate(element => element.clientWidth)).toBeGreaterThan(expandedWidth);
  await expand.press("Enter");
  const getLink = page.getByRole("navigation", { name: "학습 문서 목차", exact: true }).locator('a[href="#doc-reference-get"]');
  await getLink.focus(); await getLink.press("Escape");
  await expect(expand).toBeFocused();
  expect(await unobscured(expand)).toBe(true);
  await jump(page, "reference-get");
  await page.getByRole("button", { name: "목차 접기", exact: true }).click();
  await input(page).fill("두 읽기 위치와 함께 복원할 질문 초안");
  await chat(page).evaluate(element => { element.scrollTop = 150; element.dispatchEvent(new Event("scroll")); });
  const originalChatTop = await scrollTop(chat(page));
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).chatScrollTop, layoutKey)).toBe(originalChatTop);
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).readingAnchor, documentKey)).toBe("reference-get");
  const learningRaw = await page.evaluate(key => localStorage.getItem(key), learningKey);
  await page.reload();
  await expect(input(page)).toHaveValue("두 읽기 위치와 함께 복원할 질문 초안");
  await expect(page.getByRole("button", { name: "목차 펼치기", exact: true })).toBeVisible();
  await expect(page.locator('#doc-reference-get h2')).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => scrollTop(chat(page))).toBe(originalChatTop);
  expect(await page.evaluate(key => localStorage.getItem(key), learningKey)).toBe(learningRaw);
  expect(calls).toBe(sentCalls);
  await chat(page).evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll")); });
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).chatAtEnd, layoutKey)).toBe(true);
  await page.reload();
  await expect.poll(async () => chat(page).evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  await expect(page.locator('#doc-reference-get h2')).toBeInViewport({ ratio: 1 });
  await page.evaluate(key => localStorage.setItem(key, "{broken layout settings"), layoutKey);
  await page.reload();
  await expect(input(page)).toHaveValue("두 읽기 위치와 함께 복원할 질문 초안");
  await expect(page.locator('#doc-reference-get h2')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(key => localStorage.getItem(key), learningKey)).toBe(learningRaw);
  expect(calls).toBe(sentCalls);
});

test("the narrow document and chat flow supports submission and return navigation without moving content on a new reply", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 430 });
  let release: (() => void) | undefined;
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => {
    calls++;
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: response(body, longReply) });
  });
  await page.goto("/practice/have/");
  await addGet(page);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await firstAnswer(page);
  await expect.poll(() => !!release).toBe(true);
  await page.getByRole("button", { name: "대화로 이동", exact: true }).click();
  await input(page).fill("화면을 오가며 남기는 미전송 질문 초안");
  expect(await unobscured(input(page))).toBe(true);
  await page.getByRole("button", { name: "콘텐츠로 이동", exact: true }).click();
  await jump(page, "reference-get");
  const heading = page.locator('#doc-reference-get h2');
  await expect(heading).toBeInViewport({ ratio: 1 });
  const readingPosition = await sectionTop(page, "#doc-reference-get h2");
  release!();
  // The reply lands in the first quiz, above the reference being read: what the reader sees does not move.
  await expect(page.locator(".lw-assistant-message > p")).toHaveText(longReply);
  expect(Math.abs((await sectionTop(page, "#doc-reference-get h2")) - readingPosition)).toBeLessThanOrEqual(1);
  await expect(page.locator(".lw-assistant-message > p")).not.toBeInViewport();
  await page.getByRole("button", { name: "대화로 이동", exact: true }).click();
  await input(page).focus();
  await expect(input(page)).toHaveValue("화면을 오가며 남기는 미전송 질문 초안");
  expect(await unobscured(input(page))).toBe(true);
  await page.locator('.lw-event-line[data-summary-of="titanic-have-1"]').first().getByRole("button", { name: "문서에서 보기", exact: true }).click();
  const firstId = await page.locator('.lw-quiz-artifact[data-question-id="titanic-have-1"]').getAttribute("data-artifact-id");
  await expect(page.locator(`#doc-artifact-${firstId}`)).toBeFocused();
  await expect(page.locator('.lw-quiz-artifact[data-question-id="titanic-have-1"] > h2')).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".lw-quiz-artifact")).toHaveCount(7);
  await expect(input(page)).toHaveValue("화면을 오가며 남기는 미전송 질문 초안");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(calls).toBe(1);
});
