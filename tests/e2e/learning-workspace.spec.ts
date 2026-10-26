import { test, expect, type Page } from "@playwright/test";
import type { LearningChatRequest } from "../../lib/learning-chat-contract";

const storageKey = "english-sense-learning-workspace-v2";
const legacyKey = "english-sense-learning-workspace-v1";
const firstReason = "브라우저 검사 입력: 아이 전체가 떠오릅니다.";
const revisionText = "브라우저 검사 수정: 다른 결을 비교합니다.";

async function submitFirstAnswer(page: Page) {
  await page.locator("#lw-choice-1").check();
  await page.getByLabel("그 문장을 고른 까닭").fill(firstReason);
  await page.getByRole("button", { name: "내 답 제출하고 대화하기" }).click();
}
async function ask(page: Page, text: string) {
  await page.getByLabel("이 장면에 대해 질문하기").fill(text);
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
}
async function revise(page: Page) {
  await page.getByRole("button", { name: "답을 고쳐 쓰기", exact: true }).click();
  await page.getByLabel("내가 고친 답").fill(revisionText);
  await page.getByRole("button", { name: "수정한 답 남기기", exact: true }).click();
}
async function eventKinds(page: Page) {
  return page.locator(".lw-timeline > .lw-timeline-event").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-event-kind")));
}

test("pinned have materials accompany one ordered conversation, restored drafts and archived performance", async ({ page }) => {
  const requests: LearningChatRequest[] = [];
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as LearningChatRequest;
    requests.push(body);
    await route.fulfill({ json: { requestId: body.requestId, reply: `검사용 모의 응답 ${requests.length}`, mode: "ai" } });
  });
  await page.goto("/");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.getByAltText(/사람을 둘러싼 연두색 타원/)).toBeVisible();
  await expect(page.locator(".lw-sense-image img")).toHaveAttribute("src", "/assets/learning/have-sense.webp");
  await expect(page.getByRole("navigation", { name: "학습 패널" })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("log", { name: "학습 수행과 대화" })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await submitFirstAnswer(page);
  await expect(page.getByText("검사용 모의 응답 1", { exact: true })).toBeVisible();
  expect(requests[0].initialAttempt).toEqual({ choice: 1, reason: firstReason });
  expect(requests[0].messages).toEqual([]);
  await ask(page, "브라우저 검사 질문: 왜 그렇게 그려집니까?");
  await expect(page.getByText("검사용 모의 응답 2", { exact: true })).toBeVisible();
  expect(requests[1].messages).toContainEqual({ role: "assistant", content: "검사용 모의 응답 1" });
  await revise(page);
  await ask(page, "브라우저 검사 질문: 수정 뒤는 어떻습니까?");
  await expect(page.getByText("검사용 모의 응답 3", { exact: true })).toBeVisible();
  expect(requests[2].revisions).toEqual([{ text: revisionText }]);
  expect(requests[2].initialAttempt).toEqual(requests[0].initialAttempt);
  expect(await eventKinds(page)).toEqual(["initial", "request", "reply", "request", "reply", "revision", "request", "reply"]);
  await page.getByLabel("이 장면에 대해 질문하기").fill("아직 보내지 않은 검사 초안");
  await page.reload();
  await expect(page.getByText("검사용 모의 응답 3", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("아직 보내지 않은 검사 초안");
  expect(requests).toHaveLength(3);
  expect(await eventKinds(page)).toEqual(["initial", "request", "reply", "request", "reply", "revision", "request", "reply"]);
  await page.getByRole("button", { name: "내 수행 기록", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(firstReason);
  await expect(page.getByRole("dialog")).toContainText(revisionText);
  await page.getByRole("button", { name: "닫고 학습으로 돌아가기" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "새 대화", exact: true }).click();
  await expect(page.locator(".lw-turn")).toHaveCount(0);
  expect(await eventKinds(page)).toEqual(["carry"]);
  await ask(page, "브라우저 검사: 새 대화에서도 내 수행을 봅니까?");
  await expect(page.getByText("검사용 모의 응답 4", { exact: true })).toBeVisible();
  expect(requests[3].messages).toEqual([]);
  expect(requests[3].initialAttempt).toEqual(requests[0].initialAttempt);
  expect(requests[3].revisions).toEqual(requests[2].revisions);
  await page.reload();
  await expect(page.getByText("검사용 모의 응답 4", { exact: true })).toHaveCount(1);
  expect(requests).toHaveLength(4);
  await page.getByRole("button", { name: "내 수행 기록", exact: true }).click();
  await page.locator(".lw-archive summary").click();
  await expect(page.locator(".lw-archive")).toContainText("검사용 모의 응답 1");
  await expect(page.locator(".lw-archive")).toContainText("아직 보내지 않은 검사 초안");
  await expect(page.locator(".lw-archive-timeline > .lw-timeline-event")).toHaveCount(8);
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
  expect(await eventKinds(page)).toEqual(["initial", "request", "retry", "reply"]);
  await ask(page, "검사용 느린 질문");
  await expect.poll(() => !!releaseLate).toBe(true);
  await page.getByRole("button", { name: "중단", exact: true }).click();
  await ask(page, "검사용 새 질문");
  await expect(page.getByText("검사용 현재 응답", { exact: true })).toHaveCount(2);
  releaseLate!();
  await expect(page.getByText("도착하면 안 되는 옛 응답", { exact: true })).toHaveCount(0);
  await expect(page.locator(".lw-cancelled")).toContainText("중단");
});

test("image failure, blocked storage and IME input keep the workspace usable", async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException("blocked", "QuotaExceededError"); }; });
  await page.route("**/assets/learning/have-sense.webp", route => route.abort());
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => { calls++; await route.abort(); });
  await page.goto("/");
  await expect(page.getByText("이미지 대신 감각 도식을 표시합니다", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "주어의 영역 안에 대상이 놓인 have 감각 대체 도식" })).toBeVisible();
  await expect(page.getByRole("link", { name: "감각 자료 찾기", exact: true })).toBeVisible();
  await page.getByLabel("그 문장을 고른 까닭").fill("저장 차단 검사용 초안");
  await expect(page.locator(".lw-attempt-form .lw-save-warning")).toBeVisible();
  await expect(page.getByLabel("그 문장을 고른 까닭")).toHaveValue("저장 차단 검사용 초안");
  const input = page.getByLabel("이 장면에 대해 질문하기");
  await input.fill("아직 조합 중인 검사용 질문");
  await input.evaluate(element => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true })));
  await input.press("Enter");
  expect(calls).toBe(0);
});

