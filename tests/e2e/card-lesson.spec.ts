import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import prepJson from "../../content/prep.json";
import type { PrepData } from "../../lib/study-content-types";
import type { LessonChatRequest } from "../../lib/lesson-chat-contract";
import type { LessonState } from "../../lib/lesson-workspace-state";

const prep = prepJson as PrepData;
const units = prep.works.flatMap(work => work.units.map(unit => ({ work, unit, path: `/prep/${work.id}/unit-${unit.n}/`, lessonId: `${work.id}-unit-${unit.n}` })));
const wonder0 = units.find(item => item.lessonId === "wonder-unit-0")!;
const big = units.find(item => item.lessonId === "the-intern-unit-0")!;
const recordKey = (lessonId: string) => `english-sense-lesson-v4:${lessonId}`;
const TWO = "wonder-0-12"; // "My mom can ___ me ___." answers: pick, up
const ONE = "wonder-0-01"; // "Her smile ___ hugged me." answer: kind of
const chat = (page: Page) => page.getByRole("region", { name: "AI 대화", exact: true });
const section = (page: Page, id: string) => page.locator(`section.cl-card[data-question-id="${id}"]`);
/** The input of blank `n` inside the sentence of card `id`. */
const blank = (page: Page, id: string, n: number) => section(page, id).getByLabel(`빈칸 ${n}`, { exact: true });
const timeline = (page: Page) => page.getByRole("log", { name: "학습 수행과 대화" });
const context = (page: Page) => page.locator(".lw-reading-context");
const ready = async (page: Page) => { await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중"); };
const answer = (id: string) => prep.works.flatMap(work => work.units.flatMap(unit => unit.cards)).find(card => card.id === id)!.drill.answers;

async function open(page: Page, item = wonder0, hash = "") { await page.goto(`${item.path}${hash}`); await ready(page); }
/** Makes the card the conversation's target through the card's own button (not an event). */
async function pick(page: Page, id: string) { const button = section(page, id).getByRole("button", { name: /질문하기$/ }); await button.click(); await expect(button).toHaveAttribute("aria-pressed", "true"); }
/** Fills the card's blanks in its sentence and leaves the answer from the card itself. */
async function submit(page: Page, id: string, inputs: string[], mode: "첫 답 남기기" | "수정해서 다시 판정" = "첫 답 남기기") {
  for (const [index, value] of inputs.entries()) await blank(page, id, index + 1).fill(value);
  await section(page, id).getByRole("button", { name: mode }).click();
}
/** The outline starts open from 1100px and collapsed below it; open it when it is not. */
async function outline(page: Page) {
  const toggle = page.getByRole("button", { name: /^목차 (접기|펼치기)$/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return page.getByRole("navigation", { name: "학습 문서 목차" });
}
async function stored(page: Page, lessonId = wonder0.lessonId): Promise<LessonState> {
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), recordKey(lessonId))).not.toBeNull();
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), recordKey(lessonId));
}
async function unobscured(locator: Locator) {
  return locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && !!hit && element.contains(hit);
  });
}
/** Counts and answers AI calls with a mock; the real provider is never reached. */
async function mockChat(page: Page, reply = (body: LessonChatRequest) => `검사용 AI 응답: ${body.message.slice(0, 10)}`) {
  const bodies: LessonChatRequest[] = [];
  await page.route("**/api/learn-chat/**", async (route: Route) => {
    const body = route.request().postDataJSON() as LessonChatRequest;
    bodies.push(body);
    await route.fulfill({ json: { requestId: body.requestId, lessonId: body.lessonId, artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply: reply(body), mode: body.initialAttempt ? "ai" : "guidance" } });
  });
  return bodies;
}
function countRequests(page: Page, pattern: string) { const urls: string[] = []; page.on("request", request => { if (request.url().includes(pattern)) urls.push(request.method()); }); return urls; }

