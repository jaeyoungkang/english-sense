import { readFileSync } from "node:fs";
import { test, expect, type Download, type Page } from "@playwright/test";
import askData from "../../content/ask.json";
import type { AskFollowupRequest, AskMode, Explanation } from "../../lib/ask-contract";
import type { AskRecords } from "../../lib/ask-records";

const KEY = "english-sense-ask-v1";
const archive = (page: Page) => page.locator(".ask-archive");
const question = (page: Page) => page.getByLabel("이 해설에 대해 추가 질문하기", { exact: true });
const followupButton = (page: Page) => page.getByRole("button", { name: "추가 질문 보내기", exact: true });
const pick = (page: Page, text: string) => archive(page).locator("li > button").filter({ hasText: text });
const ready = async (page: Page) => { await expect(page.locator(".ask-storage-fact")).not.toContainText("기록 확인 중"); };
const raw = (page: Page) => page.evaluate(key => localStorage.getItem(key), KEY);
async function saved(page: Page): Promise<AskRecords> { return JSON.parse((await raw(page))!) as AskRecords; }
const explanation = (text: string): Explanation => ({ ...askData.sample, english: `Mock explanation: ${text}`, korean: `검증용 모의 해설: ${text}` } as Explanation);

async function initialMocks(page: Page) {
  const requests: { mode: AskMode; text: string }[] = [];
  for (const mode of ["explain", "translate"] as const) {
    await page.route(`**/api/${mode}**`, async route => {
      const body = route.request().postDataJSON() as { text: string };
      requests.push({ mode, text: body.text });
      await route.fulfill({ json: explanation(body.text) });
    });
  }
  return requests;
}

async function requestInitial(page: Page, text: string, mode: AskMode = "explain") {
  await page.getByRole("tab", { name: mode === "explain" ? "영어 문장 해설" : "한국어를 영어로", exact: true }).click();
  await page.locator("#input").fill(text);
  await page.getByRole("button", { name: mode === "explain" ? "해설 보기" : "영어로 옮기기", exact: true }).click();
  await expect(page.locator(".ask-submitted blockquote")).toHaveText(text.trim());
  await expect(page.locator("#res-badge")).toHaveText("응답 받음");
  await expect(page.locator("#result .en-big")).toHaveText(explanation(text.trim()).english);
}

async function sendQuestion(page: Page, message: string, reply: string) {
  await question(page).fill(message);
  await followupButton(page).click();
  await expect(page.locator(".ask-assistant-turn").last()).toContainText(reply);
}

async function downloadedText(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFileSync(path!, "utf8");
}

// These tests create only synthetic records. Unmatched APIs are blocked, and all AI replies are mocked.
test.beforeEach(async ({ page }) => { await page.route("**/api/**", route => route.abort("blockedbyclient")); });

test("samples create no history; two real form requests retain their own results, conversations and drafts after reload", async ({ page }) => {
  const requests = await initialMocks(page);
  const followups: AskFollowupRequest[] = [];
  await page.route("**/api/ask-followup/**", async route => {
    const body = route.request().postDataJSON() as AskFollowupRequest;
    followups.push(body);
    await route.fulfill({ json: { recordId: body.recordId, requestId: body.requestId, reply: `모의 답변 ${followups.length}` } });
  });
  await page.goto("/ask/"); await ready(page);
  await expect(archive(page).locator("li")).toHaveCount(0);
  await expect(page.locator("#res-badge")).toHaveText("예시 해설");
  expect(await raw(page)).toBeNull();
  const first = "First synthetic sentence.", second = "두 번째 검증용 문장입니다.";
  await requestInitial(page, first);
  await sendQuestion(page, "첫 해설의 검증용 추가 질문", "모의 답변 1");
  await question(page).fill("첫 해설의 미전송 초안");
  await requestInitial(page, second, "translate");
  await sendQuestion(page, "두 번째 해설의 검증용 추가 질문", "모의 답변 2");
  await question(page).fill("두 번째 해설의 미전송 초안");
  const before = await saved(page);
  expect(before.entries.map(entry => [entry.mode, entry.text, entry.status])).toEqual([["explain", first, "succeeded"], ["translate", second, "succeeded"]]);
  expect(before.entries.map(entry => entry.result)).toEqual([explanation(first), explanation(second)]);
  expect(before.entries.map(entry => entry.turns[0].reply)).toEqual(["모의 답변 1", "모의 답변 2"]);
  expect(requests).toEqual([{ mode: "explain", text: first }, { mode: "translate", text: second }]);
  await page.reload(); await ready(page);
  expect(await saved(page)).toEqual(before);
  await expect(question(page)).toHaveValue("두 번째 해설의 미전송 초안");
  await expect(page.locator(".ask-assistant-turn")).toContainText("모의 답변 2");
  await pick(page, first).click();
  await expect(page.locator("#result .en-big")).toHaveText(explanation(first).english);
  await expect(question(page)).toHaveValue("첫 해설의 미전송 초안");
  await expect(page.locator(".ask-assistant-turn")).toContainText("모의 답변 1");
  expect(requests).toHaveLength(2);
  expect(followups).toHaveLength(2);
});

