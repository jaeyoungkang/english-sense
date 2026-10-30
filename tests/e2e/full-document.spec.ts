import { test, expect, type Page } from "@playwright/test";
import type { ArtifactLearningChatRequest } from "../../lib/learning-chat-contract";
import type { WorkspaceState } from "../../lib/learning-workspace-state";
import { openQuestionInput, chooseQuiz, expectQuizTarget } from "./workspace-input";

const key = "english-sense-learning-workspace-v3";
const card = (page: Page, number: number) => page.locator(`.lw-quiz-artifact[data-question-id="titanic-have-${number}"]`);
const form = (page: Page, number: number) => page.getByRole("form", { name: `${number}번 퀴즈 첫 답`, exact: true });
async function stored(page: Page): Promise<WorkspaceState> {
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), key)).not.toBeNull();
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
}
async function openOutline(page: Page) {
  const toggle = page.getByRole("button", { name: "목차 펼치기", exact: true });
  if (await toggle.isVisible()) await toggle.click();
}
async function readCard(page: Page, number: number) {
  const id = await card(page, number).getAttribute("data-artifact-id");
  await openOutline(page);
  await page.getByRole("navigation", { name: "학습 문서 목차", exact: true }).locator(`a[href="#doc-artifact-${id}"]`).click();
  await expect(card(page, number).locator("h2")).toBeInViewport({ ratio: 1 });
  const action = card(page, number).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true });
  await expect(action).toBeInViewport({ ratio: 1 });
  await expect.poll(() => action.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && !!hit && element.contains(hit);
  })).toBe(true);
}

// All inputs and provider replies are test fixtures, not learner records.
test("all explanations and seven questions are readable before any answer without creating learning events", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => { calls++; await route.abort(); });
  const navigation = await page.goto("/practice/have/");
  expect(navigation?.ok()).toBe(true);
  // Count actual server-rendered sections, excluding serialized catalog/RSC data.
  const initialHtml = await navigation!.text();
  const serverSections = initialHtml.match(/<section\b[^>]*\bclass="[^"]*\blw-quiz-artifact\b[^"]*"[^>]*>/g) || [];
  expect(serverSections).toHaveLength(7);
  expect(serverSections.map(section => section.match(/data-question-id="([^"]+)"/)?.[1])).toEqual(Array.from({ length: 7 }, (_, index) => `titanic-have-${index + 1}`));
  const initial = await stored(page);
  await expect(page.locator(".lw-content-pane .lw-quiz-artifact")).toHaveCount(7);
  await expect(page.getByRole("button", { name: "다음 퀴즈 추가", exact: true })).toHaveCount(0);
  // Each of the seven quizzes can be picked as the input target and holds its own first-answer form; the conversation has only the question box.
  await expect(page.locator(".lw-content-pane .lw-artifact-header button")).toHaveCount(7);
  await expect(page.locator(".lw-content-pane form[aria-label$=\"번 퀴즈 첫 답\"]")).toHaveCount(7);
  await expect(page.getByRole("region", { name: "AI 대화", exact: true }).locator("form")).toHaveCount(1);
  await expect(page.getByLabel("함께 풀 문제", { exact: true })).toHaveCount(0);
  const reference = page.locator('.lw-document-reference[data-reference-id="have"]');
  expect(await reference.locator(".lw-material-example").count()).toBeGreaterThan(1);
  expect(await reference.locator(".lw-material-example").evaluateAll(nodes => nodes.every(node => !node.closest("details:not([open])") && getComputedStyle(node).display !== "none"))).toBe(true);
  for (let number = 1; number <= 7; number++) {
    await expect(card(page, number).locator(".lw-scene-text")).toBeVisible();
    await expect(card(page, number).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true })).toBeEnabled();
  }
  await openOutline(page);
  const links = page.getByRole("navigation", { name: "학습 문서 목차", exact: true }).getByRole("link");
  await expect(links).toHaveCount(8);
  const hrefs = await links.evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
  expect(await page.locator(".lw-document-flow [data-outline-id]").evaluateAll(nodes => nodes.map(node => `#${node.id}`))).toEqual(hrefs);
  for (const size of [page.viewportSize()!, { width: 320, height: 430 }]) {
    await page.setViewportSize(size);
    await readCard(page, 7);
    await readCard(page, 2);
    await readCard(page, 5);
  }
  expect(await stored(page)).toEqual(initial);
  expect(initial.artifacts).toHaveLength(1);
  expect(initial.events.map(event => event.kind)).toEqual(["card"]);
  expect(calls).toBe(0);
  await page.reload();
  await expect(page.locator(".lw-quiz-artifact")).toHaveCount(7);
  expect(await stored(page)).toEqual(initial);
  expect(calls).toBe(0);
});