test.describe("card lesson: judging, revising and the answer happen inside the card", () => {
  test("a two-blank card is judged blank by blank inside the card, a partial match differs, and judging never calls the AI", async ({ page }) => {
    const chatCalls = await mockChat(page);
    await open(page);
    // The blanks are inputs inside the sentence of the card itself; the chat holds no answer form.
    await expect(section(page, TWO).locator("p.cl-drill-sentence input")).toHaveCount(2);
    await expect(chat(page).locator("form.lw-attempt-form, input")).toHaveCount(0);
    await expect(page.locator(".lw-reading-context")).toContainText("입력 대상: 아직 없음");
    await blank(page, TWO, 1).fill("pick");
    // Working in a card makes it the chat's target without any event. The card is still closed, so it is named by its number only.
    await expect(context(page)).toContainText("입력 대상: 카드 12");
    await expect(context(page)).not.toContainText("pick up");
    await blank(page, TWO, 2).fill("down");
    expect(await stored(page).catch(() => null)).not.toBeNull();
    const checked = page.waitForResponse(response => response.url().includes("/api/lesson-check/"));
    await section(page, TWO).getByRole("button", { name: "첫 답 남기기" }).click();
    const body = await (await checked).text();
    // The response opens the card (its expression, sense, example and basis) but never carries the canonical answers.
    expect(JSON.parse(body)).toMatchObject({ kind: "fill", matches: [true, false], card: { expression: "pick up" } });
    expect(body).not.toContain('"up"');
    expect(body).not.toContain("answers");
    const judgement = section(page, TWO).locator(".cl-judgement").first();
    await expect(judgement).toContainText("정본 답과 다릅니다.");
    await expect(judgement.getByText("빈칸 1 · 같음")).toBeVisible();
    await expect(judgement.getByText("빈칸 2 · 다름")).toBeVisible();
    await expect(judgement).toContainText("판정");
    // The conversation keeps one line per event: the answer and the judgement, in order, without the explanation.
    const lines = timeline(page).locator(".lw-event-line");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveText("카드 12 · pick up · 첫 답 pick / down");
    await expect(lines.nth(1)).toContainText("카드 12 · pick up · 첫 답 · 정본 답과 다릅니다 (빈칸 1 같음 · 빈칸 2 다름)");
    await expect(timeline(page).locator(".cl-judgement, .lw-judgement")).toHaveCount(0);
    await expect(timeline(page).locator(".lw-assistant-message")).toHaveCount(0);
    expect(chatCalls).toHaveLength(0);
    const record = await stored(page);
    expect(record.events.map(event => event.kind)).toEqual(["initial", "check"]);
    expect(record.artifacts[0].attempts[0].attempt).toEqual({ kind: "fill", inputs: ["pick", "down"] });
  });

  test("a wrong answer is revised as a new attempt in the card, the answer opens only after a first answer, and later attempts say so", async ({ page }) => {
    await open(page);
    const card = section(page, TWO);
    const reveal = card.getByRole("button", { name: "답 보기" });
    await expect(reveal).toBeDisabled();
    await expect(card).toContainText("답 보기는 첫 답을 낸 뒤에 열립니다.");
    await submit(page, TWO, ["pick", "down"]);
    await expect(card.locator(".cl-judgement")).toHaveCount(1);
    await expect(card.getByRole("form", { name: "카드 12 수정" })).toBeVisible();
    await expect(card.getByText("직전 판정 · 다름")).toBeVisible();
    await expect(reveal).toBeEnabled();

    await reveal.click();
    const shown = card.locator(".cl-reveal");
    await expect(shown).toContainText("빈칸 1 · pick");
    await expect(shown).toContainText("빈칸 2 · up");
    await expect(card.getByRole("button", { name: "답 보기" })).toHaveCount(0);
    await expect(timeline(page).locator(".lw-event-line").last()).toHaveText(/카드 12 · pick up · 답 보기 · 정본 답을 열었습니다/);
    await expect(timeline(page)).not.toContainText("빈칸 2 · up");

    await blank(page, TWO, 2).fill("up");
    await card.getByRole("button", { name: "수정해서 다시 판정" }).click();
    await expect(card.locator(".cl-judgement").last()).toContainText("정본 답과 같습니다.");
    await expect(card.locator(".cl-attempt").last()).toContainText("수정 1");
    await expect(card.locator(".cl-attempt").last()).toContainText("답을 본 뒤");
    await expect(card.locator(".cl-attempt").first()).not.toContainText("답을 본 뒤");
    // A matching card keeps its answer visible but no longer takes edits.
    await expect(blank(page, TWO, 2)).toHaveAttribute("readonly", "");
    await expect(card.getByRole("button", { name: /다시 판정$/ })).toHaveCount(0);
    const order = await timeline(page).locator(".lw-event-line").allInnerTexts();
    expect(order.map(text => text.replace(/\s*카드에서 보기$/, ""))).toEqual([
      "카드 12 · pick up · 첫 답 pick / down",
      "카드 12 · pick up · 첫 답 · 정본 답과 다릅니다 (빈칸 1 같음 · 빈칸 2 다름)",
      "카드 12 · pick up · 답 보기 · 정본 답을 열었습니다",
      "카드 12 · pick up · 수정 1 pick / up · 답을 본 뒤",
      "카드 12 · pick up · 수정 1 · 정본 답과 같습니다 (빈칸 1 같음 · 빈칸 2 같음) · 답을 본 뒤",
    ]);

    const record = await stored(page);
    expect(record.events.map(event => event.kind)).toEqual(["initial", "check", "reveal", "revision", "check"]);
    const [first, second] = record.artifacts[0].attempts;
    expect(first.attempt).toEqual({ kind: "fill", inputs: ["pick", "down"] });
    expect(first.check).toMatchObject({ kind: "fill", matches: [true, false], allMatch: false });
    expect(second.attempt).toEqual({ kind: "fill", inputs: ["pick", "up"] });
    expect(record.artifacts[0].reveal).toMatchObject({ afterAttempts: 1 });
  });

  test("the first answer is kept across a reload without a new request, and an unchanged revision is not sent", async ({ page }) => {
    await open(page);
    await submit(page, TWO, ["pick", "down"]);
    await expect(section(page, TWO).locator(".cl-judgement")).toHaveCount(1);
    await blank(page, TWO, 2).fill("dow");
    const requests = countRequests(page, "/api/");
    await page.reload();
    await ready(page);
    await expect(section(page, TWO).locator(".cl-attempt")).toHaveCount(1);
    await expect(section(page, TWO).locator(".cl-judgement")).toHaveCount(1);
    await expect(context(page)).toContainText("입력 대상: 카드 12 · pick up");
    await expect(blank(page, TWO, 2)).toHaveValue("dow");
    await expect(timeline(page).locator(".lw-event-line")).toHaveCount(2);
    expect(requests).toEqual([]);
    expect((await stored(page)).artifacts[0].attempts).toHaveLength(1);
    await blank(page, TWO, 2).fill("down");
    await expect(section(page, TWO).getByRole("button", { name: "수정해서 다시 판정" })).toBeDisabled();
  });

  test("a single-blank card accepts a lenient right answer", async ({ page }) => {
    await open(page);
    await expect(blank(page, ONE, 1)).toBeVisible();
    await expect(section(page, ONE).getByLabel("빈칸 2", { exact: true })).toHaveCount(0);
    await submit(page, ONE, ["  KIND of "]);
    await expect(section(page, ONE).locator(".cl-judgement")).toContainText("정본 답과 같습니다.");
    await expect(section(page, ONE)).toContainText("정본 답과 같다고 판정됐습니다");
  });

  test("submitting with every blank empty asks for an answer in the card and sends nothing", async ({ page }) => {
    const requests = countRequests(page, "/api/");
    await open(page);
    await section(page, TWO).getByRole("button", { name: "첫 답 남기기" }).click();
    expect(await blank(page, TWO, 1).evaluate(input => (input as HTMLInputElement).validationMessage)).toBe("빈칸 하나 이상에 적어 주십시오.");
    expect(requests).toEqual([]);
    expect((await stored(page)).events).toEqual([]);
  });
});

