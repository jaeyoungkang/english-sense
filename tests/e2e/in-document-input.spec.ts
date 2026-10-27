import { test, expect, type Locator, type Page } from "@playwright/test";
import type { ArtifactLearningChatRequest } from "../../lib/learning-chat-contract";
import type { WorkspaceState } from "../../lib/learning-workspace-state";
import pages from "../../content/pages.json";
import { chooseQuiz } from "./workspace-input";

// The scene lesson on the home page: the first answer, the revision and the AI feedback are in the quiz; the conversation has the
// question box and one line for each answer, revision, question and reply. Provider replies below are mocks.

const storageKey = "english-sense-learning-workspace-v3";
const card = (page: Page, number: number) => page.locator(`.lw-quiz-artifact[data-question-id="titanic-have-${number}"]`);
const firstForm = (page: Page, number: number) => page.getByRole("form", { name: `${number}번 퀴즈 첫 답`, exact: true });
const revisionForm = (page: Page, number: number) => page.getByRole("form", { name: `${number}번 퀴즈 수정`, exact: true });
const chatPane = (page: Page) => page.getByRole("region", { name: "AI 대화", exact: true });
const question = (page: Page) => page.getByLabel("이 장면에 대해 질문하기");
const lines = (page: Page) => page.locator(".lw-transcript .lw-event-line");
const reply = (body: ArtifactLearningChatRequest, text: string, mode: "ai" | "guidance" = "ai") => ({ requestId: body.requestId, artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply: text, mode });
const longFeedback = (label: string) => `${label} ${"장면의 어느 쪽에서 이 표현이 떠오르는지 천천히 비교해 봅니다. ".repeat(8)}끝말-${label}`;

async function stored(page: Page): Promise<WorkspaceState> {
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).not.toBeNull();
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
}
async function answerChoice(page: Page, number: number, choice: number, reason: string) {
  const form = firstForm(page, number);
  await form.locator('input[type="radio"]').nth(choice).check();
  await form.getByLabel("그 문장을 고른 까닭").fill(reason);
  await form.getByRole("button", { name: "내 답 제출하고 대화하기", exact: true }).click();
}
async function ask(page: Page, text: string) {
  await question(page).fill(text);
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
}
async function top(locator: Locator) { return locator.evaluate(element => element.getBoundingClientRect().top); }
async function unobscured(locator: Locator) {
  return locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && !!hit && element.contains(hit);
  });
}

test("the first answer is made in the quiz itself and the AI feedback appears in that quiz, asked once and automatically", async ({ page }) => {
  const requests: ArtifactLearningChatRequest[] = [];
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    await route.fulfill({ json: reply(body, longFeedback("피드백")) });
  });
  await page.goto("/");
  // Seven first-answer forms are in the document; the conversation has only the question box.
  await expect(page.locator(".lw-content-pane form[aria-label$='번 퀴즈 첫 답']")).toHaveCount(7);
  await expect(chatPane(page).locator("form")).toHaveCount(1);
  await expect(chatPane(page).getByRole("form", { name: /첫 답|수정/ })).toHaveCount(0);
  await expect(firstForm(page, 3).locator('input[type="radio"]')).toHaveCount(3);
  // The third quiz is answered without choosing it as the input target first.
  await answerChoice(page, 3, 1, "검사용 문서 안 첫 답의 까닭");
  const turn = card(page, 3).locator(".lw-doc-turn");
  await expect(turn).toHaveCount(1);
  await expect(turn.locator(".lw-assistant-message > p")).toContainText("끝말-피드백");
  await expect(firstForm(page, 3)).toHaveCount(0);
  await expect(card(page, 3).locator(".lw-doc-performance")).toContainText("검사용 문서 안 첫 답의 까닭");
  await expect(card(page, 3).locator(".lw-question-options > li").nth(1).locator(".lw-option-tag")).toHaveText("내 첫 답");
  for (const other of [1, 2, 4, 5, 6, 7]) await expect(card(page, other).locator(".lw-doc-turn")).toHaveCount(0);
  // The answer makes the quiz the input target (choosing is not an event) and calls the AI once, with the answer.
  await expect(card(page, 3).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".lw-reading-context")).toContainText("입력 대상: have · 3번 퀴즈");
  await page.waitForTimeout(600);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ questionId: "titanic-have-3", initialAttempt: { kind: "choose", choice: 1, reason: "검사용 문서 안 첫 답의 까닭" }, messages: [], revisions: [] });
  expect(requests[0].message).toContain("처음 제출한 답과 이유를 장면에 비추어 설명해 주세요");
  const state = await stored(page);
  expect(state.events.map(event => event.kind)).toEqual(["card", "card", "initial", "request", "reply"]);
  expect(state.events.filter(event => event.kind === "reply" && event.artifactId === state.selectedArtifactId)).toHaveLength(1);
  // The conversation keeps one line each for the answer, the request and the reply; the long feedback is only in the document.
  await expect(lines(page)).toHaveCount(3);
  await expect(lines(page).nth(0)).toContainText("3번 퀴즈 · 첫 답을 남겼습니다 · B");
  await expect(lines(page).nth(1)).toContainText("AI 피드백을 자동으로 요청했습니다");
  await expect(lines(page).nth(2)).toContainText("AI 응답");
  await expect(page.locator(".lw-transcript")).not.toContainText("끝말-피드백");
  await expect(page.locator(".lw-transcript .lw-assistant-message, .lw-transcript .lw-user-message, .lw-transcript .lw-user-performance")).toHaveCount(0);
});

