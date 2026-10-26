import { test, expect, type Locator, type Page } from "@playwright/test";
import type { ArtifactLearningChatRequest } from "../../lib/learning-chat-contract";
import type { WorkspaceState } from "../../lib/learning-workspace-state";
import { openFirstAnswerInput, openQuestionInput } from "./workspace-input";

const storageKey = "english-sense-learning-workspace-v3";
const firstForm = (page: Page, number = 1) => page.getByRole("form", { name: `${number}번 퀴즈 첫 답`, exact: true });
const revisionForm = (page: Page, number = 1) => page.getByRole("form", { name: `${number}번 퀴즈 수정`, exact: true });
const question = (page: Page) => page.getByLabel("이 장면에 대해 질문하기");
const target = (page: Page) => page.getByLabel("함께 풀 문제", { exact: true });
const card = (page: Page, number = 1) => page.locator(`.lw-quiz-artifact[data-question-id="titanic-have-${number}"]`);
const response = (body: ArtifactLearningChatRequest, reply: string, mode: "guidance" | "ai" = "ai") => ({ requestId: body.requestId, artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply, mode });

async function stored(page: Page): Promise<WorkspaceState> {
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).not.toBeNull();
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
}
async function onlyInput(page: Page, kind: "initial" | "revision" | "question", number = 1) {
  const pane = page.getByRole("region", { name: "AI 대화", exact: true });
  await expect(pane.locator("form")).toHaveCount(1);
  await expect(firstForm(page, number)).toHaveCount(kind === "initial" ? 1 : 0);
  await expect(revisionForm(page, number)).toHaveCount(kind === "revision" ? 1 : 0);
  await expect(question(page)).toHaveCount(kind === "question" ? 1 : 0);
  await expect(page.locator(".lw-content-pane form, .lw-content-pane textarea, .lw-content-pane input")).toHaveCount(0);
}
async function openRevision(page: Page) {
  await page.getByRole("button", { name: /^(답을 고쳐 쓰기|작성하던 수정 이어 쓰기)$/ }).click();
}
async function unobscured(locator: Locator) {
  return locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && !!hit && element.contains(hit);
  });
}

