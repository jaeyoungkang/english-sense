import { test, expect, type Page } from "@playwright/test";
import type { ArtifactLearningChatRequest } from "../../lib/learning-chat-contract";
import { openFirstAnswerInput, openQuestionInput, chooseQuiz, expectQuizTarget } from "./workspace-input";

const learningKey = "english-sense-learning-workspace-v3";
const uiKey = "english-sense-document-ui-v1";
const reference = (page: Page, id: string) => page.locator(`.lw-document-reference[data-reference-id="${id}"]`);
const stack = (page: Page) => page.locator(".lw-reference");
const outline = (page: Page) => page.getByRole("navigation", { name: "학습 문서 목차", exact: true });
const message = (page: Page) => page.getByLabel("이 장면에 대해 질문하기");
const response = (body: ArtifactLearningChatRequest, reply: string) => ({ requestId: body.requestId, artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply, mode: "ai" });

async function addReference(page: Page, id: string) {
  await page.getByRole("link", { name: "감각 자료 찾기", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: `${id} 감각 자료 추가`, exact: true }).click();
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "닫고 학습으로 돌아가기", exact: true }).click();
  await expect(reference(page, id)).toHaveCount(1);
}
async function openOutline(page: Page) {
  const open = page.getByRole("button", { name: "목차 펼치기", exact: true });
  if (await open.isVisible()) await open.click();
  await expect(outline(page)).toBeVisible();
}
async function closeOutline(page: Page) {
  const close = page.getByRole("button", { name: "목차 접기", exact: true });
  if (await close.isVisible()) await close.click();
}
async function outlineHrefs(page: Page) {
  await openOutline(page);
  const hrefs = await outline(page).getByRole("link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
  await closeOutline(page);
  return hrefs;
}
async function bodyOrder(page: Page) {
  return page.locator(".lw-document-flow [data-outline-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-outline-id")));
}
async function jumpTo(page: Page, id: string) {
  await openOutline(page);
  const link = outline(page).locator(`a[href="#doc-${id}"]`);
  await link.focus();
  await link.press("Enter");
  await expect(page.locator(`#doc-${id}`)).toBeFocused();
}
async function submitFirst(page: Page) {
  await openFirstAnswerInput(page, 1);
  const form = page.getByRole("form", { name: "1번 퀴즈 첫 답", exact: true });
  await form.locator('input[type="radio"]').nth(1).check();
  await form.getByLabel("그 문장을 고른 까닭").fill("문서 화면 검사 입력: 한 장면을 떠올립니다.");
  await form.getByRole("button", { name: "내 답 제출하고 대화하기" }).click();
}