test("a writing quiz is answered in the quiz and a revision is made there, apart from the first answer and from questions", async ({ page }) => {
  const requests: ArtifactLearningChatRequest[] = [];
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    await route.fulfill({ json: reply(body, requests.length === 1 ? "검사용 쓰기 피드백" : "검사용 수정 뒤 응답") });
  });
  await page.goto("/");
  const writing = firstForm(page, 6);
  await writing.getByLabel("내가 쓴 영어 문장").fill("Browser test: I have a small light.");
  await writing.getByRole("button", { name: "내 답 제출하고 대화하기", exact: true }).click();
  await expect(page.getByText("검사용 쓰기 피드백", { exact: true })).toBeVisible();
  expect(requests[0]).toMatchObject({ questionId: "titanic-have-6", initialAttempt: { kind: "produce", text: "Browser test: I have a small light." } });
  await expect(card(page, 6).locator(".lw-first-answer")).toHaveText("Browser test: I have a small light.");
  // Opening the revision form is not a request; the form is in the quiz and the conversation gets no form.
  await card(page, 6).getByRole("button", { name: "답을 고쳐 쓰기", exact: true }).click();
  await expect(revisionForm(page, 6)).toBeVisible();
  await expect(card(page, 6).locator(".lw-inline-revision")).toHaveCount(1);
  await expect(chatPane(page).locator("form")).toHaveCount(1);
  await expect(revisionForm(page, 6).getByLabel("내가 고친 답")).toBeFocused();
  await revisionForm(page, 6).getByLabel("내가 고친 답").fill("Browser test: I have a tiny light.");
  await revisionForm(page, 6).getByRole("button", { name: "초안을 두고 나중에 쓰기", exact: true }).click();
  await expect(revisionForm(page, 6)).toHaveCount(0);
  expect((await stored(page)).artifacts.find(artifact => artifact.question.questionId === "titanic-have-6")!.revisions).toEqual([]);
  await card(page, 6).getByRole("button", { name: "작성하던 수정 이어 쓰기", exact: true }).click();
  await expect(revisionForm(page, 6).getByLabel("내가 고친 답")).toHaveValue("Browser test: I have a tiny light.");
  await revisionForm(page, 6).getByRole("button", { name: "수정한 답 남기기", exact: true }).click();
  await expect(card(page, 6).locator(".lw-revision-turn")).toContainText("Browser test: I have a tiny light.");
  await expect(card(page, 6).locator(".lw-first-answer")).toHaveText("Browser test: I have a small light.");
  expect(requests).toHaveLength(1);
  await expect(lines(page).filter({ hasText: "수정 1을 남겼습니다" })).toContainText("tiny light");
  // A question goes with the answer and the revision, and does not change either.
  await ask(page, "검사용 수정 뒤 질문");
  await expect(page.getByText("검사용 수정 뒤 응답", { exact: true })).toBeVisible();
  expect(requests[1].revisions).toEqual([{ text: "Browser test: I have a tiny light." }]);
  expect(requests[1].initialAttempt).toEqual(requests[0].initialAttempt);
  const state = await stored(page);
  expect(state.events.map(event => event.kind)).toEqual(["card", "card", "initial", "request", "reply", "revision", "request", "reply"]);
});

