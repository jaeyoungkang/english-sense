import { test, expect, type Page } from "@playwright/test";
import type { LearningChatRequest } from "../../lib/learning-chat-contract";

async function pane(page: Page, name: string) {
  const navigation = page.getByRole("navigation", { name: "학습 패널" });
  if (await navigation.isVisible()) await navigation.getByRole("button", { name, exact: true }).click();
}

async function submitFirstAnswer(page: Page) {
  await pane(page, "내 수행");
  await page.locator("#lw-choice-1").check();
  await page.getByLabel("그 문장을 고른 까닭").fill("브라우저 검사 입력: 아이 전체가 떠오릅니다.");
  await page.getByRole("button", { name: "내 답 제출하고 대화하기" }).click();
}

test("workspace keeps scene, first attempt, revisions and a multi-turn API conversation", async ({ page }) => {
  const requests: LearningChatRequest[] = [];
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as LearningChatRequest;
    requests.push(body);
    await route.fulfill({ json: { requestId: body.requestId, reply: `검사용 모의 응답 ${requests.length}`, mode: "ai" } });
  });
  await page.goto("/");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.getByAltText(/학습용 재구성: 배의/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await submitFirstAnswer(page);
  await expect(page.getByText("검사용 모의 응답 1", { exact: true })).toBeVisible();
  expect(requests[0].initialAttempt).toEqual({ choice: 1, reason: "브라우저 검사 입력: 아이 전체가 떠오릅니다." });
  expect(requests[0].messages).toEqual([]);
  await page.getByLabel("이 장면에 대해 질문하기").fill("브라우저 검사 질문: 왜 그렇게 그려집니까?");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect(page.getByText("검사용 모의 응답 2", { exact: true })).toBeVisible();
  expect(requests[1].messages).toContainEqual({ role: "assistant", content: "검사용 모의 응답 1" });
  await pane(page, "내 수행");
  await page.getByLabel("내가 고친 답").fill("브라우저 검사 수정: 다른 결을 비교합니다.");
  await page.getByRole("button", { name: "수정한 답 남기기", exact: true }).click();
  await pane(page, "함께 풀기");
  await page.getByLabel("이 장면에 대해 질문하기").fill("브라우저 검사 질문: 수정 뒤는 어떻습니까?");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect(page.getByText("검사용 모의 응답 3", { exact: true })).toBeVisible();
  expect(requests[2].revisions).toEqual([{ text: "브라우저 검사 수정: 다른 결을 비교합니다." }]);
  expect(requests[2].initialAttempt).toEqual(requests[0].initialAttempt);
  await page.getByLabel("이 장면에 대해 질문하기").fill("아직 보내지 않은 검사 초안");
  await page.reload();
  await pane(page, "함께 풀기");
  await expect(page.getByText("검사용 모의 응답 3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("아직 보내지 않은 검사 초안");
  expect(requests).toHaveLength(3);
  await pane(page, "내 수행");
  await page.getByRole("button", { name: "내 수행 기록", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("브라우저 검사 입력: 아이 전체가 떠오릅니다.");
  await expect(page.getByRole("dialog")).toContainText("브라우저 검사 수정: 다른 결을 비교합니다.");
  await page.getByRole("button", { name: "닫고 학습으로 돌아가기" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "새 대화", exact: true }).click();
  await pane(page, "함께 풀기");
  await expect(page.locator(".lw-turn")).toHaveCount(0);
  await page.getByLabel("이 장면에 대해 질문하기").fill("브라우저 검사: 새 대화에서도 내 수행을 봅니까?");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect(page.getByText("검사용 모의 응답 4", { exact: true })).toBeVisible();
  expect(requests[3].messages).toEqual([]);
  expect(requests[3].initialAttempt).toEqual(requests[0].initialAttempt);
  expect(requests[3].revisions).toEqual(requests[2].revisions);
  await pane(page, "내 수행");
  await page.getByRole("button", { name: "내 수행 기록", exact: true }).click();
  await page.locator(".lw-archive summary").click();
  await expect(page.locator(".lw-archive")).toContainText("검사용 모의 응답 1");
  await expect(page.locator(".lw-archive")).toContainText("아직 보내지 않은 검사 초안");
});

test("failed conversation retries one turn and cancelled late replies cannot overwrite a new request", async ({ page }) => {
  let count = 0;
  let releaseLate: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as LearningChatRequest;
    count++;
    if (count === 1) return route.fulfill({ status: 503, json: { detail: "검사용 일시 실패" } });
    if (body.message === "검사용 느린 질문") {
      await new Promise<void>(resolve => { releaseLate = resolve; });
      await route.fulfill({ json: { requestId: body.requestId, reply: "도착하면 안 되는 옛 응답", mode: "ai" } }).catch(() => {});
      return;
    }
    await route.fulfill({ json: { requestId: body.requestId, reply: "검사용 현재 응답", mode: "ai" } });
  });
  await page.goto("/");
  await submitFirstAnswer(page);
  await expect(page.getByText("검사용 일시 실패", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "같은 질문 다시 보내기" }).click();
  await expect(page.getByText("검사용 현재 응답", { exact: true })).toBeVisible();
  await expect(page.locator(".lw-turn")).toHaveCount(1);
  await page.getByLabel("이 장면에 대해 질문하기").fill("검사용 느린 질문");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect.poll(() => !!releaseLate).toBe(true);
  await page.getByRole("button", { name: "중단", exact: true }).click();
  await page.getByLabel("이 장면에 대해 질문하기").fill("검사용 새 질문");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect(page.getByText("검사용 현재 응답", { exact: true })).toHaveCount(2);
  releaseLate!();
  await expect(page.getByText("도착하면 안 되는 옛 응답", { exact: true })).toHaveCount(0);
  await expect(page.locator(".lw-cancelled")).toContainText("중단");
});

test("image failure, blocked storage and IME input keep the workspace usable", async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException("blocked", "QuotaExceededError"); }; });
  await page.route("**/assets/learning/titanic-corridor.webp", route => route.abort());
  let calls = 0;
  page.on("request", request => { if (request.url().includes("/api/learn-chat/")) calls++; });
  await page.goto("/");
  await expect(page.getByText("이미지를 불러오지 못해 대체 그림을 표시합니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "감각 자료 찾기", exact: true })).toBeVisible();
  await pane(page, "내 수행");
  await page.getByLabel("그 문장을 고른 까닭").fill("저장 차단 검사용 초안");
  await expect(page.locator(".lw-attempt-panel .lw-save-warning")).toBeVisible();
  await expect(page.getByLabel("그 문장을 고른 까닭")).toHaveValue("저장 차단 검사용 초안");
  await pane(page, "함께 풀기");
  const input = page.getByLabel("이 장면에 대해 질문하기");
  await input.fill("아직 조합 중인 검사용 질문");
  await input.evaluate(element => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true })));
  await input.press("Enter");
  expect(calls).toBe(0);
});