test.describe("card lesson: judging requests that fail", () => {
  test("a blocked request keeps the first answer, offers judging again in the card, and the same request gives the same result", async ({ page }) => {
    await open(page);
    await page.route("**/api/lesson-check/**", route => route.abort());
    await submit(page, TWO, ["pick", "down"]);
    const failure = section(page, TWO).locator(".lw-judgement-failed");
    await expect(failure).toContainText("판정을 받지 못했습니다. 답은 남아 있습니다.");
    await expect(section(page, TWO).locator(".cl-attempt")).toContainText("down");
    expect((await stored(page)).artifacts[0].attempts[0]).toMatchObject({ attempt: { kind: "fill", inputs: ["pick", "down"] }, check: null });
    await expect(blank(page, TWO, 1)).toHaveAttribute("readonly", "");

    await page.reload();
    await ready(page);
    await expect(section(page, TWO).locator(".lw-judgement-failed")).toBeVisible();
    await page.unroute("**/api/lesson-check/**");
    const bodies: string[] = [];
    page.on("request", request => { if (request.url().includes("/api/lesson-check/")) bodies.push(request.postData() || ""); });
    await section(page, TWO).getByRole("button", { name: "다시 판정" }).click();
    await expect(section(page, TWO).locator(".cl-judgement")).toContainText("정본 답과 다릅니다.");
    expect(bodies).toHaveLength(1);
    const repeat = async () => (await page.request.post("/api/lesson-check/", { data: JSON.parse(bodies[0]), headers: { Origin: new URL(page.url()).origin } })).text();
    expect(await repeat()).toBe(await repeat());
    const record = await stored(page);
    expect(record.artifacts[0].attempts[0].check).toMatchObject({ kind: "fill", matches: [true, false] });
    expect(record.events.map(event => event.kind)).toEqual(["initial", "check"]);
  });

  test("a failed reveal keeps the answer closed and can be tried again", async ({ page }) => {
    await open(page);
    await submit(page, TWO, ["pick", "down"]);
    await expect(section(page, TWO).locator(".cl-judgement")).toHaveCount(1);
    await page.route("**/api/lesson-check/**", route => route.abort());
    await section(page, TWO).getByRole("button", { name: "답 보기" }).click();
    await expect(section(page, TWO)).toContainText("답을 가져오지 못했습니다. 첫 답은 남아 있습니다.");
    expect((await stored(page)).artifacts[0].reveal).toBeNull();
    await page.unroute("**/api/lesson-check/**");
    await section(page, TWO).getByRole("button", { name: "답 보기" }).click();
    await expect(section(page, TWO).locator(".cl-reveal")).toContainText("빈칸 2 · up");
  });
});