test("the conversation has the question box and one line per event, with the full text in the document and a way back to it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests: ArtifactLearningChatRequest[] = [];
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    await route.fulfill({ json: reply(body, requests.length === 1 ? "검사용 첫 피드백" : longFeedback("질문 응답"), requests.length === 1 ? "ai" : "guidance") });
  });
  await page.goto("/");
  await answerChoice(page, 1, 0, "검사용 1번 첫 답");
  await expect(page.getByText("검사용 첫 피드백", { exact: true })).toBeVisible();
  await ask(page, "검사용 문서에서 다시 볼 질문입니다. 이 질문은 한 줄에 다 들어가지 않을 만큼 길게 씁니다.");
  await expect(card(page, 1).locator(".lw-doc-turn")).toHaveCount(2);
  const secondTurn = card(page, 1).locator(".lw-doc-turn").nth(1);
  await expect(secondTurn.locator(".lw-user-message")).toContainText("검사용 문서에서 다시 볼 질문입니다. 이 질문은 한 줄에 다 들어가지 않을 만큼 길게 씁니다.");
  await expect(secondTurn.locator(".lw-assistant-message .lw-message-meta")).toContainText("준비 안내 · AI 호출 없음");
  // Four lines in the real order: first answer, automatic request, reply, question, reply.
  await expect(lines(page)).toHaveCount(5);
  await expect(lines(page).nth(3)).toContainText("질문 · “검사용 문서에서 다시 볼 질문입니다. 이 질문은 한");
  await expect(lines(page).nth(3)).toContainText("…");
  await expect(lines(page).nth(4)).toContainText("준비 안내 · AI 호출 없음");
  expect((await stored(page)).events.map(event => event.kind)).toEqual(["card", "initial", "request", "reply", "request", "reply"]);
  await expect(page.locator(".lw-transcript")).not.toContainText("끝말-질문 응답");
  await expect(chatPane(page).locator("form")).toHaveCount(1);
  // "문서에서 보기" goes back to the reply in the document without making a request or an event.
  const before = await stored(page);
  await page.evaluate(() => scrollTo(0, 0));
  await lines(page).nth(4).getByRole("button", { name: "문서에서 보기", exact: true }).click();
  await expect(secondTurn.locator(".lw-assistant-message")).toBeInViewport();
  expect(await unobscured(secondTurn.locator(".lw-assistant-message .lw-message-meta"))).toBe(true);
  expect(await stored(page)).toEqual(before);
  expect(requests).toHaveLength(2);
});