// Provider responses are mocked; these inputs never become learner records.
test("the outline follows actual document additions while reopening references preserves document and event order", async ({ page }) => {
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    await route.fulfill({ json: response(body, "문서 화면 검사 모의 응답") });
  });
  await page.goto("/practice/have/");
  const firstId = await page.locator('.lw-quiz-artifact[data-question-id="titanic-have-1"]').getAttribute("data-artifact-id");
  const initial = ["reference-have", ...await page.locator(".lw-quiz-artifact").evaluateAll(nodes => nodes.map(node => `artifact-${node.getAttribute("data-artifact-id")}`))];
  expect(await bodyOrder(page)).toEqual(initial);
  expect(await outlineHrefs(page)).toEqual(initial.map(id => `#doc-${id}`));
  await submitFirst(page);
  await expect(page.getByText("문서 화면 검사 모의 응답", { exact: true })).toBeVisible();
  await addReference(page, "get");
  await page.locator('.lw-quiz-artifact[data-question-id="titanic-have-2"]').getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).click();
  const second = page.locator('.lw-quiz-artifact[data-question-id="titanic-have-2"]');
  await expect(second).toHaveCount(1);
  const secondId = await second.getAttribute("data-artifact-id");
  await addReference(page, "be");
  await addReference(page, "go");
  await addReference(page, "come");
  const expectedOrder = ["reference-have", `artifact-${firstId}`, "reference-get", `artifact-${secondId}`, "reference-be", "reference-go", "reference-come", ...initial.slice(3)];
  expect(await bodyOrder(page)).toEqual(expectedOrder);
  expect(await outlineHrefs(page)).toEqual(expectedOrder.map(id => `#doc-${id}`));
  expect(await stack(page).locator("[data-reference-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-reference-id")))).toEqual(["come", "go", "be", "get", "have"]);
  await expect(stack(page).getByRole("button", { name: "come 감각 자료 접기", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(stack(page).locator('[data-reference-id] button[aria-expanded="true"]')).toHaveCount(1);
  for (const [id, sense] of [["have", "내 영역 안에 놓여 있다"], ["get", "경계를 넘어 들어선다"], ["be", "이미 거기 놓여 있다"], ["go", "기준점에서 멀어진다"], ["come", "기준점으로 다가온다"]]) await expect(reference(page, id)).toContainText(sense);
  await expect.poll(async () => page.evaluate(key => localStorage.getItem(key), learningKey)).not.toBeNull();
  const learningBeforeReopen = await page.evaluate(key => localStorage.getItem(key), learningKey);
  await stack(page).getByRole("button", { name: "have 감각 자료 펼치기", exact: true }).click();
  await expect(stack(page).getByRole("button", { name: "have 감각 자료 접기", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(stack(page).locator('[data-reference-id] button[aria-expanded="true"]')).toHaveCount(1);
  expect(await bodyOrder(page)).toEqual(expectedOrder);
  expect(await outlineHrefs(page)).toEqual(expectedOrder.map(id => `#doc-${id}`));
  expect(await page.evaluate(key => localStorage.getItem(key), learningKey)).toBe(learningBeforeReopen);
  await page.reload();
  await expect(stack(page).getByRole("button", { name: "have 감각 자료 접기", exact: true })).toHaveAttribute("aria-expanded", "true");
  expect(await bodyOrder(page)).toEqual(expectedOrder);
  expect(await outlineHrefs(page)).toEqual(expectedOrder.map(id => `#doc-${id}`));
});

test("reading references and using the outline preserve quiz targets, drafts and the target of a delayed reply", async ({ page }) => {
  const requests: ArtifactLearningChatRequest[] = [];
  let release: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    if (body.message === "검사용 자료를 읽으며 묻는 1번 질문") await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: response(body, requests.length === 1 ? "검사용 문서의 첫 응답" : "검사용 자료 열람 중 지연 응답") });
  });
  await page.goto("/practice/have/");
  await submitFirst(page);
  await expect(page.getByText("검사용 문서의 첫 응답", { exact: true })).toBeVisible();
  const firstId = await page.locator('.lw-quiz-artifact[data-question-id="titanic-have-1"]').getAttribute("data-artifact-id");
  await addReference(page, "get");
  await openQuestionInput(page);
  await message(page).fill("아직 보내지 않은 1번 질문 초안");
  await page.locator('.lw-quiz-artifact[data-question-id="titanic-have-2"]').getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).click();
  const second = page.locator('.lw-quiz-artifact[data-question-id="titanic-have-2"]');
  const secondId = await second.getAttribute("data-artifact-id");
  await openQuestionInput(page);
  await message(page).fill("아직 보내지 않은 2번 질문 초안");
  await chooseQuiz(page, firstId!);
  await openQuestionInput(page);
  await expect(message(page)).toHaveValue("아직 보내지 않은 1번 질문 초안");
  await jumpTo(page, "reference-get");
  await expectQuizTarget(page, firstId!);
  await openQuestionInput(page);
  await expect(message(page)).toHaveValue("아직 보내지 않은 1번 질문 초안");
  await expect(page.locator(".lw-reading-context")).toContainText("펼친 감각 자료: get");
  await expect(page.locator(".lw-reading-context")).toContainText("입력 대상: have · 1번 퀴즈");
  await openQuestionInput(page);
  await message(page).fill("검사용 자료를 읽으며 묻는 1번 질문");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await openQuestionInput(page);
  await message(page).fill("응답 대기 중 새로 쓰는 1번 초안");
  await stack(page).getByRole("button", { name: "have 감각 자료 펼치기", exact: true }).click();
  await jumpTo(page, `artifact-${secondId}`);
  await expectQuizTarget(page, firstId!);
  await openQuestionInput(page);
  await expect(message(page)).toHaveValue("응답 대기 중 새로 쓰는 1번 초안");
  release!();
  const delayed = page.locator(`.lw-timeline-event[data-event-kind="reply"][data-artifact-id="${firstId}"]`).filter({ hasText: "검사용 자료 열람 중 지연 응답" });
  await expect(delayed).toHaveCount(1);
  await expect(page.locator(`.lw-timeline-event[data-artifact-id="${secondId}"]`).filter({ hasText: "검사용 자료 열람 중 지연 응답" })).toHaveCount(0);
  await openQuestionInput(page);
  await expect(message(page)).toHaveValue("응답 대기 중 새로 쓰는 1번 초안");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ artifactId: firstId, questionId: "titanic-have-1", initialAttempt: requests[0].initialAttempt });
  expect(JSON.stringify(requests[1])).not.toContain("아직 보내지 않은 2번 질문 초안");
  await second.getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).click();
  await expectQuizTarget(page, secondId!);
  await openQuestionInput(page);
  await expect(message(page)).toHaveValue("아직 보내지 않은 2번 질문 초안");
});