test("v1 source stays intact while unordered old records migrate once and pending replies are not resent", async ({ page }) => {
  const legacy = JSON.stringify({
    version: 1, lessonId: "titanic-have-1", pane: "chat", choice: "1", reason: firstReason,
    initialAttempt: { choice: 1, reason: firstReason }, revisionDraft: "이전 수정 초안", revisions: [{ text: revisionText }], messageDraft: "이전 질문 초안",
    turns: [
      { id: "old-complete", requestId: "old-request", user: "검사용 이전 질문", origin: "question", status: "complete", reply: "검사용 이전 응답", mode: "ai" },
      { id: "old-pending", requestId: "old-pending-request", user: "검사용 복원 대기 질문", origin: "question", status: "pending" },
    ],
    archives: [{ id: "old-archive", draft: "이전 보관 초안", turns: [{ id: "archived-turn", requestId: "archived-request", user: "검사용 보관 질문", origin: "question", status: "complete", reply: "검사용 보관 응답", mode: "ai" }] }],
  });
  await page.addInitScript(({ key, raw }) => { if (!sessionStorage.getItem("legacy-seeded")) { localStorage.setItem(key, raw); sessionStorage.setItem("legacy-seeded", "yes"); } }, { key: legacyKey, raw: legacy });
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => {
    calls++;
    const body = route.request().postDataJSON() as LearningChatRequest;
    await route.fulfill({ json: { requestId: body.requestId, reply: "검사용 마이그레이션 후 응답", mode: "ai" } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "이전 기록을 가져왔습니다" })).toHaveCount(1);
  await expect(page.locator(".lw-legacy-group")).toContainText("작성 순서가 없습니다");
  expect(await eventKinds(page)).toEqual(["legacy"]);
  await page.getByText("이전 수행과 대화 읽기", { exact: true }).click();
  await expect(page.locator(".lw-legacy-group")).toContainText(firstReason);
  await expect(page.locator(".lw-legacy-group")).toContainText(revisionText);
  await expect(page.locator(".lw-legacy-group")).toContainText("검사용 이전 응답");
  await expect(page.getByLabel("내가 고친 답")).toHaveValue("이전 수정 초안");
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("이전 질문 초안");
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).turns[1].status, storageKey)).toBe("cancelled");
  expect(await page.evaluate(key => localStorage.getItem(key), legacyKey)).toBe(legacy);
  expect(calls).toBe(0);
  await page.reload();
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toHaveValue("이전 질문 초안");
  expect(await eventKinds(page)).toEqual(["legacy"]);
  expect(calls).toBe(0);
  await ask(page, "검사용 마이그레이션 후 질문");
  await expect(page.getByText("검사용 마이그레이션 후 응답", { exact: true })).toBeVisible();
  expect(await eventKinds(page)).toEqual(["legacy", "request", "reply"]);
  expect(await page.evaluate(key => localStorage.getItem(key), legacyKey)).toBe(legacy);
  await page.getByRole("button", { name: "내 수행 기록", exact: true }).click();
  await page.locator(".lw-archive summary").click();
  await expect(page.locator(".lw-archive")).toContainText("검사용 보관 응답");
  await expect(page.locator(".lw-archive")).toContainText("이전 보관 초안");
});