test.describe("card lesson: the AI is called only when the learner sends", () => {
  test("a first answer calls no AI; the explain button and a question send the documented request", async ({ page }) => {
    const calls = await mockChat(page);
    await open(page);
    await expect(chat(page).getByRole("button", { name: "AI에게 설명 요청" })).toHaveCount(0);
    await blank(page, TWO, 1).fill("pick");
    await expect(chat(page).getByRole("button", { name: "AI에게 설명 요청" })).toBeDisabled();
    await submit(page, TWO, ["pick", "down"]);
    await expect(section(page, TWO).locator(".cl-judgement")).toHaveCount(1);
    expect(calls).toHaveLength(0);

    await chat(page).getByRole("button", { name: "AI에게 설명 요청" }).click();
    await expect(timeline(page).locator(".lw-assistant-message")).toHaveCount(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ lessonId: wonder0.lessonId, questionId: TWO, initialAttempt: { kind: "fill", inputs: ["pick", "down"] }, revisions: [] });
    expect(Object.keys(calls[0]).sort()).toEqual(["artifactId", "contentVersion", "initialAttempt", "lessonId", "message", "messages", "questionId", "requestId", "revisions"]);
    await expect(timeline(page).locator(".lw-assistant-message")).not.toHaveClass(/cl-judgement/);
    await expect(section(page, TWO).locator(".cl-judgement")).toHaveCount(1);

    await submit(page, TWO, ["pick", "up"], "수정해서 다시 판정");
    await expect(section(page, TWO).locator(".cl-judgement")).toHaveCount(2);
    await chat(page).getByLabel("이 카드에 대해 질문하기").fill("up은 왜 필요한가요?");
    await chat(page).getByRole("button", { name: "질문 보내기" }).click();
    await expect(timeline(page).locator(".lw-assistant-message")).toHaveCount(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ message: "up은 왜 필요한가요?", initialAttempt: { kind: "fill", inputs: ["pick", "down"] }, revisions: [{ text: "pick / up" }] });
    expect(calls[1].messages).toHaveLength(2);
    // Answers, judgements and questions stay in the order they happened.
    const kinds = await timeline(page).locator(".lw-timeline-event").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-event-kind")));
    expect(kinds).toEqual(["initial", "check", "request", "reply", "revision", "check", "request", "reply"]);
  });

  test("before a first answer a question gets the free preparation guide from the real server and no answer", async ({ page }) => {
    await open(page);
    await pick(page, TWO);
    await chat(page).getByLabel("이 카드에 대해 질문하기").fill("힌트가 있나요?");
    const reply = page.waitForResponse(response => response.url().includes("/api/learn-chat/"));
    await chat(page).getByRole("button", { name: "질문 보내기" }).click();
    const text = await (await reply).text();
    expect(JSON.parse(text)).toMatchObject({ mode: "guidance", lessonId: wonder0.lessonId, questionId: TWO });
    expect(text).not.toContain("pick");
    await expect(timeline(page).locator(".lw-assistant-message")).toContainText("준비 안내");
  });

  test("a reply that arrives after another card was handled stays on the original card and the page does not move", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const calls: LessonChatRequest[] = [];
    await page.route("**/api/learn-chat/**", async route => {
      const body = route.request().postDataJSON() as LessonChatRequest;
      calls.push(body);
      await gate;
      await route.fulfill({ json: { requestId: body.requestId, lessonId: body.lessonId, artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply: "검사용 늦은 응답", mode: "ai" } });
    });
    await open(page);
    await submit(page, TWO, ["pick", "down"]);
    await expect(section(page, TWO).locator(".cl-judgement")).toHaveCount(1);
    await chat(page).getByRole("button", { name: "AI에게 설명 요청" }).click();
    await expect(timeline(page).locator(".lw-waiting")).toContainText("카드 12 · pick up");
    // While the request is pending the learner works in another card: it becomes the target, the request keeps its own.
    await blank(page, ONE, 1).fill("kind");
    await expect(context(page)).toContainText(/입력 대상: 카드 1(?!\d)/);
    await section(page, ONE).scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);
    release();
    await expect(timeline(page).locator(".lw-assistant-message")).toContainText("검사용 늦은 응답");
    await expect(timeline(page).locator(".lw-assistant-message .lw-message-meta")).toContainText("카드 12 · pick up");
    await expect(context(page)).toContainText(/입력 대상: 카드 1(?!\d)/);
    expect(Math.abs((await page.evaluate(() => scrollY)) - scrollBefore)).toBeLessThanOrEqual(2);
    const record = await stored(page);
    const original = record.artifacts.find(artifact => artifact.question.questionId === TWO)!;
    expect(original.threads[0].turns[0]).toMatchObject({ status: "complete", reply: "검사용 늦은 응답" });
    expect(record.artifacts.find(artifact => artifact.question.questionId === ONE)?.threads[0].turns ?? []).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  test("when the AI limit is reached, judging, the document and the record keep working", async ({ page }) => {
    await page.route("**/api/learn-chat/**", route => route.fulfill({ status: 429, json: { detail: "오늘 AI 설명 한도에 도달했습니다.", error: { code: "quota_exceeded", message: "오늘 AI 설명 한도에 도달했습니다." } } }));
    await open(page);
    await submit(page, TWO, ["pick", "down"]);
    await expect(section(page, TWO).locator(".cl-judgement")).toHaveCount(1);
    await chat(page).getByRole("button", { name: "AI에게 설명 요청" }).click();
    await expect(timeline(page).locator(".lw-request-error")).toContainText("오늘 AI 설명 한도에 도달했습니다.");
    await submit(page, TWO, ["pick", "up"], "수정해서 다시 판정");
    await expect(section(page, TWO).locator(".cl-judgement").last()).toContainText("정본 답과 같습니다.");
    await submit(page, ONE, ["kind of"]);
    await expect(section(page, ONE).locator(".cl-judgement").last()).toContainText("정본 답과 같습니다.");
    const record = await stored(page);
    expect(record.artifacts).toHaveLength(2);
    expect(record.artifacts.find(artifact => artifact.question.questionId === TWO)!.threads[0].turns[0].status).toBe("failed");
  });
});