test("followups send the original explanation and successful pairs, and a late A reply leaves the selected B record and reading position unchanged", async ({ page }) => {
  await initialMocks(page);
  const bodies: AskFollowupRequest[] = [];
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/ask-followup/**", async route => {
    const body = route.request().postDataJSON() as AskFollowupRequest;
    bodies.push(body);
    if (bodies.length === 2) await delayed;
    await route.fulfill({ json: { recordId: body.recordId, requestId: body.requestId, reply: bodies.length === 1 ? "A의 첫 모의 답변" : "A에만 붙는 늦은 모의 답변" } });
  });
  await page.goto("/ask/"); await ready(page);
  const a = "Synthetic record A.", b = "검증용 별도 기록 B";
  await requestInitial(page, a);
  await requestInitial(page, b, "translate");
  await pick(page, a).click();
  await sendQuestion(page, "A의 첫 질문", "A의 첫 모의 답변");
  expect(bodies[0]).toMatchObject({ mode: "explain", text: a, explanation: explanation(a), messages: [], message: "A의 첫 질문" });
  await question(page).fill("A의 두 번째 질문");
  await followupButton(page).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ recordId: bodies[0].recordId, mode: "explain", text: a, explanation: explanation(a), messages: [{ role: "user", content: "A의 첫 질문" }, { role: "assistant", content: "A의 첫 모의 답변" }], message: "A의 두 번째 질문" });
  expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
  await pick(page, b).click();
  await question(page).fill("B에서 쓰는 미전송 질문");
  await page.locator("#result .en-big").scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  release();
  await expect.poll(async () => (await saved(page)).entries.find(entry => entry.text === a)?.turns.at(-1)?.status).toBe("succeeded");
  await expect(page.locator("#result .en-big")).toHaveText(explanation(b).english);
  await expect(question(page)).toHaveValue("B에서 쓰는 미전송 질문");
  await expect(page.locator(".ask-conversation")).toHaveCount(0);
  expect(await page.evaluate(() => scrollY)).toBe(position);
  const state = await saved(page), recordA = state.entries.find(entry => entry.text === a)!, recordB = state.entries.find(entry => entry.text === b)!;
  expect(state.selectedId).toBe(recordB.id);
  expect(recordA.turns[1].reply).toBe("A에만 붙는 늦은 모의 답변");
  expect(recordB.turns).toEqual([]);
  await pick(page, a).click();
  await expect(page.locator(".ask-assistant-turn").last()).toContainText("A에만 붙는 늦은 모의 답변");
});

test("initial 503 and followup 429 failures remain intact when explicit retries create new linked IDs", async ({ page }) => {
  let initialCalls = 0;
  await page.route("**/api/explain**", route => {
    initialCalls++;
    return route.fulfill(initialCalls === 1 ? { status: 503, json: { detail: "검증용 초기 해설 실패" } } : { json: explanation("Retry source sentence.") });
  });
  const bodies: AskFollowupRequest[] = [];
  await page.route("**/api/ask-followup/**", route => {
    const body = route.request().postDataJSON() as AskFollowupRequest;
    bodies.push(body);
    return route.fulfill(bodies.length === 1 ? { status: 429, json: { detail: "검증용 추가 질문 한도" } } : { json: { recordId: body.recordId, requestId: body.requestId, reply: "명시적 재시도의 모의 답변" } });
  });
  await page.goto("/ask/"); await ready(page);
  await page.locator("#input").fill("Retry source sentence.");
  await page.getByRole("button", { name: "해설 보기", exact: true }).click();
  await expect(page.locator("#result").getByRole("alert")).toHaveText("검증용 초기 해설 실패");
  const failed = (await saved(page)).entries[0];
  await page.getByRole("button", { name: "이 문장 다시 요청", exact: true }).click();
  await expect(page.locator("#res-badge")).toHaveText("응답 받음");
  let state = await saved(page);
  expect(state.entries[0]).toEqual(failed);
  expect(state.entries[1]).toMatchObject({ retryOf: failed.id, text: failed.text, status: "succeeded" });
  expect(state.entries[1].id).not.toBe(failed.id);
  await question(page).fill("실패해도 남아야 하는 질문 원문");
  await followupButton(page).click();
  await expect(page.locator(".ask-turn-state")).toContainText("검증용 추가 질문 한도");
  const failedTurn = (await saved(page)).entries[1].turns[0];
  await page.getByRole("button", { name: "이 질문 다시 보내기", exact: true }).click();
  await expect(page.locator(".ask-assistant-turn")).toContainText("명시적 재시도의 모의 답변");
  state = await saved(page);
  expect(state.entries[1].turns[0]).toEqual(failedTurn);
  expect(state.entries[1].turns[1]).toMatchObject({ retryOf: failedTurn.id, message: failedTurn.message, status: "succeeded" });
  expect(state.entries[1].turns[1].id).not.toBe(failedTurn.id);
  expect(bodies.map(body => body.requestId)).toEqual(state.entries[1].turns.map(turn => turn.id));
  expect(bodies[1].messages).toEqual([]);
  expect(initialCalls).toBe(2);
  await page.reload(); await ready(page);
  expect((await saved(page)).entries).toEqual(state.entries);
  expect(initialCalls).toBe(2);
  expect(bodies).toHaveLength(2);
});