test("a response that arrives while another quiz is being worked on stays with its own quiz", async ({ page }) => {
  const requests: ArtifactLearningChatRequest[] = [];
  let release: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: reply(body, "검사용 2번에 붙어야 하는 응답") });
  });
  await page.goto("/");
  await answerChoice(page, 2, 2, "검사용 2번 첫 답");
  await expect.poll(() => !!release).toBe(true);
  await expect(card(page, 2).locator(".lw-doc-turn-status")).toContainText("응답을 기다리고 있습니다");
  await expect(page.locator(".lw-transcript .lw-waiting")).toContainText("2번 퀴즈");
  // While the reply is pending: another quiz becomes the target and gets a draft. (Where the page stays is the next test's subject.)
  const fifth = card(page, 5);
  await fifth.getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).click();
  await firstForm(page, 5).locator('input[type="radio"]').nth(0).check();
  await firstForm(page, 5).getByLabel("그 문장을 고른 까닭").fill("검사용 5번 대기 중 초안");
  await question(page).fill("검사용 5번 대기 중 질문 초안");
  await expect(firstForm(page, 5).getByRole("button", { name: "내 답 제출하고 대화하기", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "2번 응답 중단", exact: true })).toBeVisible();
  release!();
  await expect(card(page, 2).locator(".lw-assistant-message > p")).toHaveText("검사용 2번에 붙어야 하는 응답");
  await expect(card(page, 5).locator(".lw-doc-turn")).toHaveCount(0);
  await expect(fifth.getByRole("button", { name: "이 퀴즈에 질문하기", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(firstForm(page, 5).getByLabel("그 문장을 고른 까닭")).toHaveValue("검사용 5번 대기 중 초안");
  await expect(question(page)).toHaveValue("검사용 5번 대기 중 질문 초안");
  expect(requests).toHaveLength(1);
  expect(requests[0].questionId).toBe("titanic-have-2");
  const state = await stored(page);
  const second = state.artifacts.find(artifact => artifact.question.questionId === "titanic-have-2")!;
  expect(second.threads[0].turns).toHaveLength(1);
  expect(state.artifacts.find(artifact => artifact.question.questionId === "titanic-have-5")!.threads.every(thread => thread.turns.length === 0)).toBe(true);
  // The pending answer can be submitted again after the reply: the fifth quiz is answered in its own place.
  await expect(firstForm(page, 5).getByRole("button", { name: "내 답 제출하고 대화하기", exact: true })).toBeEnabled();
});

test("a reply that lands in a quiz above the reader does not move what the reader sees, even where the browser does not anchor the scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let release: (() => void) | undefined;
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: reply(body, longFeedback("위쪽 응답")) });
  });
  await page.goto("/");
  // Safari has no scroll anchoring: turn it off so the page keeps no help from the browser.
  await page.addStyleTag({ content: "html,body,main,.lw-document-flow,.lw-content-pane,.lw-content-scroll{overflow-anchor:none !important}" });
  await answerChoice(page, 1, 0, "검사용 1번 첫 답");
  await expect.poll(() => !!release).toBe(true);
  await card(page, 6).locator("h2").scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, 200));
  await page.waitForTimeout(300);
  const heading = card(page, 6).locator("h2");
  const before = await top(heading), scrollBefore = await page.evaluate(() => scrollY);
  release!();
  await expect(card(page, 1).locator(".lw-assistant-message > p")).toContainText("끝말-위쪽 응답");
  expect(Math.abs((await top(heading)) - before)).toBeLessThanOrEqual(1);
  // The page did scroll by the height that was added, which is what keeps the reader's place.
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore + 100);
});

test("the answer, the revision, the questions and the replies come back after a reload without a request", async ({ page, browser }) => {
  const requests: ArtifactLearningChatRequest[] = [];
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    requests.push(body);
    await route.fulfill({ json: reply(body, `검사용 복원 응답 ${requests.length}`) });
  });
  await page.goto("/");
  await answerChoice(page, 4, 2, "검사용 복원 4번 첫 답");
  await expect(page.getByText("검사용 복원 응답 1", { exact: true })).toBeVisible();
  await card(page, 4).getByRole("button", { name: "답을 고쳐 쓰기", exact: true }).click();
  await revisionForm(page, 4).getByLabel("내가 고친 답").fill("검사용 복원 4번 수정");
  await revisionForm(page, 4).getByRole("button", { name: "수정한 답 남기기", exact: true }).click();
  await ask(page, "검사용 복원 4번 질문");
  await expect(page.getByText("검사용 복원 응답 2", { exact: true })).toBeVisible();
  await firstForm(page, 1).getByLabel("그 문장을 고른 까닭").fill("검사용 복원 1번 미제출 초안");
  const summary = async (target: Page) => ({
    lines: await target.locator(".lw-transcript .lw-event-line > span").allTextContents(),
    quiz: await card(target, 4).locator(".lw-doc-performance, .lw-doc-thread").allInnerTexts(),
    draft: await firstForm(target, 1).getByLabel("그 문장을 고른 까닭").inputValue(),
    pressed: await card(target, 4).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).getAttribute("aria-pressed"),
  });
  const original = await summary(page);
  expect(original.lines).toHaveLength(6);
  const raw = await page.evaluate(key => localStorage.getItem(key), storageKey);
  await page.reload();
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
  expect(await summary(page)).toEqual(original);
  expect(requests).toHaveLength(2);
  await page.reload();
  expect(await summary(page)).toEqual(original);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(raw);
  // The saved v3 record also restores in a browser that never ran the lesson (a fixture), and reading it makes no request.
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const fixturePage = await context.newPage();
  let fixtureCalls = 0;
  await fixturePage.route("**/api/learn-chat/**", async route => { fixtureCalls++; await route.abort(); });
  await fixturePage.addInitScript(({ key, value }) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem(key, value); sessionStorage.setItem("seeded", "yes"); } }, { key: storageKey, value: raw! });
  await fixturePage.goto("/");
  await expect(fixturePage.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
  expect(await summary(fixturePage)).toEqual(original);
  expect(fixtureCalls).toBe(0);
  expect(await fixturePage.evaluate(key => localStorage.getItem(key), storageKey)).toBe(raw);
  await context.close();
});