test("a revision written while a reply is pending stays before the later reply", async ({ page }) => {
  let calls = 0;
  let releaseReply: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as LearningChatRequest;
    calls++;
    if (calls === 2) await new Promise<void>(resolve => { releaseReply = resolve; });
    await route.fulfill({ json: { requestId: body.requestId, reply: calls === 1 ? "검사용 첫 응답" : "검사용 수정 후 도착 응답", mode: "ai" } });
  });
  await page.goto("/");
  await submitFirstAnswer(page);
  await expect(page.getByText("검사용 첫 응답", { exact: true })).toBeVisible();
  await ask(page, "검사용 기다리는 질문");
  await expect.poll(() => !!releaseReply).toBe(true);
  await revise(page);
  expect(await eventKinds(page)).toEqual(["initial", "request", "reply", "request", "revision"]);
  releaseReply!();
  await expect(page.getByText("검사용 수정 후 도착 응답", { exact: true })).toHaveCount(1);
  expect(await eventKinds(page)).toEqual(["initial", "request", "reply", "request", "revision", "reply"]);
  await page.reload();
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toBeVisible();
  expect(await eventKinds(page)).toEqual(["initial", "request", "reply", "request", "revision", "reply"]);
  expect(calls).toBe(2);
});

test("reading earlier content does not jump on a new reply and the pinned reference stays accessible", async ({ page }) => {
  let calls = 0;
  let releaseReply: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as LearningChatRequest;
    calls++;
    if (calls === 2) await new Promise<void>(resolve => { releaseReply = resolve; });
    await route.fulfill({ json: { requestId: body.requestId, reply: calls === 1 ? "검사용 긴 모의 응답\n".repeat(70) : "검사용 읽기 중 새 응답", mode: "ai" } });
  });
  await page.goto("/");
  await submitFirstAnswer(page);
  await expect(page.locator(".lw-assistant-message")).toHaveCount(1);
  await ask(page, "검사용 읽는 동안 기다리는 질문");
  await expect.poll(() => !!releaseReply).toBe(true);
  const transcript = page.locator(".lw-transcript");
  // Let the explicit send action finish its own scroll before simulating later reading.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await transcript.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  const pinned = await page.locator(".lw-reference").boundingBox();
  expect(pinned).not.toBeNull();
  releaseReply!();
  await expect(page.getByRole("button", { name: "새 응답 보기" })).toBeVisible();
  expect(await transcript.evaluate(element => element.scrollTop)).toBeLessThan(5);
  expect((await page.locator(".lw-reference").boundingBox())?.y).toBe(pinned!.y);
  await page.getByRole("button", { name: "새 응답 보기" }).click();
  await expect(page.getByText("검사용 읽기 중 새 응답", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "새 응답 보기" })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 430 });
  await page.getByRole("button", { name: "펼치기", exact: true }).click();
  await expect(page.getByRole("button", { name: "접기", exact: true })).toBeVisible();
  const bounds = await page.evaluate(() => {
    const reference = document.querySelector(".lw-reference")!.getBoundingClientRect();
    const field = document.querySelector("#lw-message")!.getBoundingClientRect();
    const log = document.querySelector(".lw-transcript")!.getBoundingClientRect();
    return { referenceHeight: reference.height, fieldTop: field.top, fieldBottom: field.bottom, logHeight: log.height, viewportHeight: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(bounds.referenceHeight).toBeLessThanOrEqual(bounds.viewportHeight * .30 + 1);
  expect(bounds.fieldTop).toBeGreaterThan(0);
  expect(bounds.fieldBottom).toBeLessThanOrEqual(bounds.viewportHeight);
  expect(bounds.logHeight).toBeGreaterThan(40);
  expect(bounds.overflow).toBe(false);
  await page.getByRole("button", { name: "접기", exact: true }).click();
  await expect(page.getByRole("button", { name: "펼치기", exact: true })).toBeVisible();
});


test("an archive with missing timeline events is rejected without overwriting its source", async ({ page }) => {
  const raw = JSON.stringify({
    version: 2, lessonId: "titanic-have-1", choice: "", reason: "", initialAttempt: null,
    revisionDraft: "", revisions: [], messageDraft: "", turns: [], events: [], revisionOpen: false,
    archives: [{ id: "broken-archive", draft: "보관한 검사 초안", events: [], turns: [
      { id: "missing-event", requestId: "old-request", user: "보관한 검사 질문", origin: "question", status: "complete", reply: "보관한 검사 응답", mode: "ai" },
    ] }],
  });
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: storageKey, raw });
  let calls = 0;
  await page.route("**/api/learn-chat/**", async route => { calls++; await route.abort(); });
  await page.goto("/");
  await expect(page.getByText("임시 저장 실패 · 화면에 유지 중", { exact: true })).toBeVisible();
  await page.getByLabel("그 문장을 고른 까닭").fill("새 입력으로 원본을 덮어쓰지 않는 검사");
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(raw);
  expect(calls).toBe(0);
});
