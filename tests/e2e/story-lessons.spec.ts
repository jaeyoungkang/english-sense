import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import readingJson from "../../content/reading.json";
import type { ReadingData } from "../../lib/study-content-types";

const reading = readingJson as ReadingData;
const story = reading.stories.find(item => item.id === "green-umbrella")!;
const key = (id: string) => `english-sense-lesson-v4:${id}`;
const bodyText = (item: typeof story) => item.paragraphs[0].map(piece => piece.text).join("");
const letter = (index: number) => String.fromCharCode(65 + index);
const reply = (body: Record<string, unknown>, text: string) => ({ requestId: body.requestId, lessonId: body.lessonId, artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply: text, mode: "ai" });
type ChatBody = { lessonId: string; questionId: string; artifactId: string; contentVersion: string; requestId: string; initialAttempt: { kind: string; choice: number } | null; revisions: unknown[]; messages: unknown[]; message: string };

async function open(page: Page, id = story.id) {
  await page.goto(`/reading/${id}/`);
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
}
async function startReading(page: Page) {
  await page.getByRole("button", { name: "읽기 시작" }).click();
  await expect(page.locator(".lw-story-body")).toBeVisible();
}
async function endReading(page: Page) {
  await page.getByRole("button", { name: "다 읽었습니다", exact: true }).click();
  await expect(page.locator(".lw-story-body")).toHaveCount(0);
}
async function readAndEnd(page: Page, id = story.id) {
  await open(page, id);
  await startReading(page);
  await endReading(page);
}
async function pick(page: Page, questionId: string) {
  await page.getByLabel("풀 문제", { exact: true }).selectOption(questionId);
}
/** Selects the question, picks `choice` and leaves the first answer. Waits for the judgement. */
async function answer(page: Page, item: typeof story, number: number, choice: number) {
  await pick(page, item.questions[number - 1].id);
  const form = page.getByRole("form", { name: `문제 ${number} 첫 답`, exact: true });
  await form.getByRole("radio").nth(choice).check();
  await form.getByRole("button", { name: /첫 답 남기기/ }).click();
  await expect(judgement(page, number)).toBeVisible();
}
const judgement = (page: Page, number: number) => page.getByRole("group", { name: `문제 ${number} 서버 판정`, exact: true });
const record = (page: Page, id = story.id) => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) || "null"), key(id));
type Rec = { events: { kind: string; by?: string; startedAt?: number; endedAt?: number; limitSeconds?: number; artifactId?: string }[]; artifacts: { artifactId: string; question: { questionId: string }; attempts: { attempt: { choice: number }; check: unknown }[] }[] };

/** Scrolls the element to the middle of the screen and checks that its centre is the element itself, not a fixed bar or another pane. */
async function hit(page: Page, locator: Locator, name: string) {
  await locator.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
  const result = await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1), y = Math.min(Math.max((box.top + box.bottom) / 2, 0), window.innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    return { visible: box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight, reached: !!top && (element === top || element.contains(top) || top.contains(element)), top: top ? top.tagName + "." + top.className : "none" };
  });
  expect(result.visible, `${name} is on screen`).toBe(true);
  expect(result.reached, `${name} is not covered (found ${result.top})`).toBe(true);
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("a story is a workspace of eight document sections, hides the body before the start and closes its questions and input", async ({ page }) => {
  await open(page);
  await expect(page.locator(".lw-document-toc nav li")).toHaveCount(8);
  await expect(page.locator("[data-outline-id]")).toHaveCount(8);
  await expect(page.locator(".lw-document-toc nav li").nth(1)).toContainText("내용");
  await expect(page.getByText(bodyText(story))).toHaveCount(0);
  await expect(page.locator(".lw-reading-gate")).toContainText(`제한 시간 3:00 · ${story.words}낱말 · 문제 ${story.questions.length}개`);
  await expect(page.locator(".lw-toolbar .draft-tag")).toHaveText("초안");
  await expect(page.locator(".lw-story-question .lw-locked-note")).toHaveCount(7);
  await expect(page.locator(".lw-question-options")).toHaveCount(0);
  await expect(page.locator("#lw-message")).toHaveCount(0);
  await expect(page.getByRole("form")).toHaveCount(0);
  await expect(page.getByRole("timer")).toHaveCount(0);
  // Opening and reading the whole document makes no event, answer or request.
  const opened = await record(page) as Rec | null;
  expect(opened === null || (opened.events.length === 0 && opened.artifacts.length === 0)).toBe(true);
});