test("the home's first HTML, RSC data and client scripts carry no private text of the have questions", async ({ page, request }) => {
  const quiz = (pages as { path: string; parts: { kind: string; questions?: Record<string, unknown>[] }[] }[]).find(entry => entry.path === "practice/titanic/have/")!.parts.find(part => part.kind === "quiz")!;
  const secrets = new Set<string>();
  for (const item of quiz.questions!) {
    for (const field of ["feel", "answer", "book"]) if (typeof item[field] === "string") secrets.add(item[field] as string);
    for (const option of (item.opts as { why: string }[] | undefined) || []) secrets.add(option.why);
    for (const pair of (item.fixes as string[][] | undefined) || []) for (const text of pair) secrets.add(text);
  }
  const needles = [...secrets].filter(text => text.trim().length >= 12);
  expect(needles.length).toBeGreaterThan(10);
  const home = await request.get("/");
  const html = await home.text();
  const rsc = await (await request.get("/", { headers: { RSC: "1" } })).text();
  const scripts = [...new Set([...html.matchAll(/\/_next\/static\/[^"')\s]+\.js/g)].map(match => match[0]))];
  expect(scripts.length).toBeGreaterThan(0);
  const bodies = [html, rsc, ...await Promise.all(scripts.map(async path => (await request.get(path)).text()))];
  // The have questions are public up to the options; the explanations and the model answers stay on the server.
  const leaked = needles.filter(needle => bodies.some(body => body.includes(needle) || body.includes(JSON.stringify(needle).slice(1, -1))));
  expect(leaked).toEqual([]);
  // The seven first-answer forms are in the first HTML as plain markup.
  expect((html.match(/<form\b[^>]*aria-label="[1-7]번 퀴즈 첫 답"/g) || []).length).toBe(7);
  await page.goto("/");
});

test("the quizzes, the forms and the question box are reachable without horizontal overflow at four widths", async ({ page }) => {
  await page.route("**/api/learn-chat/**", async route => {
    const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
    await route.fulfill({ json: reply(body, longFeedback("너비 검사")) });
  });
  await page.goto("/");
  await answerChoice(page, 1, 1, "검사용 너비 첫 답");
  await expect(card(page, 1).locator(".lw-assistant-message > p")).toContainText("끝말-너비 검사");
  for (const size of [{ width: 1440, height: 960 }, { width: 1100, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 430 }]) {
    await page.setViewportSize(size);
    for (const [number, target] of [[1, card(page, 1).getByRole("button", { name: "답을 고쳐 쓰기", exact: true })], [2, firstForm(page, 2).getByRole("button", { name: "내 답 제출하고 대화하기", exact: true })], [5, firstForm(page, 5).getByLabel("그 문장을 고른 까닭")], [7, firstForm(page, 7).getByLabel("내가 쓴 영어 문장")]] as const) {
      await target.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      expect(await unobscured(target), `${size.width}px, ${number}번 퀴즈`).toBe(true);
    }
    const header = card(page, 3).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true });
    await header.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
    expect(await unobscured(header), `${size.width}px 질문하기 단추`).toBe(true);
    await header.click();
    await expect(question(page)).toBeFocused();
    expect(await unobscured(question(page)), `${size.width}px 질문 칸`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), `${size.width}px 가로 넘침`).toBe(false);
  }
});