test("reloading a genuinely pending request restores unknown without automatically sending it again", async ({ page }) => {
  let requests = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/explain**", async route => {
    requests++;
    await gate;
    await route.abort().catch(() => {});
  });
  try {
    await page.goto("/ask/"); await ready(page);
    await page.locator("#input").fill("A pending synthetic request.");
    await page.getByRole("button", { name: "해설 보기", exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    const pending = (await saved(page)).entries[0];
    expect(pending.status).toBe("pending");
    await page.reload(); await ready(page);
    await expect(page.locator("#res-badge")).toHaveText("결과 확인 못함");
    await expect(page.locator("#result")).toContainText("자동으로 다시 보내지 않았습니다");
    expect((await saved(page)).entries[0]).toEqual({ ...pending, status: "unknown" });
    expect(requests).toBe(1);
  } finally { release(); }
});

test("a failed local write prevents another paid request and keeps both the stored source and unsent input", async ({ page }) => {
  const requests = await initialMocks(page);
  await page.goto("/ask/"); await ready(page);
  await requestInitial(page, "Already saved synthetic source.");
  const previous = await raw(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, storageKey: string, value: string) {
      if (storageKey === key) throw new DOMException("Synthetic quota failure", "QuotaExceededError");
      return original.call(this, storageKey, value);
    };
  }, KEY);
  await page.locator("#input").fill("Unsent source after storage failure.");
  await expect(page.locator(".ask-storage-fact")).toContainText("저장 실패");
  await page.getByRole("button", { name: "해설 보기", exact: true }).click();
  await expect(page.locator("#result")).toContainText("기록을 저장하지 못해 해설 요청을 보내지 않았습니다.");
  await expect(page.locator("#input")).toHaveValue("Unsent source after storage failure.");
  expect(await raw(page)).toBe(previous);
  expect(requests).toHaveLength(1);
  await expect(archive(page).locator("li")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "기록 내려받기", exact: true })).toBeEnabled();
});