test("reading shows the body and the remaining time in the toolbar, then ends once by the learner and hides the body", async ({ page }) => {
  const calls: string[] = [];
  await page.route("**/api/**", async route => { calls.push(route.request().url()); await route.continue(); });
  await open(page);
  const before = await page.evaluate(() => window.scrollY);
  await startReading(page);
  await expect(page.getByText(bodyText(story))).toBeVisible();
  const timer = page.locator(".lw-toolbar").getByRole("timer");
  await expect(timer).toContainText(/남은 시간 (3:00|2:5\d)/);
  await expect(timer).toHaveAttribute("aria-live", "off");
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  // The questions and the conversation stay closed while reading.
  await expect(page.locator(".lw-story-question .lw-locked-note")).toHaveCount(7);
  await expect(page.locator("#lw-message")).toHaveCount(0);
  await expect(page.locator(".lw-chat-pane")).toContainText("읽는 중에는 대화 입력을 닫아 둡니다");
  await endReading(page);
  await expect(page.locator(".lw-body-hidden")).toContainText(/본문을 가렸습니다 · 읽은 시간 0:0\d/);
  await expect(page.getByRole("timer")).toHaveCount(0);
  await expect(page.locator(".lw-question-options")).toHaveCount(7);
  await expect(page.locator(".lw-locked-note")).toHaveCount(0);
  await expect(page.getByRole("form", { name: "문제 1 첫 답" })).toBeVisible();
  const saved = await record(page) as Rec;
  expect(saved.events.map(event => event.kind)).toEqual(["reading-start", "reading-end"]);
  expect(saved.events[1].by).toBe("user");
  expect(saved.artifacts).toEqual([]);
  expect(calls).toEqual([]);
});

test("a reload while reading keeps the remaining time and starts nothing new", async ({ page }) => {
  await open(page);
  await startReading(page);
  const first = await record(page) as Rec;
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator(".lw-story-body")).toBeVisible();
  const text = await page.locator(".lw-toolbar").getByRole("timer").innerText();
  const [, minutes, seconds] = /(\d+):(\d\d)/.exec(text)!;
  const remaining = Number(minutes) * 60 + Number(seconds);
  expect(remaining).toBeLessThanOrEqual(179);
  expect(remaining).toBeGreaterThan(140);
  expect((await record(page) as Rec).events).toEqual(first.events);
});

test("a deadline passed by the browser clock ends the reading by time exactly once", async ({ page }) => {
  await page.clock.install();
  await open(page);
  await startReading(page);
  await page.clock.fastForward((story.limitSeconds + 2) * 1000);
  await expect(page.locator(".lw-story-body")).toHaveCount(0);
  await expect(page.locator(".lw-body-hidden")).toContainText("시간 마감");
  await expect(page.locator(".lw-chat-pane")).toContainText("읽기를 마쳤습니다 · 읽은 시간 3:00 · 시간 마감");
  await page.clock.fastForward(60 * 1000);
  const saved = await record(page) as Rec;
  expect(saved.events.map(event => event.kind)).toEqual(["reading-start", "reading-end"]);
  expect(saved.events[1]).toMatchObject({ by: "time", endedAt: saved.events[0].startedAt! + story.limitSeconds * 1000 });
  await expect(page.locator(".lw-chat-pane .lw-reading-marker")).toHaveCount(2);
});