test("the seventh question can be answered first and the second can remain a draft across reading and reload", async ({ page }) => {
  const requests: ArtifactLearningChatRequest[] = [];
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    await route.fulfill({ json: { requestId: body.requestId, artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply: "검사용 7번 먼저 풀기 피드백", mode: "ai" } });
  });
  await page.goto("/practice/have/");
  await card(page, 7).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).click();
  await expect(form(page, 7)).toBeVisible();
  await expect(page.getByRole("region", { name: "AI 대화", exact: true }).locator("form")).toHaveCount(1);
  await form(page, 7).getByLabel("내가 쓴 영어 문장").fill("Browser test: I have a quiet moment.");
  await form(page, 7).getByRole("button", { name: "내 답 제출하고 대화하기", exact: true }).click();
  await expect(page.getByText("검사용 7번 먼저 풀기 피드백", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ questionId: "titanic-have-7", initialAttempt: { kind: "produce", text: "Browser test: I have a quiet moment." }, messages: [] });
  const secondId = await card(page, 2).getAttribute("data-artifact-id");
  await chooseQuiz(page, secondId!);
  await form(page, 2).locator('input[type="radio"]').nth(2).check();
  await form(page, 2).getByLabel("그 문장을 고른 까닭").fill("검사용 2번 미제출 초안");
  await openQuestionInput(page);
  await page.getByLabel("이 장면에 대해 질문하기").fill("검사용 2번 미전송 질문");
  const before = await stored(page);
  expect(before.artifacts.map(artifact => artifact.question.questionId)).toEqual(["titanic-have-1", "titanic-have-7", "titanic-have-2"]);
  expect(before.events.map(event => event.kind)).toEqual(["card", "card", "initial", "request", "reply", "card"]);
  await readCard(page, 4);
  await expectQuizTarget(page, secondId!);
  expect(await stored(page)).toEqual(before);
  await page.reload();
  await expect(form(page, 2).getByLabel("그 문장을 고른 까닭")).toHaveValue("검사용 2번 미제출 초안");
  await expect(form(page, 2).locator('input[type="radio"]').nth(2)).toBeChecked();
  await openQuestionInput(page);
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("검사용 2번 미전송 질문");
  expect(await stored(page)).toEqual(before);
  await expect(page.locator(".lw-quiz-artifact")).toHaveCount(7);
  expect(requests).toHaveLength(1);
});

test("the wide document scrolls as a web page while chat stays alongside and a reply preserves the reading position", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let release: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { requestId: body.requestId, artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply: "검사용 문서 읽기 중 준비 안내", mode: "guidance" } });
  });
  await page.goto("/practice/have/");
  await stored(page);
  const documentBox = await page.locator(".lw-content-scroll").boundingBox();
  expect(documentBox!.height).toBeGreaterThan(900);
  await page.mouse.move(documentBox!.x + documentBox!.width / 2, Math.min(documentBox!.y + 100, 800));
  await page.mouse.wheel(0, 1300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500);
  expect(await page.locator(".lw-content-scroll").evaluate(element => element.scrollTop)).toBe(0);
  const chat = page.getByRole("region", { name: "AI 대화", exact: true });
  let chatBounds = await chat.boundingBox();
  expect(chatBounds!.y).toBeGreaterThanOrEqual(0);
  expect(chatBounds!.y + chatBounds!.height).toBeLessThanOrEqual(901);
  await readCard(page, 5);
  chatBounds = await chat.boundingBox();
  expect(chatBounds!.y).toBeGreaterThanOrEqual(0);
  expect(chatBounds!.y + chatBounds!.height).toBeLessThanOrEqual(901);
  await openQuestionInput(page);
  await page.getByLabel("이 장면에 대해 질문하기").fill("검사용 문서를 읽으며 준비 질문");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await readCard(page, 7);
  const position = await card(page, 7).locator("h2").evaluate(element => element.getBoundingClientRect().top);
  release!();
  // The reply lands in the first quiz, above the seventh the reader is on: what the reader sees does not move.
  await expect(page.getByText("검사용 문서 읽기 중 준비 안내", { exact: true })).toHaveCount(1);
  expect(Math.abs((await card(page, 7).locator("h2").evaluate(element => element.getBoundingClientRect().top)) - position)).toBeLessThanOrEqual(1);
  await expect(card(page, 7).locator("h2")).toBeInViewport({ ratio: 1 });
  expect((await stored(page)).artifacts).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