test("corrupt storage is preserved, new transmission is blocked, and the original can be downloaded verbatim", async ({ page }) => {
  const corrupt = '{"schema":1,"entries":[broken-synthetic-source';
  await page.addInitScript(({ key, corrupt }) => localStorage.setItem(key, corrupt), { key: KEY, corrupt });
  const requests = await initialMocks(page);
  await page.goto("/ask/"); await ready(page);
  await expect(page.locator(".ask-store-warning")).toContainText("원문을 그대로 보존");
  await page.locator("#input").fill("This must never be sent.");
  await expect(page.getByRole("button", { name: "해설 보기", exact: true })).toBeDisabled();
  await page.locator("#input").press("Control+Enter");
  expect(await raw(page)).toBe(corrupt);
  expect(requests).toEqual([]);
  const receiving = page.waitForEvent("download");
  await page.getByRole("button", { name: "원본 기록 내려받기", exact: true }).click();
  const download = await receiving;
  expect(download.suggestedFilename()).toMatch(/^english-sense-ask-original-\d{4}-\d{2}-\d{2}\.json$/);
  expect(await downloadedText(download)).toBe(corrupt);
  expect(await raw(page)).toBe(corrupt);
});

test("a real JSON download contains the generated request, complete explanation, conversation and unsent draft", async ({ page }) => {
  await initialMocks(page);
  await page.route("**/api/ask-followup/**", route => {
    const body = route.request().postDataJSON() as AskFollowupRequest;
    return route.fulfill({ json: { recordId: body.recordId, requestId: body.requestId, reply: "내려받을 검증용 모의 답변" } });
  });
  await page.goto("/ask/"); await ready(page);
  await requestInitial(page, "Synthetic download source.");
  await sendQuestion(page, "내려받을 검증용 질문 원문", "내려받을 검증용 모의 답변");
  await question(page).fill("파일에 남겨 둘 미전송 초안");
  const before = await saved(page), receiving = page.waitForEvent("download");
  await page.getByRole("button", { name: "기록 내려받기", exact: true }).click();
  const download = await receiving;
  expect(download.suggestedFilename()).toMatch(/^english-sense-ask-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(await downloadedText(download)) as AskRecords;
  expect(file).toEqual(before);
  expect(file.entries[0]).toMatchObject({ text: "Synthetic download source.", result: explanation("Synthetic download source."), followupDraft: "파일에 남겨 둘 미전송 초안", turns: [{ message: "내려받을 검증용 질문 원문", reply: "내려받을 검증용 모의 답변", status: "succeeded" }] });
  await expect(page.locator(".ask-storage-fact")).toContainText("서버 보관·기기 간 동기화 없음");
});

test("record selection, long conversations and the followup form remain usable at four viewport widths", async ({ page }) => {
  test.setTimeout(90_000);
  await initialMocks(page);
  const longReply = "SyntheticLongAnswer".repeat(270);
  let calls = 0;
  await page.route("**/api/ask-followup/**", route => {
    const body = route.request().postDataJSON() as AskFollowupRequest;
    calls++;
    return route.fulfill({ json: { recordId: body.recordId, requestId: body.requestId, reply: longReply } });
  });
  await page.goto("/ask/"); await ready(page);
  const first = "Layout synthetic record A.", second = "배치를 확인하는 검증용 기록 B";
  await requestInitial(page, first);
  await sendQuestion(page, "긴 질문의 줄바꿈을 확인합니다. ".repeat(35), longReply);
  await requestInitial(page, second, "translate");
  for (const width of [320, 390, 1100, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await pick(page, first).click();
    await expect(page.locator(".ask-assistant-turn")).toContainText(longReply);
    await question(page).fill(`${width}px에서 작성한 미전송 질문 초안`);
    const submit = followupButton(page);
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeEnabled();
    expect(await submit.evaluate(element => { const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return box.width > 0 && box.height >= 44 && !!hit && element.contains(hit); }), `${width}px form`).toBe(true);
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1), `${width}px overflow`).toBe(true);
    await pick(page, second).click();
    await expect(page.locator("#result .en-big")).toHaveText(explanation(second).english);
    await expect(page.locator(".ask-conversation")).toHaveCount(0);
  }
  expect(calls).toBe(1);
});