// Provider responses below are mocks. They verify interaction and request meaning,
// not the quality of tutoring or the learner's understanding.
test("one conversation input distinguishes a question, the first answer and a revision", async ({ page }) => {
  const requests: ArtifactLearningChatRequest[] = [];
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    await route.fulfill({ json: response(body, body.initialAttempt ? `검사용 제출 뒤 피드백 ${requests.length}` : "검사용 무료 준비 안내", body.initialAttempt ? "ai" : "guidance") });
  });
  await page.goto("/");
  await onlyInput(page, "initial");
  await expect(card(page).getByRole("list", { name: "1번 퀴즈 보기", exact: true })).toHaveCount(1);
  await card(page).getByRole("button", { name: "이 퀴즈로 이어 가기", exact: true }).click();
  await expect(firstForm(page).locator("input,textarea").first()).toBeFocused();
  expect(requests).toHaveLength(0);
  await firstForm(page).locator('input[type="radio"]').nth(1).check();
  const reason = firstForm(page).getByLabel("그 문장을 고른 까닭");
  await reason.fill("검사용 첫 답 초안: 떠올린 장면을 그대로 남깁니다.");
  await reason.press("Control+Enter");
  const reasonDraft = await reason.inputValue();
  await expect(page.locator('.lw-timeline-event[data-event-kind="initial"]')).toHaveCount(0);
  expect(requests).toHaveLength(0);

  await openQuestionInput(page);
  await onlyInput(page, "question");
  await question(page).fill("검사용 제출 전 질문입니다.");
  await question(page).evaluate(element => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true })));
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect(page.getByText("검사용 무료 준비 안내", { exact: true })).toBeVisible();
  await expect(page.locator(".lw-assistant-message .lw-message-meta")).toContainText("준비 안내 · AI 호출 없음");
  expect(requests).toHaveLength(1);
  expect(requests[0].initialAttempt).toBeNull();
  expect(requests[0].revisions).toEqual([]);
  await expect(page.locator('.lw-timeline-event[data-event-kind="initial"], .lw-timeline-event[data-event-kind="revision"]')).toHaveCount(0);
  expect((await stored(page)).artifacts[0].initialAttempt).toBeNull();
  await question(page).fill("검사용 아직 보내지 않은 추가 질문");

  await openFirstAnswerInput(page, 1);
  await onlyInput(page, "initial");
  await expect(firstForm(page).locator('input[type="radio"]').nth(1)).toBeChecked();
  await expect(reason).toHaveValue(reasonDraft);
  await reason.fill("   ");
  await firstForm(page).getByRole("button", { name: "내 답 제출하고 대화하기" }).click();
  await expect.poll(() => reason.evaluate(element => (element as HTMLTextAreaElement).validationMessage)).toBe("한 글자 이상 적어 주십시오.");
  await expect(page.locator('.lw-timeline-event[data-event-kind="initial"]')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  await reason.fill(reasonDraft);
  await expect.poll(() => reason.evaluate(element => (element as HTMLTextAreaElement).validity.valid)).toBe(true);
  await firstForm(page).getByRole("button", { name: "내 답 제출하고 대화하기" }).click();
  await expect(page.getByText("검사용 제출 뒤 피드백 2", { exact: true })).toBeVisible();
  await onlyInput(page, "question");
  await expect(question(page)).toHaveValue("검사용 아직 보내지 않은 추가 질문");
  const initial = requests[1].initialAttempt;
  expect(initial).toEqual({ kind: "choose", choice: 1, reason: "검사용 첫 답 초안: 떠올린 장면을 그대로 남깁니다." });
  expect(requests[1].artifactId).toBe(requests[0].artifactId);

  await openRevision(page);
  await onlyInput(page, "revision");
  const revision = revisionForm(page).getByLabel("내가 고친 답");
  await revision.fill("   ");
  await revisionForm(page).getByRole("button", { name: "수정한 답 남기기", exact: true }).click();
  await expect.poll(() => revision.evaluate(element => (element as HTMLTextAreaElement).validationMessage)).toBe("수정한 답을 한 글자 이상 적어 주십시오.");
  expect((await stored(page)).artifacts[0].revisions).toEqual([]);
  expect(requests).toHaveLength(2);
  await revision.fill("검사용 별도로 남기는 수정");
  await expect.poll(() => revision.evaluate(element => (element as HTMLTextAreaElement).validity.valid)).toBe(true);
  await revisionForm(page).getByRole("button", { name: "초안을 두고 나중에 쓰기", exact: true }).click();
  await onlyInput(page, "question");
  expect(requests).toHaveLength(2);
  expect((await stored(page)).artifacts[0].revisions).toEqual([]);
  await expect(question(page)).toHaveValue("검사용 아직 보내지 않은 추가 질문");
  await openRevision(page);
  await expect(revisionForm(page).getByLabel("내가 고친 답")).toHaveValue("검사용 별도로 남기는 수정");
  await revisionForm(page).getByRole("button", { name: "수정한 답 남기기", exact: true }).click();
  await onlyInput(page, "question");
  expect(requests).toHaveLength(2);
  await expect.poll(async () => (await stored(page)).artifacts[0].revisions.length).toBe(1);
  const afterRevision = (await stored(page)).artifacts[0];
  expect(afterRevision.initialAttempt).toEqual(initial);
  expect(afterRevision.revisions).toEqual([{ text: "검사용 별도로 남기는 수정" }]);
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect(page.getByText("검사용 제출 뒤 피드백 3", { exact: true })).toBeVisible();
  expect(requests[2].initialAttempt).toEqual(initial);
  expect(requests[2].revisions).toEqual(afterRevision.revisions);
  expect((await stored(page)).events.map(event => event.kind)).toEqual(["card", "request", "reply", "initial", "request", "reply", "revision", "request", "reply"]);
});