test("the timer is silent for screen readers except at one minute, thirty seconds and the end", async ({ page }) => {
  await page.clock.install();
  await open(page);
  await startReading(page);
  const live = page.locator(".lw-toolbar [role=status]");
  const timer = page.locator(".lw-toolbar").getByRole("timer");
  await expect(timer).toHaveAttribute("aria-live", "off");
  await page.clock.fastForward(30 * 1000);
  await expect(timer).toContainText("2:");
  await expect(live).toHaveText("");
  await page.clock.fastForward((story.limitSeconds - 30 - 55) * 1000);
  await expect(live).toHaveText("남은 시간이 1분 이하입니다.");
  await page.clock.fastForward(30 * 1000);
  await expect(live).toHaveText("남은 시간이 30초 이하입니다.");
  await page.clock.fastForward(40 * 1000);
  await expect(live).toHaveText("읽기가 끝났습니다. 본문을 가렸고 문제가 열렸습니다.");
  await expect(page.locator(".lw-story-body")).toHaveCount(0);
});

test("restoring after the deadline ends the reading by time at the deadline without a new start", async ({ page }) => {
  await open(page);
  await startReading(page);
  await page.evaluate(storageKey => {
    const saved = JSON.parse(localStorage.getItem(storageKey)!);
    saved.events[0].startedAt -= (saved.events[0].limitSeconds + 120) * 1000;
    localStorage.setItem(storageKey, JSON.stringify(saved));
  }, key(story.id));
  await page.reload();
  await expect(page.locator(".lw-body-hidden")).toContainText("시간 마감");
  await expect(page.locator(".lw-story-body")).toHaveCount(0);
  await expect(page.getByRole("form", { name: "문제 1 첫 답" })).toBeVisible();
  const saved = await record(page) as Rec;
  expect(saved.events.map(event => event.kind)).toEqual(["reading-start", "reading-end"]);
  expect(saved.events[1]).toMatchObject({ by: "time", endedAt: saved.events[0].startedAt! + story.limitSeconds * 1000 });
  await page.reload();
  expect((await record(page) as Rec).events).toEqual(saved.events);
});

test("the server judges a first answer, shows the canonical answer only then, and never calls the AI", async ({ page }) => {
  const chat: ChatBody[] = [];
  await page.route("**/api/learn-chat/**", async route => { chat.push(route.request().postDataJSON()); await route.fulfill({ status: 500, json: {} }); });
  await readAndEnd(page);
  const first = story.questions[0], wrong = (first.answer + 1) % first.options.length;
  await expect(page.getByText(first.explain)).toHaveCount(0);
  await expect(page.locator(".lw-option-tag")).toHaveCount(0);
  await answer(page, story, 1, wrong);
  const judged = judgement(page, 1);
  await expect(judged).toContainText("정본 답과 다릅니다.");
  await expect(judged).toContainText("AI 아님");
  await expect(judged).toContainText(`정본 답: ${letter(first.answer)}. ${first.options[first.answer]}`);
  await expect(judged).toContainText(first.explain);
  await expect(page.locator(".lw-judgement")).not.toContainText("정답입니다");
  await expect(page.locator(".lw-user-performance .lw-first-answer")).toContainText(first.options[wrong]);
  const options = page.locator(`.lw-story-question[data-question-id="${first.id}"] .lw-question-options li`);
  await expect(options.nth(wrong)).toContainText("내 첫 답");
  await expect(options.nth(first.answer)).toContainText("정본 답");
  await expect(page.locator(".lw-option-tag")).toHaveCount(2);
  await answer(page, story, 2, story.questions[1].answer);
  await expect(judgement(page, 2)).toContainText("정본 답과 같습니다.");
  expect(chat).toEqual([]);
  const saved = await record(page) as Rec;
  expect(saved.events.map(event => event.kind)).toEqual(["reading-start", "reading-end", "initial", "check", "initial", "check"]);
  // The first answer and its judgement survive a reload unchanged.
  await page.reload();
  await expect(judgement(page, 1)).toContainText(first.explain);
  await expect(judgement(page, 2)).toContainText("정본 답과 같습니다.");
  expect(await record(page)).toEqual(saved);
  expect(chat).toEqual([]);
});