test("an edited pending draft survives its reply, and a followup response for the wrong record is rejected", async ({ page }) => {
  await initialMocks(page);
  const bodies: AskFollowupRequest[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const rejectedReply = "다른 기록의 답이라 채택하면 안 되는 모의 응답";
  await page.route("**/api/ask-followup/**", async route => {
    const body = route.request().postDataJSON() as AskFollowupRequest;
    bodies.push(body);
    const first = bodies.length === 1;
    if (first) await gate;
    await route.fulfill({ json: { recordId: first ? body.recordId : "wrong-record-id", requestId: body.requestId, reply: first ? "공백 수정 중 받은 모의 답변" : rejectedReply } });
  });
  try {
    await page.goto("/ask/"); await ready(page);
    await requestInitial(page, "Synthetic pending-draft source.");
    const sent = "대기 중에 공백만 바꿀 질문", edited = `  ${sent} \n`;
    await question(page).fill(sent);
    await followupButton(page).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].message).toBe(sent);
    await question(page).fill(edited);
    release();
    await expect(page.locator(".ask-assistant-turn")).toContainText("공백 수정 중 받은 모의 답변");
    await expect(question(page)).toHaveValue(edited);
    const succeeded = (await saved(page)).entries[0];
    expect(succeeded.followupDraft).toBe(edited);
    expect(succeeded.turns[0]).toMatchObject({ message: sent, status: "succeeded", reply: "공백 수정 중 받은 모의 답변" });
    await question(page).fill("응답의 기록 ID를 대조하는 두 번째 질문");
    await followupButton(page).click();
    await expect(page.locator(".ask-turn-state")).toContainText("요청한 해설과 맞는 응답을 읽지 못했습니다");
    const final = (await saved(page)).entries[0];
    expect(final.turns[0]).toEqual(succeeded.turns[0]);
    expect(final.turns[1]).toMatchObject({ message: "응답의 기록 ID를 대조하는 두 번째 질문", status: "failed" });
    expect(Object.hasOwn(final.turns[1], "reply")).toBe(false);
    await expect(page.locator(".ask-assistant-turn")).toHaveCount(1);
    await expect(page.locator(".ask-followups")).not.toContainText(rejectedReply);
    await expect(question(page)).toHaveValue("응답의 기록 ID를 대조하는 두 번째 질문");
    expect(bodies).toHaveLength(2);
  } finally { release(); }
});

test("a second tab's saved change blocks stale transmissions and writes in the first tab without overwriting the newer source", async ({ page, context }) => {
  const apiRequests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url()); });
  await initialMocks(page);
  await page.goto("/ask/"); await ready(page);
  await requestInitial(page, "Synthetic two-tab source.");
  const other = await context.newPage();
  await other.route("**/api/**", route => route.abort("blockedbyclient"));
  try {
    await other.goto("/ask/"); await ready(other);
    await expect(other.locator("#result .en-big")).toHaveText(explanation("Synthetic two-tab source.").english);
    await question(other).fill("탭 B가 새로 저장한 질문 초안");
    const newerRaw = await raw(other);
    expect(JSON.parse(newerRaw!).entries[0].followupDraft).toBe("탭 B가 새로 저장한 질문 초안");
    await expect(page.locator(".ask-store-warning")).toContainText("다른 탭에서 기록이 바뀌었습니다");
    await page.locator("#input").fill("Stale first-tab input must not be transmitted.");
    await expect(page.getByRole("button", { name: "해설 보기", exact: true })).toBeDisabled();
    await page.locator("#input").press("Control+Enter");
    await question(page).fill("탭 A의 오래된 사본에서 쓴 미전송 초안");
    await expect(followupButton(page)).toBeDisabled();
    await question(page).press("Control+Enter");
    expect(await raw(page)).toBe(newerRaw);
    expect(await raw(other)).toBe(newerRaw);
    expect(apiRequests).toHaveLength(1);
    await expect(question(other)).toHaveValue("탭 B가 새로 저장한 질문 초안");
    await expect(other.locator(".ask-store-warning")).toHaveCount(0);
  } finally { await other.close(); }
});

test("pagehide makes an interrupted followup resumable in the same page instance", async ({ page }) => {
  await initialMocks(page);
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/ask-followup/**", async route => {
    calls++;
    await gate;
    await route.abort().catch(() => {});
  });
  try {
    await page.goto("/ask/"); await ready(page);
    await requestInitial(page, "Synthetic interrupted followup source.");
    await question(page).fill("남아 있어야 하는 질문 초안");
    await followupButton(page).click();
    await expect.poll(() => calls).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await expect.poll(async () => (await saved(page)).entries[0].turns[0].status).toBe("unknown");
    await expect(page.getByRole("button", { name: "이 질문 다시 보내기", exact: true })).toBeEnabled();
    await expect(question(page)).toHaveValue("남아 있어야 하는 질문 초안");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.locator(".ask-turn-state")).toContainText("자동으로 다시 보내지 않았습니다");
    expect(calls).toBe(1);
  } finally { release(); }
});