test.describe("card lesson: document, links and records", () => {
  test("every card is a section and an outline entry, and the old #card-id address goes to that card", async ({ page }) => {
    await open(page, wonder0);
    await expect(page.locator("section.cl-card")).toHaveCount(wonder0.unit.cards.length);
    await expect((await outline(page)).getByRole("link")).toHaveCount(wonder0.unit.cards.length);
    await open(page, wonder0, `#${TWO}`);
    await expect(section(page, TWO)).toBeInViewport();
    await expect(context(page)).toContainText("입력 대상: 카드 12");
    await expect(context(page)).not.toContainText("pick up");
    const record = await stored(page);
    expect(record.events).toEqual([]);
    expect(record.artifacts).toEqual([]);
    expect(record.selectedQuestionId).toBe(TWO);
    const other = units.find(item => item.lessonId === "wonder-unit-3")!;
    const id = other.unit.cards[7].id;
    await page.goto(`${other.path}#${id}`);
    await ready(page);
    await expect(section(page, id)).toBeInViewport();
  });

  test("reading, choosing a card and following links create no event, no request and no answer", async ({ page }) => {
    const requests = countRequests(page, "/api/");
    await open(page);
    await section(page, TWO).scrollIntoViewIfNeeded();
    await pick(page, TWO);
    await pick(page, ONE);
    await (await outline(page)).getByRole("link", { name: /카드 3/ }).click();
    await blank(page, ONE, 1).focus();
    expect(requests).toEqual([]);
    const record = await stored(page);
    expect(record.events).toEqual([]);
    expect(record.artifacts).toEqual([]);
  });

  test("the unit links to the story written with its expressions, to the neighbouring units and to the list", async ({ page }) => {
    await open(page, units.find(item => item.lessonId === "wonder-unit-3")!);
    const link = page.getByRole("link", { name: /이 표현으로 읽기: Leaving in June \(4분\)/ });
    await expect(link).toHaveAttribute("href", "/reading/prep-wonder-3/");
    await expect(page.getByRole("navigation", { name: "다른 유닛" }).getByRole("link", { name: /이전/ })).toHaveAttribute("href", "/prep/wonder/unit-2/");
    await expect(page.getByRole("navigation", { name: "다른 유닛" }).getByRole("link", { name: /다음/ })).toHaveAttribute("href", "/prep/wonder/unit-4/");
    await page.locator(".lw-toolbar").getByRole("button", { name: "수업 목록", exact: true }).click();
    const listWindow = page.getByRole("dialog", { name: "수업 목록" });
    await expect(listWindow.getByRole("link", { name: "이 작품의 유닛 목록" })).toHaveAttribute("href", "/prep/wonder/");
    await listWindow.getByRole("button", { name: "닫고 학습으로 돌아가기" }).click();
  });

  test("two lessons keep separate records across reloads and a damaged record blocks only its own lesson", async ({ page }) => {
    await open(page);
    await submit(page, ONE, ["kind of"]);
    await expect(section(page, ONE).locator(".cl-judgement")).toHaveCount(1);
    const second = units.find(item => item.lessonId === "wonder-unit-1")!;
    await open(page, second);
    await expect(page.locator(".cl-attempt")).toHaveCount(0);
    const secondCard = second.unit.cards[0];
    await submit(page, secondCard.id, ["wrong"]);
    await expect(section(page, secondCard.id).locator(".cl-judgement")).toContainText("정본 답과 다릅니다.");
    await page.reload();
    await ready(page);
    await expect(page.locator(".cl-attempt")).toHaveCount(1);
    expect((await stored(page, second.lessonId)).artifacts.map(artifact => artifact.question.questionId)).toEqual([secondCard.id]);
    expect((await stored(page, wonder0.lessonId)).artifacts.map(artifact => artifact.question.questionId)).toEqual([ONE]);
    await open(page);
    await expect(page.locator(".cl-attempt")).toHaveCount(1);
    await expect(page.locator(".cl-attempt")).toContainText("kind of");
    // The other lesson's record is damaged; this lesson still opens with its own record.
    await page.evaluate(key => localStorage.setItem(key, "{broken"), recordKey(second.lessonId));
    await page.reload();
    await ready(page);
    await expect(page.locator(".cl-attempt")).toHaveCount(1);
    await page.goto(second.path);
    await expect(page.locator(".lw-save-warning").first()).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), recordKey(second.lessonId))).toBe("{broken");
  });

  test("a record of an older content version is kept read only, and restarting clears only this lesson's record key", async ({ page }) => {
    await open(page);
    await submit(page, TWO, ["pick", "down"]);
    await expect(section(page, TWO).locator(".cl-judgement")).toHaveCount(1);
    const before = await stored(page);
    const current = before.artifacts[0].contentVersion;
    await page.evaluate(([key, version]) => {
      localStorage.setItem(key, localStorage.getItem(key)!.replaceAll(version, "e".repeat(64)));
      localStorage.setItem("english-sense-lesson-v4:wonder-unit-1", "{\"keep\":true}");
    }, [recordKey(wonder0.lessonId), current]);
    const requests = countRequests(page, "/api/");
    await page.reload();
    await ready(page);
    expect(requests).toEqual([]);
    await expect(chat(page).locator(".cl-old-banner")).toContainText("이전 자료 판으로 남은 기록");
    await expect(page.locator(".cl-attempt")).toHaveCount(1);
    await expect(page.locator(".cl-judgement")).toHaveCount(1);
    await expect(blank(page, TWO, 1)).toHaveAttribute("readonly", "");
    await expect(section(page, TWO).getByRole("button", { name: /첫 답 남기기|수정해서 다시 판정|답 보기/ })).toHaveCount(0);
    await expect(chat(page).getByRole("button", { name: "AI에게 설명 요청" })).toBeDisabled();
    await expect(chat(page).getByRole("button", { name: "질문 보내기" })).toBeDisabled();
    expect(await page.evaluate(key => localStorage.getItem(key)!.includes("e".repeat(64)), recordKey(wonder0.lessonId))).toBe(true);

    let message = "";
    page.once("dialog", dialog => { message = dialog.message(); void dialog.dismiss(); });
    await chat(page).getByRole("button", { name: "이 기록을 지우고 새 판으로 시작" }).click();
    expect(message).toContain("되돌릴 수 없습니다");
    await expect(page.locator(".cl-attempt")).toHaveCount(1);
    page.once("dialog", dialog => void dialog.accept());
    await chat(page).getByRole("button", { name: "이 기록을 지우고 새 판으로 시작" }).click();
    await expect(page.locator(".cl-attempt")).toHaveCount(0);
    await expect(chat(page).locator(".cl-old-banner")).toHaveCount(0);
    await expect(blank(page, TWO, 1)).toBeEditable();
    const fresh = await stored(page);
    expect(fresh.artifacts).toEqual([]);
    expect(fresh.events).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem("english-sense-lesson-v4:wonder-unit-1"))).toBe("{\"keep\":true}");
    await submit(page, TWO, ["pick", "up"]);
    await expect(section(page, TWO).locator(".cl-judgement")).toContainText("정본 답과 같습니다.");
  });

  test("nothing on the screen says mastery, completion or progress", async ({ page }) => {
    await open(page);
    await submit(page, ONE, ["kind of"]);
    await expect(section(page, ONE).locator(".cl-judgement")).toHaveCount(1);
    await outline(page);
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(text).not.toMatch(/숙달|완료|진행률|마스터|달성|정답입니다|맞습니다|축하/);
    expect(text).not.toMatch(/\d+\s*\/\s*\d+\s*(문제|카드|개)/);
    expect(text).toContain("첫 답을 남긴 카드 1개");
  });
});