test("a failed judgement keeps the first answer, offers to judge again and recovers to the same result", async ({ page }) => {
  let checks = 0;
  await page.route("**/api/lesson-check/**", async route => { checks += 1; await route.abort("failed"); });
  await readAndEnd(page);
  const first = story.questions[0];
  await pick(page, first.id);
  const form = page.getByRole("form", { name: "문제 1 첫 답", exact: true });
  await form.getByRole("radio").nth(2).check();
  await form.getByRole("button", { name: /첫 답 남기기/ }).click();
  const status = page.locator(".lw-judgement-failed");
  await expect(status).toContainText("판정을 받지 못했습니다. 답은 남아 있습니다.");
  await expect(page.locator(".lw-user-performance .lw-first-answer")).toContainText(first.options[2]);
  await expect(page.getByText(first.explain)).toHaveCount(0);
  const failed = await record(page) as Rec;
  expect(failed.artifacts[0].attempts[0]).toMatchObject({ attempt: { choice: 2 }, check: null });
  expect(checks).toBe(1);
  // A reload makes no request: the judgement stays failed with its button.
  await page.reload();
  await expect(page.locator(".lw-judgement-failed")).toContainText("판정을 받지 못했습니다. 답은 남아 있습니다.");
  expect(checks).toBe(1);
  await page.unroute("**/api/lesson-check/**");
  await page.getByRole("button", { name: "다시 판정", exact: true }).click();
  await expect(judgement(page, 1)).toContainText(first.explain);
  const recovered = await record(page) as Rec;
  expect(recovered.artifacts[0].attempts[0].attempt).toEqual(failed.artifacts[0].attempts[0].attempt);
  // Judging again yields the same result.
  await page.evaluate(storageKey => { const saved = JSON.parse(localStorage.getItem(storageKey)!); saved.artifacts[0].attempts[0].check = null; saved.events = saved.events.filter((event: { kind: string }) => event.kind !== "check"); localStorage.setItem(storageKey, JSON.stringify(saved)); }, key(story.id));
  await page.reload();
  await page.getByRole("button", { name: "다시 판정", exact: true }).click();
  await expect(judgement(page, 1)).toContainText(first.explain);
  const again = (await record(page) as Rec).artifacts[0].attempts[0].check as Record<string, unknown>, firstCheck = recovered.artifacts[0].attempts[0].check as Record<string, unknown>;
  const { requestId: _a, ...sameAgain } = again, { requestId: _b, ...sameFirst } = firstCheck;
  expect(sameAgain).toEqual(sameFirst);
});