test("changing the input target and reloading preserves each draft without adopting a late reply", async ({ page }) => {
  const requests: ArtifactLearningChatRequest[] = [];
  let release: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    if (requests.length === 2) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: response(body, requests.length === 1 ? "검사용 첫 피드백" : "검사용 재개 뒤 채택하지 않을 옛 응답") }).catch(() => {});
  });
  await page.goto("/");
  await firstForm(page).locator('input[type="radio"]').nth(1).check();
  await firstForm(page).getByLabel("그 문장을 고른 까닭").fill("검사용 1번 첫 답");
  await firstForm(page).getByRole("button", { name: "내 답 제출하고 대화하기" }).click();
  await expect(page.getByText("검사용 첫 피드백", { exact: true })).toBeVisible();
  const firstId = requests[0].artifactId;
  await question(page).fill("검사용 1번 질문 초안");
  await openRevision(page);
  await revisionForm(page).getByLabel("내가 고친 답").fill("검사용 1번 수정 초안");
  await revisionForm(page).getByRole("button", { name: "초안을 두고 나중에 쓰기", exact: true }).click();
  await page.getByRole("button", { name: "다음 퀴즈 추가", exact: true }).click();
  const secondId = await card(page, 2).getAttribute("data-artifact-id");
  await onlyInput(page, "initial", 2);
  await firstForm(page, 2).locator('input[type="radio"]').nth(2).check();
  await firstForm(page, 2).getByLabel("그 문장을 고른 까닭").fill("검사용 2번 첫 답 초안");
  await openQuestionInput(page);
  await question(page).fill("검사용 2번 질문 초안");
  await target(page).selectOption(firstId);
  await expect(question(page)).toHaveValue("검사용 1번 질문 초안");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await question(page).fill("검사용 1번 응답 대기 중 새 질문 초안");
  await target(page).selectOption(secondId!);
  await openFirstAnswerInput(page, 2);
  await expect(page.getByRole("button", { name: "1번 응답 중단", exact: true })).toBeVisible();
  await expect(firstForm(page, 2).getByLabel("그 문장을 고른 까닭")).toHaveValue("검사용 2번 첫 답 초안");
  await expect(firstForm(page, 2).locator('input[type="radio"]').nth(2)).toBeChecked();

  // Reading the first card through its existing reference is independent of the
  // second card selected for input, even while the first request is pending.
  await page.getByRole("link", { name: "1번 퀴즈 본문 보기", exact: true }).click();
  await expect(target(page)).toHaveValue(secondId!);
  await onlyInput(page, "initial", 2);
  await openQuestionInput(page);
  await expect(question(page)).toHaveValue("검사용 2번 질문 초안");
  await expect.poll(async () => (await stored(page)).artifacts[0].messageDraft).toBe("검사용 1번 응답 대기 중 새 질문 초안");
  await page.reload();
  release!();
  await onlyInput(page, "initial", 2);
  await expect(target(page)).toHaveValue(secondId!);
  await expect(firstForm(page, 2).getByLabel("그 문장을 고른 까닭")).toHaveValue("검사용 2번 첫 답 초안");
  await expect(firstForm(page, 2).locator('input[type="radio"]').nth(2)).toBeChecked();
  await openQuestionInput(page);
  await expect(question(page)).toHaveValue("검사용 2번 질문 초안");
  await target(page).selectOption(firstId);
  await expect(question(page)).toHaveValue("검사용 1번 응답 대기 중 새 질문 초안");
  await openRevision(page);
  await expect(revisionForm(page).getByLabel("내가 고친 답")).toHaveValue("검사용 1번 수정 초안");
  const restored = await stored(page);
  expect(restored.artifacts[0].initialAttempt).toEqual(requests[0].initialAttempt);
  expect(restored.artifacts[0].revisions).toEqual([]);
  expect(restored.artifacts[1].initialAttempt).toBeNull();
  expect(restored.events.filter(event => event.kind === "initial")).toHaveLength(1);
  await expect(page.getByText("검사용 재개 뒤 채택하지 않을 옛 응답", { exact: true })).toHaveCount(0);
  await expect(page.locator(".lw-cancelled")).toContainText("자동으로 다시 전송하지 않습니다");
  expect(requests).toHaveLength(2);
  expect(requests[1].artifactId).toBe(firstId);
  expect(JSON.stringify(requests[1])).not.toContain("검사용 2번");
});

test("the single input remains reachable with the document at wide and short narrow sizes", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => { calls++; await route.abort(); });
  await page.goto("/");
  for (const size of [{ width: 1440, height: 960 }, { width: 1100, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 430 }]) {
    await page.setViewportSize(size);
    await openFirstAnswerInput(page, 1);
    await onlyInput(page, "initial");
    await card(page).getByRole("button", { name: "이 퀴즈로 이어 가기", exact: true }).click();
    const firstField = firstForm(page).locator("input,textarea").first();
    await expect(firstField).toBeFocused();
    expect(await unobscured(firstField)).toBe(true);
    await firstForm(page).locator('input[type="radio"]').nth(1).check();
    const draft = `검사용 ${size.width}폭 이유 초안`;
    await firstForm(page).getByLabel("그 문장을 고른 까닭").fill(draft);
    const submit = firstForm(page).getByRole("button", { name: "내 답 제출하고 대화하기" });
    await submit.scrollIntoViewIfNeeded();
    expect(await unobscured(submit)).toBe(true);
    const panes = await page.evaluate(() => {
      const content = document.querySelector(".lw-content-pane")!.getBoundingClientRect();
      const chat = document.querySelector(".lw-chat-pane")!.getBoundingClientRect();
      return { contentRight: content.right, contentBottom: content.bottom, chatLeft: chat.left, chatTop: chat.top };
    });
    if (size.width >= 1100) expect(panes.contentRight).toBeLessThanOrEqual(panes.chatLeft + 1);
    else expect(panes.contentBottom).toBeLessThanOrEqual(panes.chatTop + 1);
    await openQuestionInput(page);
    await onlyInput(page, "question");
    await question(page).fill(`검사용 ${size.width}폭 질문 초안`);
    await question(page).focus();
    expect(await unobscured(question(page))).toBe(true);
    await openFirstAnswerInput(page, 1);
    await expect(firstForm(page).getByLabel("그 문장을 고른 까닭")).toHaveValue(draft);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  expect(calls).toBe(0);
});