test("damaged document navigation resets independently while preserving the exact learning record", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => { calls++; await route.abort(); });
  await page.goto("/practice/have/");
  const reason = page.getByRole("form", { name: "1번 퀴즈 첫 답", exact: true }).getByLabel("그 문장을 고른 까닭");
  await reason.fill("UI 저장 손상에도 남아야 하는 검사용 답 초안");
  await openQuestionInput(page);
  await message(page).fill("UI 저장 손상에도 남아야 하는 검사용 질문 초안");
  await addReference(page, "get");
  await expect.poll(async () => page.evaluate(key => localStorage.getItem(key), learningKey)).toContain("UI 저장 손상에도 남아야 하는 검사용 질문 초안");
  const original = await page.evaluate(key => localStorage.getItem(key), learningKey);
  // The jump to the new reference ends with scroll events that rewrite the saved reading position; break the saved value only after they settle.
  await page.evaluate(() => new Promise<void>(resolve => { let last = scrollY, stable = 0; const tick = () => { if (scrollY === last) stable++; else { stable = 0; last = scrollY; } if (stable >= 8) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
  await page.evaluate(key => localStorage.setItem(key, "{broken document navigation"), uiKey);
  await page.reload();
  await openFirstAnswerInput(page, 1);
  await expect(reason).toHaveValue("UI 저장 손상에도 남아야 하는 검사용 답 초안");
  await openQuestionInput(page);
  await expect(message(page)).toHaveValue("UI 저장 손상에도 남아야 하는 검사용 질문 초안");
  await expect(reference(page, "have")).toHaveCount(1);
  await expect(reference(page, "get")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), learningKey)).toBe(original);
  expect(await bodyOrder(page)).toHaveLength(8);
  expect(calls).toBe(0);
});

test("mobile outline keyboard navigation returns focus and leaves the document and composer unobscured", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => { calls++; await route.abort(); });
  await page.goto("/practice/have/");
  await addReference(page, "get");
  await addReference(page, "be");
  await addReference(page, "go");
  await page.setViewportSize({ width: 320, height: 430 });
  // Resizing preserves the user's existing outline preference; begin this keyboard task closed.
  await closeOutline(page);
  const open = page.getByRole("button", { name: "목차 펼치기", exact: true });
  await open.focus();
  await open.press("Enter");
  await expect(outline(page)).toBeVisible();
  await outline(page).getByRole("link").last().focus();
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  const unobscuredCollapsedFocus = await open.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return bounds.top >= 0 && bounds.bottom <= innerHeight && !!hit && element.contains(hit);
  });
  expect(unobscuredCollapsedFocus).toBe(true);
  await open.press("Enter");
  await outline(page).getByRole("link").last().focus();
  await page.keyboard.press("Tab");
  const goToChat = page.getByRole("button", { name: "대화로 이동", exact: true });
  await expect(goToChat).toBeFocused();
  const unobscuredNavigationFocus = await goToChat.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return bounds.top >= 0 && bounds.bottom <= innerHeight && !!hit && element.contains(hit);
  });
  expect(unobscuredNavigationFocus).toBe(true);
  await closeOutline(page);
  await open.focus();
  await open.press("Enter");
  const getLink = outline(page).locator('a[href="#doc-reference-get"]');
  await getLink.focus();
  await getLink.press("Enter");
  const getSection = page.locator("#doc-reference-get");
  await expect(getSection).toBeFocused();
  await expect(open).toBeVisible();
  const visibleDocument = await getSection.evaluate(element => {
    const heading = element.querySelector("h2,h3") || element;
    const bounds = heading.getBoundingClientRect();
    const content = document.querySelector(".lw-content-scroll")!.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + Math.min(bounds.width / 2, 40), bounds.top + Math.min(bounds.height / 2, 8));
    return { top: bounds.top, bottom: bounds.bottom, visibleTop: Math.max(0, content.top), visibleBottom: Math.min(innerHeight, content.bottom), visible: !!hit && element.contains(hit) };
  });
  expect(visibleDocument.top).toBeGreaterThanOrEqual(visibleDocument.visibleTop - 1);
  expect(visibleDocument.bottom).toBeLessThanOrEqual(visibleDocument.visibleBottom + 1);
  expect(visibleDocument.visible).toBe(true);
  await expect(stack(page).locator('[data-reference-id] button[aria-expanded="true"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await goToChat.click();
  await openQuestionInput(page);
  await message(page).fill("목차 이동 뒤 보존하는 키보드 검사 초안");
  await message(page).focus();
  await message(page).press("Tab");
  const send = page.getByRole("button", { name: "질문 보내기", exact: true });
  await expect(send).toBeFocused();
  const usableSend = await send.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return bounds.top >= 0 && bounds.bottom <= innerHeight && !!hit && element.contains(hit);
  });
  expect(usableSend).toBe(true);
  expect(calls).toBe(0);
});