test("questions open in any order and selecting or reading creates no event or request", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/**", async route => { requests.push(route.request().url()); await route.continue(); });
  await readAndEnd(page);
  const outline = await page.locator(".lw-document-toc nav li").allInnerTexts();
  const before = await record(page) as Rec;
  await pick(page, story.questions[6].id);
  await pick(page, story.questions[1].id);
  await page.locator(`.lw-story-question[data-question-id="${story.questions[3].id}"]`).getByRole("button", { name: "이 문제로 풀기" }).click();
  await expect(page.getByLabel("풀 문제", { exact: true })).toHaveValue(story.questions[3].id);
  expect((await record(page) as Rec).events).toEqual(before.events);
  expect(requests).toEqual([]);
  await answer(page, story, 7, story.questions[6].answer);
  await answer(page, story, 2, story.questions[1].answer);
  const saved = await record(page) as Rec;
  const answered = saved.events.filter(event => event.kind === "initial").map(event => saved.artifacts.find(item => item.artifactId === event.artifactId)!.question.questionId);
  expect(answered).toEqual([story.questions[6].id, story.questions[1].id]);
  expect(await page.locator(".lw-document-toc nav li").allInnerTexts()).toEqual(outline);
  const order = await page.locator("[data-question-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-question-id")));
  expect(order).toEqual(story.questions.map(item => item.id));
});

test("the body can be checked only after every question has a first answer, and checking changes nothing in the record", async ({ page }) => {
  await readAndEnd(page);
  const check = page.getByRole("button", { name: "본문 확인하기", exact: true });
  for (const [index, item] of story.questions.slice(0, 6).entries()) await answer(page, story, index + 1, item.answer);
  await expect(check).toBeDisabled();
  await expect(page.locator("#lw-peek-note")).toContainText("모든 문제에 첫 답을 남기면");
  await expect(page.getByText(bodyText(story))).toHaveCount(0);
  await expect(page.locator(".lw-document-toc")).toContainText("첫 답을 남긴 문제 6개");
  await answer(page, story, 7, story.questions[6].answer);
  await expect(check).toBeEnabled();
  const before = await page.evaluate(storageKey => localStorage.getItem(storageKey), key(story.id));
  await check.click();
  await expect(page.getByText(bodyText(story))).toBeVisible();
  await expect(page.getByRole("button", { name: "본문 가리기", exact: true })).toBeVisible();
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key(story.id))).toBe(before);
  await page.getByRole("button", { name: "본문 가리기", exact: true }).click();
  await expect(page.getByText(bodyText(story))).toHaveCount(0);
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key(story.id))).toBe(before);
});

test("the AI is called only from the explain button or a question, with the mock answering the original question", async ({ page }) => {
  const chat: ChatBody[] = [];
  let release: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ChatBody;
    chat.push(body);
    if (body.message === "검사용 지연 질문") await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: reply(body, `검사용 모의 응답 ${chat.length}`) });
  });
  await readAndEnd(page);
  await answer(page, story, 1, 0);
  expect(chat).toEqual([]);
  await page.getByRole("button", { name: "AI에게 설명 요청", exact: true }).click();
  await expect(page.getByText("검사용 모의 응답 1", { exact: true })).toBeVisible();
  expect(chat).toHaveLength(1);
  expect(chat[0]).toMatchObject({ lessonId: story.id, questionId: story.questions[0].id, initialAttempt: { kind: "choose", choice: 0 }, revisions: [], messages: [] });
  expect(chat[0].message).toContain("처음 제출한 답과 이유를 장면에 비추어 설명해 주세요");
  await expect(page.getByRole("button", { name: "AI에게 설명 요청", exact: true })).toHaveCount(0);
  await expect(page.locator(".lw-judgement")).not.toContainText("검사용 모의 응답");
  // A late reply belongs to the question that was asked, even after another question is chosen.
  const firstId = chat[0].artifactId;
  await page.getByLabel("이 문제에 대해 질문하기").fill("검사용 지연 질문");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect.poll(() => chat.length).toBe(2);
  await pick(page, story.questions[1].id);
  await expect(page.getByLabel("풀 문제", { exact: true })).toHaveValue(story.questions[1].id);
  const top = await page.evaluate(() => window.scrollY);
  release!();
  await expect(page.locator(`.lw-timeline-event[data-event-kind="reply"][data-artifact-id="${firstId}"]`)).toHaveCount(2);
  await expect(page.locator(`.lw-timeline-event[data-event-kind="reply"]:not([data-artifact-id="${firstId}"])`)).toHaveCount(0);
  await expect(page.getByLabel("풀 문제", { exact: true })).toHaveValue(story.questions[1].id);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - top)).toBeLessThanOrEqual(2);
  expect(chat).toHaveLength(2);
  expect(chat[1]).toMatchObject({ questionId: story.questions[0].id, artifactId: firstId, initialAttempt: { kind: "choose", choice: 0 } });
});

test("a question before the first answer gets the free preparation guidance from the server", async ({ page }) => {
  await readAndEnd(page);
  await page.getByRole("button", { name: "답하기 전에 질문하기", exact: true }).click();
  await page.getByLabel("이 문제에 대해 질문하기").fill("검사용 준비 질문");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await expect(page.getByText("준비 안내 · AI 호출 없음")).toBeVisible();
  await expect(page.locator(".lw-assistant-message")).toContainText("이야기를 읽은 뒤 문제의 보기를 골라 답해 주세요");
  const first = story.questions[0];
  await expect(page.getByText(first.explain)).toHaveCount(0);
  await expect(page.locator(".lw-assistant-message")).not.toContainText(first.options[first.answer]);
});

test("two stories keep their own records across reloads", async ({ page }) => {
  const other = reading.stories.find(item => item.id === "bus-dog")!;
  await readAndEnd(page);
  await answer(page, story, 1, 1);
  await readAndEnd(page, other.id);
  await expect(page.locator(".lw-document-toc")).not.toContainText("첫 답을 남긴 문제");
  await answer(page, other, 3, 2);
  await page.reload();
  await expect(judgement(page, 3)).toBeVisible();
  await expect(judgement(page, 1)).toHaveCount(0);
  await open(page);
  await expect(judgement(page, 1)).toBeVisible();
  await expect(judgement(page, 3)).toHaveCount(0);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(item => item.startsWith("english-sense-lesson-v4:")).sort());
  expect(keys).toEqual([key("bus-dog"), key("green-umbrella")]);
  // Breaking one lesson's record does not block the other.
  await page.evaluate(storageKey => localStorage.setItem(storageKey, "{broken"), key(other.id));
  await open(page);
  await expect(judgement(page, 1)).toBeVisible();
  await open(page, other.id);
  await expect(page.locator(".lw-session-status")).toContainText("임시 저장 실패");
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key(other.id))).toBe("{broken");
});

test("a record of an older content version is read only and can be replaced only after one confirmation", async ({ page }) => {
  await readAndEnd(page, "bus-dog");
  await readAndEnd(page);
  await answer(page, story, 1, 1);
  const raw = (await page.evaluate(storageKey => localStorage.getItem(storageKey), key(story.id)))!;
  const version = (JSON.parse(raw) as { artifacts: { contentVersion: string }[] }).artifacts[0].contentVersion;
  const fake = "0".repeat(64);
  const otherRaw = await page.evaluate(storageKey => localStorage.getItem(storageKey), key("bus-dog"));
  await page.evaluate(([storageKey, text]) => localStorage.setItem(storageKey, text), [key(story.id), raw.replaceAll(version, fake)]);
  await page.reload();
  await expect(page.locator(".lw-old-version")).toContainText("자료 판이 바뀌었습니다");
  await expect(page.locator(".lw-version-warning")).toBeVisible();
  await expect(page.getByRole("button", { name: "AI에게 설명 요청" })).toHaveCount(0);
  await expect(page.locator("#lw-message")).toHaveCount(0);
  await expect(page.locator(".lw-user-performance .lw-first-answer")).toContainText(story.questions[0].options[1]);
  await expect(judgement(page, 1)).toContainText(story.questions[0].explain);
  // Cancelling the confirmation keeps the record.
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "이 기록을 지우고 새 판으로 시작" }).click();
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key(story.id))).toBe(raw.replaceAll(version, fake));
  let message = "";
  page.once("dialog", dialog => { message = dialog.message(); void dialog.accept(); });
  await page.getByRole("button", { name: "이 기록을 지우고 새 판으로 시작" }).click();
  expect(message).toContain("되돌릴 수 없습니다");
  await expect(page.locator(".lw-old-version")).toHaveCount(0);
  await expect(page.locator(".lw-reading-gate")).toBeVisible();
  const fresh = await record(page) as Rec;
  expect(fresh.artifacts).toEqual([]);
  expect(fresh.events).toEqual([]);
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key("bus-dog"))).toBe(otherRaw);
});

test("a paired story links its unit and its expression question links its card after the first answer", async ({ page }) => {
  const paired = reading.stories.find(item => item.id === "prep-wonder-3")!;
  await open(page, paired.id);
  await expect(page.locator(".pair-note")).toContainText("Wonder 유닛 3 표현으로 쓴 이야기");
  await expect(page.locator(".pair-note a")).toHaveAttribute("href", "/prep/wonder/unit-3/");
  await expect(page.locator(".lw-toolbar .draft-tag")).toHaveText("초안");
  await expect(page.getByRole("link", { name: "수업 목록" })).toHaveAttribute("href", "/reading/");
  await startReading(page);
  await endReading(page);
  const index = paired.questions.findIndex(item => item.kind === "expression");
  expect(index).toBeGreaterThan(0);
  await expect(page.locator(`.lw-story-question[data-question-id="${paired.questions[0].id}"] .lw-artifact-header`)).toContainText("내용");
  await expect(page.locator(`.lw-story-question[data-question-id="${paired.questions[index].id}"] .lw-artifact-header`)).toContainText("표현");
  await answer(page, paired, 1, paired.questions[0].answer);
  await expect(page.locator(".lw-judgement-card")).toHaveCount(0);
  await answer(page, paired, index + 1, paired.questions[index].answer);
  const link = page.locator(".lw-judgement-card a");
  await expect(link).toHaveAttribute("href", `/prep/wonder/unit-3/#${paired.questions[index].card}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/prep/wonder/unit-3/#${paired.questions[index].card}$`));
  await expect(page.locator(`article#${paired.questions[index].card}`)).toBeInViewport();
});

test("no completion, mastery or progress wording appears, only facts about first answers", async ({ page }) => {
  await readAndEnd(page);
  await answer(page, story, 1, 0);
  await answer(page, story, 2, 1);
  // The outline is closed on narrow screens, so read its text content rather than its rendered text.
  expect(await page.locator(".lw-document-toc").textContent()).toContain("첫 답을 남긴 문제 2개");
  const text = (await page.locator("body").innerText()) + (await page.locator(".lw-document-toc").textContent());
  expect(text).not.toMatch(/숙달|완료|진행률|정답률|점수|달성|성공|\d+\s*\/\s*\d+\s*(답함|완료|문제)|%/);
});

for (const [width, height] of [[1440, 900], [1100, 800], [390, 844], [320, 640]]) {
  test(`at ${width}px the body, outline, input and timer are reachable, nothing covers them and nothing overflows`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    expect(await noOverflow(page)).toBe(true);
    await hit(page, page.getByRole("button", { name: "읽기 시작" }), "start button");
    await hit(page, page.getByRole("button", { name: /^목차/ }), "outline toggle");
    await startReading(page);
    expect(await noOverflow(page)).toBe(true);
    await hit(page, page.locator(".lw-toolbar").getByRole("timer"), "timer");
    await hit(page, page.locator(".lw-toolbar").getByRole("button", { name: "다 읽었습니다", exact: true }), "finish button");
    await hit(page, page.locator(".lw-story-body p").first(), "first paragraph");
    await hit(page, page.locator(".lw-story-body p").last(), "last paragraph");
    await hit(page, page.getByRole("button", { name: "다 읽었으니 본문을 가립니다" }), "finish button under the body");
    await page.locator(".lw-toolbar").getByRole("button", { name: "다 읽었습니다", exact: true }).click();
    await expect(page.locator(".lw-body-hidden")).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await pick(page, story.questions[0].id);
    await hit(page, page.getByLabel("풀 문제", { exact: true }), "target selector");
    const form = page.getByRole("form", { name: "문제 1 첫 답", exact: true });
    for (let index = 0; index < 4; index += 1) await hit(page, form.getByRole("radio").nth(index), `option ${index}`);
    await form.getByRole("radio").nth(1).check();
    await hit(page, form.getByRole("button", { name: /첫 답 남기기/ }), "submit");
    await form.getByRole("button", { name: /첫 답 남기기/ }).click();
    await expect(judgement(page, 1)).toBeVisible();
    await hit(page, judgement(page, 1), "judgement");
    await hit(page, page.getByLabel("이 문제에 대해 질문하기"), "question box");
    await hit(page, page.getByRole("button", { name: "AI에게 설명 요청", exact: true }), "explain button");
    expect(await noOverflow(page)).toBe(true);
    // Every outline link reaches its section and none stays under the toolbar.
    const toggle = page.getByRole("button", { name: /^목차/ });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const items = page.locator(".lw-document-toc nav a");
    await expect(items).toHaveCount(8);
    await items.nth(4).click();
    const section = page.locator(`[data-outline-id="question-${story.questions[3].id}"]`);
    await expect(section).toBeInViewport();
    await hit(page, section.locator("h2").first(), "section heading after the outline jump");
    expect(await noOverflow(page)).toBe(true);
  });
}

// Scan the built output and the served pages for the canonical explanations and bases of all 15 stories.
// A secret is its longest quote-free chunk that the story's own public text does not contain; the two generic bases
// ("감각 사전 go"/"감각 사전 out") are matched whole, and prep pages (which still carry card bases until stage 7) are out of scope.
const chunks = (value: string) => value.split(/["'\\<>&\n`$]/).map(item => item.trim()).sort((a, b) => b.length - a.length);
function secretsOf(item: typeof story) {
  const publicText = [item.title, ...item.paragraphs.flat().map(piece => piece.text), ...item.questions.flatMap(question => [question.question, ...question.options])].join("\n");
  return item.questions.flatMap(question => [question.explain, ...(question.basis ? [question.basis] : [])]).map(value => chunks(value).find(chunk => chunk.length >= 10 && !publicText.includes(chunk)) ?? value);
}
function walk(dir: string, accept: (path: string) => boolean, found: string[] = []) {
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name), info = statSync(path);
    if (info.isDirectory()) walk(path, accept, found);
    else if (accept(path)) found.push(path);
  }
  return found;
}

test("no story answer explanation or basis is in a served page, its RSC payload, its client scripts or the prerendered output", async ({ request }) => {
  const all = reading.stories.flatMap(item => secretsOf(item));
  expect(all).toHaveLength(105 + 4);
  expect(all.every(item => [...item].length >= 6)).toBe(true);
  const probes = reading.stories.map(item => item.questions[0].question.split(/["'\\<>&\n`$]/).sort((a, b) => b.length - a.length)[0].trim());
  const leaks: string[] = [];
  const scan = (label: string, text: string, secrets: string[]) => { for (const secret of secrets) if (text.includes(secret)) leaks.push(`${label}: ${secret}`); };
  const scripts = new Set<string>();
  for (const [index, item] of reading.stories.entries()) {
    const secrets = secretsOf(item);
    const html = await (await request.get(`/reading/${item.id}/`)).text();
    scan(`html ${item.id}`, html, all);
    // The public projection is in the page, so the scan sees what it should.
    expect(html, `${item.id} html carries the public question`).toContain(probes[index]);
    for (const match of html.matchAll(/\/_next\/static\/[^"' )]+\.js/g)) scripts.add(match[0]);
    scan(`rsc ${item.id}`, await (await request.get(`/reading/${item.id}/`, { headers: { RSC: "1" } })).text(), all);
    expect(secrets.length).toBe(item.questions.length + item.questions.filter(question => question.basis).length);
  }
  expect(scripts.size).toBeGreaterThan(0);
  for (const script of scripts) scan(`script ${script}`, await (await request.get(script)).text(), all);
  let scanned = 0, withPublic = 0;
  const inScope = (path: string) => /\.(html|rsc|meta|segment|cache|body|js|css|json|txt)$/.test(path) && !(path.includes("/server/") && path.endsWith(".js"));
  const reading_ = (path: string) => /[\\/]reading[\\/]/.test(path) || path.includes("reading.json");
  for (const dir of [".next/server/app", ".open-next/cache"].filter(existsSync)) {
    // Prerendered reading pages: html, RSC payloads, segments and the route cache.
    for (const path of walk(dir, path => inScope(path) && reading_(path))) {
      const text = readFileSync(path, "utf8");
      scanned += 1;
      scan(path, text, all);
      if (probes.some(probe => text.includes(probe))) withPublic += 1;
    }
  }
  for (const dir of [".next/static", ".open-next/assets"].filter(existsSync)) {
    // Every client script and static page. Server bundles hold the canonical data by design and never reach the browser.
    for (const path of walk(dir, inScope)) { scanned += 1; scan(path, readFileSync(path, "utf8"), all); }
  }
  if (existsSync(".next/server/app")) { expect(scanned).toBeGreaterThan(100); expect(withPublic).toBeGreaterThan(15); }
  expect(leaks).toEqual([]);
});