for (const [width, height] of [[1440, 900], [1100, 800], [390, 844], [320, 640]] as const) {
  test(`${width}px: a 22-card unit's text, outline, inline blanks and the chat are reachable and nothing fixed covers them`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await open(page, big);
    const cards = big.unit.cards;
    expect(cards.length).toBe(22);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const toggle = page.getByRole("button", { name: /^목차 (접기|펼치기)$/ });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(page.getByRole("navigation", { name: "학습 문서 목차" }).getByRole("link")).toHaveCount(22);
    const last = page.getByRole("navigation", { name: "학습 문서 목차" }).getByRole("link").last();
    await last.scrollIntoViewIfNeeded();
    expect(await unobscured(last)).toBe(true);
    await last.click();
    const lastSection = section(page, cards[21].id);
    await expect(lastSection).toBeInViewport();
    const heading = lastSection.locator("h2");
    const toolbarBottom = await page.locator(".lw-toolbar").evaluate(element => element.getBoundingClientRect().bottom);
    const headingTop = await heading.evaluate(element => element.getBoundingClientRect().top);
    expect(headingTop).toBeGreaterThanOrEqual(Math.min(toolbarBottom, 0) - 1);
    await heading.scrollIntoViewIfNeeded();
    expect(await unobscured(heading)).toBe(true);
    await expect(heading).toHaveText("카드 22");
    await expect(page.locator("section.cl-card form")).toHaveCount(22);
    const input = blank(page, cards[20].id, 1);
    await input.scrollIntoViewIfNeeded();
    expect(await unobscured(input)).toBe(true);
    await input.fill("x");
    await expect(input).toHaveValue("x");
    await expect(context(page)).toContainText(/입력 대상: 카드 21(?!\d)/);
    const submitButton = section(page, cards[20].id).getByRole("button", { name: "첫 답 남기기" });
    await submitButton.scrollIntoViewIfNeeded();
    expect(await unobscured(submitButton)).toBe(true);
    const askButton = section(page, cards[20].id).getByRole("button", { name: /질문하기$/ });
    // Centered, not aligned to the edge: an edge-aligned button can end a fraction of a pixel past the viewport with the card's note lines.
    await askButton.evaluate(element => element.scrollIntoView({ block: "center" }));
    expect(await unobscured(askButton)).toBe(true);
    const question = page.getByLabel("이 카드에 대해 질문하기");
    await question.scrollIntoViewIfNeeded();
    expect(await unobscured(question)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("no answer string of any card reaches the first HTML, the RSC payload, client scripts or the prerender caches (all 13 units)", async ({ request }) => {
  const clientFiles: { path: string; text: string }[] = [];
  const server = /(^|\/)(server|server-functions|middleware)(\/|$)|(^|\/)worker\.js$/;
  const walk = (root: string, label: string, relative = ""): void => {
    for (const name of readdirSync(join(root, relative))) {
      const path = relative ? `${relative}/${name}` : name;
      if (statSync(join(root, path)).isDirectory()) { walk(root, label, path); continue; }
      const code = /\.(m?js|cjs|nft\.json|json)$/.test(name);
      // Server bundles hold the canonical data by design. What must not carry it is everything the browser or a cache serves.
      if (code && server.test(`${label}/${path}`)) continue;
      if (/\.(html|rsc|meta|segment|cache|body|txt|m?js|css)$/.test(name) || name.includes(".segments")) clientFiles.push({ path: `${label}/${path}`, text: readFileSync(join(root, path), "utf8") });
    }
  };
  for (const root of [".next/static", ".next/server/app", ".open-next/assets", ".open-next/cache"]) { try { walk(join(process.cwd(), root), root); } catch { /* a root that does not exist in this build is skipped */ } }
  expect(clientFiles.length, "the built output must be present: run npm run cf:build first").toBeGreaterThan(100);
  const escapes = (text: string) => [text, text.replaceAll("'", "&#x27;").replaceAll('"', "&quot;"), JSON.stringify(text).slice(1, -1), JSON.stringify(JSON.stringify(text)).slice(1, -1).slice(1, -1)];
  // A card's filled sentence can also be another card's example (the same line of the work), so a file is judged only by the cards whose blanked sentence it shows.
  const cardsOf = units.flatMap(({ unit }) => unit.cards);
  const filledOf = (card: (typeof cardsOf)[number]) => card.drill.answers.reduce((sentence, item) => sentence.replace("___", item), card.drill.sentence);
  const leaks = (text: string, cards: typeof cardsOf) => cards.flatMap(card => {
    const found: string[] = [];
    const array = JSON.stringify(card.drill.answers);
    if (text.includes(array) || text.includes(array.replaceAll('"', '\\"'))) found.push(`${card.id} answers array`);
    if (escapes(card.drill.sentence).some(value => text.includes(value)) && escapes(filledOf(card)).some(value => text.includes(value))) found.push(`${card.id} filled sentence beside its blank sentence`);
    return found;
  });
  const hits: string[] = [];
  for (const file of clientFiles) for (const found of leaks(file.text, cardsOf)) hits.push(`${file.path}: ${found}`);
  expect(hits).toEqual([]);
  expect(clientFiles.filter(file => file.path.includes("/prep/") && /\.(html|rsc|cache)$/.test(file.path)).length, "unit pages must be among the scanned files").toBeGreaterThan(30);
  for (const { path, unit } of units) {
    for (const [label, headers] of [["html", {}], ["rsc", { RSC: "1" }]] as const) {
      const response = await request.get(path, { headers });
      expect(response.status(), `${path} ${label}`).toBe(200);
      const text = await response.text();
      expect(leaks(text, unit.cards), `${path} ${label}`).toEqual([]);
      // The page still shows each card as the learner sees it before answering: its meaning (the expression is the recall's job, see card-recall.spec.ts).
      expect(unit.cards.every(card => escapes(card.meaning).some(value => text.includes(value))), `${path} ${label} shows its cards`).toBe(true);
      expect(text.includes('"answers"'), `${path} ${label} has no answers key`).toBe(false);
    }
  }
});

test("the unit pages keep their title, description, canonical address and sitemap entry", async ({ page, request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  for (const { path, work, unit } of units) {
    await page.goto(path);
    await expect(page).toHaveTitle(`${work.title} 사전 훈련 유닛 ${unit.n}(${unit.when}) | 영어 감각`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://english.artificialmind.kr${path}`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /익힐 표현/);
    await expect(page.locator("main h1")).toBeVisible();
    expect(xml).toContain(`https://english.artificialmind.kr${path}`);
  }
});