test("a reference with a missing insertion anchor stays discoverable at the document end without changing learning events", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => {
    calls++;
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    await route.fulfill({ json: response(body, "검사용 고아 자료의 최초 응답") });
  });
  await page.goto("/practice/have/");
  await submitFirst(page);
  await expect(page.getByText("검사용 고아 자료의 최초 응답", { exact: true })).toBeVisible();
  await addReference(page, "get");
  await page.locator('.lw-quiz-artifact[data-question-id="titanic-have-2"]').getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).click();
  const firstId = await page.locator('.lw-quiz-artifact[data-question-id="titanic-have-1"]').getAttribute("data-artifact-id");
  const secondId = await page.locator('.lw-quiz-artifact[data-question-id="titanic-have-2"]').getAttribute("data-artifact-id");
  await openQuestionInput(page);
  await message(page).fill("자료 위치 손상에도 남는 2번 질문 초안");
  const remaining = await page.locator(".lw-quiz-artifact").evaluateAll(nodes => nodes.slice(2).map(node => `artifact-${node.getAttribute("data-artifact-id")}`));
  const originalOrder = ["reference-have", `artifact-${firstId}`, "reference-get", `artifact-${secondId}`, ...remaining];
  expect(await bodyOrder(page)).toEqual(originalOrder);
  await expect.poll(async () => page.evaluate(key => localStorage.getItem(key), learningKey)).toContain("자료 위치 손상에도 남는 2번 질문 초안");
  const originalLearning = await page.evaluate(key => localStorage.getItem(key), learningKey);
  await page.evaluate(key => {
    const ui = JSON.parse(localStorage.getItem(key)!);
    ui.references.find((item: { id: string }) => item.id === "get").afterEventId = "missing-event";
    localStorage.setItem(key, JSON.stringify(ui));
  }, uiKey);
  await page.reload();
  await openQuestionInput(page);
  await expect(message(page)).toHaveValue("자료 위치 손상에도 남는 2번 질문 초안");
  await expectQuizTarget(page, secondId!);
  const recoveredOrder = ["reference-have", `artifact-${firstId}`, `artifact-${secondId}`, ...remaining, "reference-get"];
  expect(await bodyOrder(page)).toEqual(recoveredOrder);
  expect(await outlineHrefs(page)).toEqual(recoveredOrder.map(id => `#doc-${id}`));
  await jumpTo(page, "reference-get");
  await expect(reference(page, "get").locator(".lw-orphan-notice")).toHaveText("추가 위치를 확인하지 못해 문서 끝에 보관한 자료입니다.");
  expect(await page.evaluate(key => localStorage.getItem(key), learningKey)).toBe(originalLearning);
  expect(calls).toBe(1);
});
