import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import readingJson from "../../content/reading.json";
import type { ReadingData } from "../../lib/study-content-types";
import { noteFileText, noteStorageKey, noteLimits, type Note } from "../../lib/notes";

const reading = readingJson as ReadingData;
const story = reading.stories.find(item => item.id === "green-umbrella")!;
const CARD_PATH = "/prep/wonder/unit-0/", CARD_LESSON = "wonder-unit-0", TWO = "wonder-0-12";
const HAVE = "titanic-have";
const recordKey = (id: string) => id === HAVE ? "english-sense-workspace-v3" : `english-sense-lesson-v4:${id}`;
const barOf = (page: Page) => page.getByRole("toolbar", { name: /노트 도구/ });
const ready = async (page: Page) => { await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중"); };
const stored = (page: Page, lessonId: string) => page.evaluate(key => localStorage.getItem(key), noteStorageKey(lessonId));
const storedNotes = async (page: Page, lessonId: string) => (JSON.parse((await stored(page, lessonId)) || "null")?.notes ?? []) as Note[];

async function openStory(page: Page, id = story.id) { await page.goto(`/reading/${id}/`); await ready(page); }
async function startReading(page: Page) { await page.getByRole("button", { name: "읽기 시작" }).click(); await expect(page.locator(".lw-story-body")).toBeVisible(); }
async function endReading(page: Page) { await page.getByRole("button", { name: "다 읽었습니다", exact: true }).click(); await expect(page.locator(".lw-story-body")).toHaveCount(0); }
async function openCard(page: Page) { await page.goto(CARD_PATH); await ready(page); }
async function openHave(page: Page) { await page.goto("/"); await ready(page); await expect(page.getByRole("form", { name: "1번 퀴즈 첫 답" })).toBeVisible(); }

/** Selects `length` characters of a block's text from `start` (the text nodes of the block, like the learner sees them) and returns the text. */
async function select(page: Page, block: string, start: number, length: number, scroll = true) {
  const quote = await page.evaluate(({ block, start, length, scroll }) => {
    const element = document.querySelector(`[data-note-block="${block}"]`)!;
    // The learner selects what is on screen.
    const box = element.getBoundingClientRect();
    if (scroll && (box.top < 90 || box.bottom > innerHeight - 90)) element.scrollIntoView({ block: "center", behavior: "instant" });
    const nodes: Text[] = [];
    const walk = (parent: Node) => parent.childNodes.forEach(child => { if (child.nodeType === 3) nodes.push(child as Text); else if (child instanceof HTMLElement && !child.hasAttribute("data-note-skip") && !child.hasAttribute("data-note-gap")) walk(child); });
    walk(element);
    const full = nodes.map(node => node.data).join(""), end = start + length;
    const range = document.createRange();
    let position = 0, started = false;
    for (const node of nodes) {
      const next = position + node.data.length;
      if (!started && start < next) { range.setStart(node, start - position); started = true; }
      if (started && end <= next) { range.setEnd(node, end - position); break; }
      position = next;
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    return full.slice(start, end);
  }, { block, start, length, scroll });
  await expect(page.locator("[role=toolbar][data-tool=select]")).toBeVisible();
  return quote.trim();
}
const bar = (page: Page, name: string | RegExp) => barOf(page).getByRole("button", { name });
const segs = (page: Page, block: string) => page.locator(`[data-note-block="${block}"] .np-seg`);
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

async function answerAll(page: Page) {
  for (let number = 1; number <= 7; number++) {
    const form = page.getByRole("form", { name: `문제 ${number} 첫 답`, exact: true });
    await form.getByRole("radio").first().check();
    await form.getByRole("button", { name: /첫 답 남기기/ }).click();
    await expect(page.getByRole("group", { name: `문제 ${number} 서버 판정`, exact: true })).toBeVisible();
  }
}
async function answerAllFirst(page: Page, count: number) {
  for (let number = 1; number <= count; number++) {
    const form = page.getByRole("form", { name: `문제 ${number} 첫 답`, exact: true });
    await form.getByRole("radio").nth(0).check();
    await form.getByRole("button", { name: /첫 답 남기기/ }).click();
    await expect(page.getByRole("group", { name: `문제 ${number} 서버 판정`, exact: true })).toBeVisible();
  }
}
async function mockAi(page: Page) {
  const bodies: unknown[] = [];
  await page.route("**/api/learn-chat/**", async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    await route.fulfill({ json: { requestId: body.requestId, ...(body.lessonId === HAVE ? {} : { lessonId: body.lessonId }), artifactId: body.artifactId, questionId: body.questionId, contentVersion: body.contentVersion, reply: "검사용 모의 응답", mode: body.initialAttempt ? "ai" : "guidance" } });
  });
  return bodies;
}
/** A hit test: the centre of the element is the element itself, not a fixed bar. */
async function reachable(locator: Locator) {
  return locator.evaluate(element => { const box = element.getBoundingClientRect(), hit = document.elementFromPoint(Math.min(Math.max(box.left + box.width / 2, 0), innerWidth - 1), Math.min(Math.max(box.top + box.height / 2, 0), innerHeight - 1)); return !!hit && (element === hit || element.contains(hit) || hit.contains(element)); });
}
const overflowX = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);

test.describe("story", () => {
  test("underline, both highlights and a memo on the story body; they are back after a reload; the record is untouched", async ({ page }) => {
    await openStory(page);
    await startReading(page);
    const recordBefore = await page.evaluate(key => localStorage.getItem(key), recordKey(story.id));
    expect(await stored(page, story.id)).toBeNull();

    const one = await select(page, "body-0", 0, 14);
    await bar(page, "밑줄 긋기").click();
    await expect(segs(page, "body-0").first()).toHaveClass(/np-u/);
    await expect(segs(page, "body-0").first()).toHaveText(one);
    // The underline is a drawn line (an image under the text), not a text decoration or a fill.
    expect(await segs(page, "body-0").first().evaluate(element => [getComputedStyle(element).backgroundImage.startsWith("url("), getComputedStyle(element).textDecorationLine, getComputedStyle(element).backgroundColor])).toEqual([true, "none", "rgba(0, 0, 0, 0)"]);
    await expect(page.getByRole("status").filter({ hasText: "밑줄을 남겼습니다" })).toHaveCount(1);

    const two = await select(page, "body-0", 20, 10);
    await bar(page, "노란 형광펜").click();
    await expect(page.locator("[data-note-block='body-0'] mark.np-yellow")).toHaveText(two);
    const three = await select(page, "body-1", 2, 12);
    await bar(page, "분홍 형광펜").click();
    await expect(page.locator("[data-note-block='body-1'] mark.np-rose")).toHaveText(three);
    // The highlight is a fill; the text colour of the highlighted text is the text colour around it.
    const colours = await page.locator("[data-note-block='body-0'] mark.np-yellow").evaluate(element => ({ own: getComputedStyle(element).color, parent: getComputedStyle(element.parentElement!).color, background: getComputedStyle(element).backgroundColor }));
    expect(colours.own).toBe(colours.parent);
    expect(colours.background).toMatch(/^rgba\(255, 222, 64, 0\.5\)$/);

    const saved = await storedNotes(page, story.id);
    expect(saved.map(note => [note.block, note.mark, note.quote])).toEqual([["body-0", "underline", one], ["body-0", "yellow", two], ["body-1", "rose", three]]);
    expect(await page.evaluate(key => localStorage.getItem(key), recordKey(story.id))).toBe(recordBefore);

    await page.reload();
    await ready(page);
    await expect(page.locator(".lw-story-body")).toBeVisible();
    await expect(page.locator("[data-note-block='body-0'] .np-u")).toHaveText(one);
    await expect(page.locator("[data-note-block='body-0'] mark.np-yellow")).toHaveText(two);
    await expect(page.locator("[data-note-block='body-1'] mark.np-rose")).toHaveText(three);
    await expect(page.getByRole("button", { name: "노트 3개" })).toBeVisible();
    await expect(page.locator(".lw-document-toc")).toContainText("노트 3개");
  });

  test("a memo stands in the margin, can be edited and deleted, and is linked to its text", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStory(page);
    await startReading(page);
    const text = await select(page, "body-0", 4, 16);
    await bar(page, "메모 달기").click();
    const field = page.getByRole("textbox", { name: /에 달 메모/ });
    await expect(field).toBeFocused();
    await field.fill("여백에 남긴 첫 메모");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    const memo = page.locator(".np-memo", { hasText: "여백에 남긴 첫 메모" });
    await expect(memo).toBeVisible();
    await expect(page.getByRole("button", { name: "노트 1개" })).toBeVisible();
    // Wide screen: the memo is beside the paragraph, not under it.
    const geometry = await page.evaluate(() => { const block = document.querySelector("[data-note-block='body-0']")!.getBoundingClientRect(), memo = document.querySelector(".np-memo")!.getBoundingClientRect(); return { blockRight: block.right, memoLeft: memo.left, memoRight: memo.right, memoTop: memo.top, blockBottom: block.bottom, blockTop: block.top, viewport: innerWidth }; });
    expect(geometry.memoLeft).toBeGreaterThanOrEqual(geometry.blockRight);
    expect(geometry.memoRight).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.memoTop).toBeGreaterThanOrEqual(geometry.blockTop);
    expect(geometry.memoTop).toBeLessThan(geometry.blockBottom);
    // The noted text points to the memo: a pin, and the description.
    const segment = segs(page, "body-0").first();
    await expect(segment).toHaveText(text);
    await expect(segment).toHaveAttribute("data-pin", "①");
    const describedBy = await segment.getAttribute("aria-describedby");
    expect(await page.locator(`#${describedBy}`).innerText()).toContain("여백에 남긴 첫 메모");
    await expect(segment).toHaveClass(/np-memo-only/);

    await page.reload(); await ready(page);
    await expect(page.locator(".np-memo", { hasText: "여백에 남긴 첫 메모" })).toBeVisible();
    await page.getByRole("button", { name: /^메모 수정/ }).click();
    const again = page.getByRole("textbox", { name: /에 달 메모/ });
    await expect(again).toHaveValue("여백에 남긴 첫 메모");
    await again.fill("고친 메모");
    await again.press("Control+Enter");
    await expect(page.locator(".np-memo")).toContainText("고친 메모");
    expect((await storedNotes(page, story.id))[0].memo).toBe("고친 메모");
    // Escape cancels an edit.
    await page.getByRole("button", { name: /^메모 수정/ }).click();
    await page.getByRole("textbox", { name: /에 달 메모/ }).fill("버릴 글");
    await page.keyboard.press("Escape");
    await expect(page.locator(".np-memo")).toContainText("고친 메모");
    // Deleting asks first.
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: /^메모 삭제/ }).click();
    await expect(page.locator(".np-memo")).toHaveCount(1);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: /^메모 삭제/ }).click();
    await expect(page.locator(".np-memo")).toHaveCount(0);
    expect(await stored(page, story.id)).toBeNull();
  });

  test("on a narrow screen the memo is a folded line under its paragraph", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openStory(page);
    await startReading(page);
    await select(page, "body-0", 4, 16);
    await expect(bar(page, "메모 달기")).toBeVisible();
    await bar(page, "메모 달기").click();
    await page.getByRole("textbox", { name: /에 달 메모/ }).fill("좁은 화면 메모");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    const fold = page.locator("[data-note-block='body-0'] .np-fold");
    await expect(fold).toContainText("메모 1개");
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".np-memo")).toBeHidden();
    const below = await page.evaluate(() => { const block = document.querySelector("[data-note-block='body-0'] .np-fold")!.getBoundingClientRect(), text = document.querySelector("[data-note-block='body-0'] .np-seg")!.getBoundingClientRect(); return block.top >= text.bottom; });
    expect(below).toBe(true);
    // The pin still refers to a memo in the document even while it is folded.
    const describedBy = await segs(page, "body-0").first().getAttribute("aria-describedby");
    expect(await page.locator(`#${describedBy}`).textContent()).toContain("좁은 화면 메모");
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".np-memo")).toBeVisible();
    expect(await overflowX(page)).toBeLessThanOrEqual(1);
  });

  test("the notes list: count, move to a note, edit its memo, and delete", async ({ page }) => {
    await openStory(page);
    await startReading(page);
    await select(page, "body-0", 0, 10); await bar(page, "밑줄 긋기").click();
    await select(page, "body-1", 3, 12); await bar(page, "메모 달기").click();
    await page.getByRole("textbox", { name: /에 달 메모/ }).fill("목록에서 볼 메모");
    await page.keyboard.press("Control+Enter");
    await page.getByRole("button", { name: "노트 2개" }).click();
    const panel = page.getByRole("dialog", { name: "노트" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "이 수업의 노트 2개" })).toBeVisible();
    await expect(panel.locator(".np-item")).toHaveCount(2);
    await expect(panel.locator(".np-item").nth(1)).toContainText("목록에서 볼 메모");
    // Move: the page scrolls so the noted text is on screen and the text is highlighted for a moment.
    await page.mouse.wheel(0, 1);
    await panel.locator(".np-item").nth(1).getByRole("button", { name: "이동" }).click();
    await expect(panel).toHaveCount(0);
    await expect.poll(() => reachable(segs(page, "body-1").first())).toBe(true);
    await expect(segs(page, "body-1").first()).toBeFocused();
    // Back to the list: edit the memo from the list, then delete the other note.
    await page.getByRole("button", { name: "노트 2개" }).click();
    await page.getByRole("dialog", { name: "노트" }).locator(".np-item").nth(1).getByRole("button", { name: "메모 고치기" }).click();
    await expect(page.getByRole("textbox", { name: /에 달 메모/ })).toHaveValue("목록에서 볼 메모");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "노트 2개" }).click();
    await page.getByRole("dialog", { name: "노트" }).locator(".np-item").first().getByRole("button", { name: "지우기" }).click();
    await expect(page.getByRole("dialog", { name: "노트" }).getByRole("heading", { name: "이 수업의 노트 1개" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "노트 1개" })).toBeFocused();
    expect((await storedNotes(page, story.id)).map(note => note.block)).toEqual(["body-1"]);
  });

  test("a mark is cleared from the text itself", async ({ page }) => {
    await openStory(page);
    await startReading(page);
    await select(page, "body-0", 0, 10);
    await bar(page, "노란 형광펜").click();
    // The tool turns into the tool of the new mark; leave it, then click the mark.
    await page.keyboard.press("Escape");
    await expect(barOf(page)).toHaveCount(0);
    await segs(page, "body-0").first().click();
    await expect(barOf(page)).toBeVisible();
    await expect(barOf(page)).toContainText("노란 형광펜");
    await barOf(page).getByRole("button", { name: "표시 지우기" }).click();
    await expect(page.locator("mark.np-yellow")).toHaveCount(0);
    await expect(page.locator(".np-seg")).toHaveCount(0);
    expect(await stored(page, story.id)).toBeNull();
    // A marked text with a memo keeps the memo when only the mark is cleared.
    await select(page, "body-0", 0, 10);
    await bar(page, "밑줄 긋기").click();
    await barOf(page).getByRole("button", { name: "메모 달기" }).click();
    await page.getByRole("textbox", { name: /에 달 메모/ }).fill("표시를 지워도 남는 메모");
    await page.keyboard.press("Control+Enter");
    await segs(page, "body-0").first().click();
    await barOf(page).getByRole("button", { name: "표시 지우기" }).click();
    await expect(segs(page, "body-0").first()).toHaveClass(/np-memo-only/);
    expect((await storedNotes(page, story.id)).map(note => [note.mark, note.memo])).toEqual([["none", "표시를 지워도 남는 메모"]]);
  });

  test("keyboard: a selection made with the keys is reached with Alt+Shift+N, and the list opens from the toolbar", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path");
    await openStory(page);
    await startReading(page);
    // A selection made with a screen reader or caret browsing is a selection like any other; extend it with the keys.
    await select(page, "body-0", 0, 3);
    for (let step = 0; step < 6; step++) await page.keyboard.press("Shift+ArrowRight");
    await expect(barOf(page)).toBeVisible();
    await page.keyboard.press("Alt+Shift+KeyN");
    await expect(bar(page, "밑줄 긋기")).toBeFocused();
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
    await expect(bar(page, "분홍 형광펜")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("mark.np-rose")).toHaveCount(1);
    // The tool of the new mark keeps the keyboard focus on its first button.
    await expect(barOf(page).getByRole("button").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(barOf(page)).toHaveCount(0);
    // Without a selection the shortcut opens the list.
    await page.keyboard.press("Alt+Shift+KeyN");
    await expect(page.getByRole("dialog", { name: "노트" })).toBeVisible();
    await page.keyboard.press("Escape");
    // The list also takes a selection: select, press the toolbar button, choose in the list.
    await select(page, "body-1", 0, 12);
    await page.getByRole("button", { name: "노트 1개" }).focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "노트" });
    await expect(panel.getByRole("heading", { name: "선택한 글" })).toBeVisible();
    await panel.getByRole("button", { name: "노란 형광펜" }).click();
    await expect(page.locator("[data-note-block='body-1'] mark.np-yellow")).toHaveCount(1);
    await expect(panel.getByRole("heading", { name: "이 수업의 노트 2개" })).toBeVisible();
    // Marks are told apart without colour: a line for the underline, a fill for the highlight, a dotted line for a memo alone.
    const fills = await page.evaluate(() => [...document.querySelectorAll("mark.np-rose, mark.np-yellow")].map(element => getComputedStyle(element).backgroundColor));
    expect(fills).toHaveLength(2);
    expect(new Set(fills).size).toBe(2);
    for (const fill of fills) expect(fill).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("the selection tool does not move the reader: no scroll, no focus change, nothing in the record or AI requests", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", request => { if (request.url().includes("/api/")) requests.push(request.url()); });
    await openStory(page);
    await startReading(page);
    await page.evaluate(() => window.scrollTo(0, 260));
    const top = () => page.locator(".lw-reading-zone h2").evaluate(element => Math.round(element.getBoundingClientRect().top));
    const before = await top(), y = await page.evaluate(() => scrollY), focus = await page.evaluate(() => document.activeElement?.tagName);
    const recordBefore = await page.evaluate(key => localStorage.getItem(key), recordKey(story.id));
    await select(page, "body-1", 0, 20, false);
    expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(focus);
    await bar(page, "노란 형광펜").click();
    await page.keyboard.press("Escape");
    expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => scrollY)).toBe(y);
    expect(await page.evaluate(key => localStorage.getItem(key), recordKey(story.id))).toBe(recordBefore);
    expect(requests).toEqual([]);
  });

  test("while the body is covered no note can be made and the list shows only the kind and the memo; checking the body brings the notes back", async ({ page }) => {
    await openStory(page);
    await startReading(page);
    const underlined = await select(page, "body-0", 0, 16); await bar(page, "밑줄 긋기").click();
    const memoText = await select(page, "body-1", 0, 16); await bar(page, "메모 달기").click();
    await page.getByRole("textbox", { name: /에 달 메모/ }).fill("가린 뒤에도 보이는 메모");
    await page.keyboard.press("Control+Enter");
    await endReading(page);
    // The covered body leaves no noted text and no tool.
    await expect(page.locator("[data-note-block^='body-']")).toHaveCount(0);
    const covered = page.locator(".np-covered");
    await expect(covered.locator("summary")).toContainText("본문에 단 노트 2개");
    await covered.locator("summary").click();
    await expect(covered).toContainText("밑줄");
    await expect(covered).toContainText("가린 뒤에도 보이는 메모");
    const pageText = flat(await page.locator("main").innerText());
    expect(pageText).not.toContain(flat(underlined));
    expect(pageText).not.toContain(flat(memoText));
    // The list in the dialog is redacted too, and moving to a covered text is not offered.
    await page.getByRole("button", { name: "노트 2개" }).click();
    const panel = page.getByRole("dialog", { name: "노트" });
    await expect(panel).toContainText("본문 노트");
    await expect(panel).toContainText("가린 뒤에도 보이는 메모");
    expect(flat(await panel.innerText())).not.toContain(flat(underlined));
    expect(flat(await panel.innerText())).not.toContain(flat(memoText));
    await expect(panel.getByRole("button", { name: "이동" }).first()).toBeDisabled();
    await page.keyboard.press("Escape");
    // Questions are public text: a note can be made on a question again (the body is still covered).
    const ask = `q-${story.questions[0].id}-ask`;
    await select(page, ask, 0, 8);
    await bar(page, "밑줄 긋기").click();
    await expect(segs(page, ask).first()).toHaveClass(/np-u/);
    // After all first answers the body can be checked and the notes are in the text again.
    await answerAll(page);
    await page.getByRole("button", { name: "본문 확인하기" }).click();
    await expect(page.locator("[data-note-block='body-0'] .np-u")).toHaveText(underlined);
    await expect(page.locator("[data-note-block='body-1'] .np-memo-only")).toHaveText(memoText);
    await expect(covered).toHaveCount(0);
    await page.getByRole("button", { name: "본문 가리기" }).click();
    await expect(page.locator("[data-note-block^='body-']")).toHaveCount(0);
    await expect(page.locator(".np-covered summary")).toContainText("본문에 단 노트 2개");
  });

  test("a note made on the question text is not sent to the AI, and neither is any memo", async ({ page }) => {
    const bodies = await mockAi(page);
    await openStory(page);
    await startReading(page);
    await select(page, "body-0", 0, 14); await bar(page, "메모 달기").click();
    await page.getByRole("textbox", { name: /에 달 메모/ }).fill("AI에는 가면 안 되는 메모 MEMO-SECRET");
    await page.keyboard.press("Control+Enter");
    await endReading(page);
    const ask = `q-${story.questions[0].id}-ask`, quote = await select(page, ask, 0, 10);
    await bar(page, "노란 형광펜").click();
    await page.getByRole("button", { name: "이 문제에 질문하기" }).first().click();
    await page.getByRole("textbox", { name: "이 문제에 대해 질문하기" }).fill("검사용 질문입니다");
    await page.getByRole("button", { name: /^보내기|질문 보내기|보내기$/ }).first().click();
    await expect(page.getByText("검사용 모의 응답")).toBeVisible();
    expect(bodies).toHaveLength(1);
    const text = JSON.stringify(bodies);
    expect(text).not.toContain("MEMO-SECRET");
    expect(text).not.toContain("np-");
    expect(text).not.toContain("english-sense-notes");
    void quote;
  });
});

test.describe("pointer and document", () => {
  test("a word selected with the mouse opens the tool; a click elsewhere closes it; the hydration is clean", async ({ page, isMobile }) => {
    test.skip(isMobile, "mouse path");
    const problems: string[] = [];
    page.on("console", message => { if (message.type() === "error" && /hydrat|#418|#423|#425|Minified React/i.test(message.text())) problems.push(message.text()); });
    page.on("pageerror", error => problems.push(error.message));
    await openStory(page);
    await startReading(page);
    const word = await page.evaluate(() => {
      const paragraph = document.querySelector("[data-note-block='body-0']")!, text = paragraph.firstChild as Text, at = text.data.indexOf("raining");
      const range = document.createRange(); range.setStart(text, at); range.setEnd(text, at + 7);
      const box = range.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await page.mouse.dblclick(word.x, word.y);
    await expect(barOf(page)).toBeVisible();
    await bar(page, "노란 형광펜").click();
    await expect(page.locator("mark.np-yellow")).toHaveText("raining");
    await page.keyboard.press("Escape");
    // A plain click on other text closes a tool that is open.
    await page.mouse.dblclick(word.x - 90, word.y);
    await expect(page.locator("[role=toolbar][data-tool=select]")).toBeVisible();
    await page.locator(".lw-document-heading h2").click();
    await expect(barOf(page)).toHaveCount(0);
    await page.reload(); await ready(page);
    await expect(page.locator("mark.np-yellow")).toHaveText("raining");
    expect(problems).toEqual([]);
  });

  test("a selection across two paragraphs marks the part in the first one", async ({ page }) => {
    await openStory(page);
    await startReading(page);
    const picked = await page.evaluate(() => {
      const first = document.querySelector("[data-note-block='body-0']")!.firstChild as Text, second = document.querySelector("[data-note-block='body-1']")!.firstChild as Text;
      first.parentElement!.scrollIntoView({ block: "center" });
      const range = document.createRange(); range.setStart(first, 10); range.setEnd(second, 6);
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
      return first.data.slice(10).trim();
    });
    await expect(page.locator("[role=toolbar][data-tool=select]")).toBeVisible();
    await bar(page, "밑줄 긋기").click();
    const saved = await storedNotes(page, story.id);
    expect(saved).toHaveLength(1);
    expect(saved[0].block).toBe("body-0");
    expect(saved[0].quote).toBe(picked);
    await expect(page.locator("[data-note-block='body-1'] .np-seg")).toHaveCount(0);
  });

  test("the reading position and the outline still work with notes in the text", async ({ page }) => {
    await page.goto(CARD_PATH); await ready(page);
    const section = (id: string) => page.locator(`section.cl-card[data-question-id="${id}"]`);
    await select(page, `card-${TWO}-meaning`, 0, 4); await bar(page, "메모 달기").click();
    await page.getByRole("textbox", { name: /에 달 메모/ }).fill("위치를 확인하는 메모");
    await page.keyboard.press("Control+Enter");
    const toggle = page.getByRole("button", { name: /^목차 (접기|펼치기)$/ });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await page.getByRole("navigation", { name: "학습 문서 목차" }).getByRole("link", { name: /카드 13 / }).click();
    const topOf = (id: string) => section(id).evaluate(element => Math.round(element.getBoundingClientRect().top));
    await expect.poll(() => topOf("wonder-0-13")).toBeLessThan(260);
    expect(await topOf("wonder-0-13")).toBeGreaterThan(-10);
    await page.reload(); await ready(page);
    // The restored reading anchor is the card the learner left at, not a place moved by the margin note above.
    await expect.poll(() => topOf("wonder-0-13")).toBeLessThan(260);
    expect(await topOf("wonder-0-13")).toBeGreaterThan(-10);
    await expect(page.locator(".np-memo, .np-fold").first()).toBeAttached();
  });

  test("options of a question take notes after the first answer", async ({ page }) => {
    await openStory(page);
    await startReading(page);
    await endReading(page);
    await answerAllFirst(page, 1);
    const option = `q-${story.questions[0].id}-o1`;
    await select(page, option, 0, 3);
    await bar(page, "분홍 형광펜").click();
    await expect(page.locator(`[data-note-block="${option}"] mark.np-rose`)).toHaveCount(1);
    // The tag next to the option is not part of its text.
    await expect(page.locator(`[data-note-block="${option}"] .lw-option-tag`)).toHaveAttribute("data-note-skip");
    const raw = await storedNotes(page, story.id);
    expect(raw[0].quote).not.toContain("내 첫 답");
  });
});

test.describe("cards", () => {
  test("notes on the meaning and the blank sentence; the sense, example and basis take notes only once the first answer opened the card", async ({ page }) => {
    await openCard(page);
    const card = (field: string) => `card-${TWO}-${field}`;
    const closed = page.locator(`section.cl-card[data-question-id="${TWO}"]`);
    // A closed card has no sense, example or basis on the page, so there is nothing to put a note on.
    for (const field of ["sense", "example", "basis"]) await expect(page.locator(`[data-note-block="${card(field)}"]`)).toHaveCount(0);
    await select(page, card("meaning"), 0, 4);
    await bar(page, "밑줄 긋기").click();
    await expect(segs(page, card("meaning")).first()).toHaveClass(/np-u/);
    await page.keyboard.press("Escape");
    // The blank sentence: a selection across the first blank.
    const sentenceQuote = await page.evaluate(id => {
      const element = document.querySelector(`[data-note-block="${id}"]`)!;
      const first = element.firstChild as Text, last = element.lastChild as Text;
      const range = document.createRange(); range.setStart(first, 0); range.setEnd(last, last.data.length);
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
      return element.textContent;
    }, card("sentence"));
    await expect(barOf(page)).toBeVisible();
    await bar(page, "노란 형광펜").click();
    const marks = page.locator(`[data-note-block="${card("sentence")}"] mark.np-yellow`);
    expect(await marks.count()).toBeGreaterThanOrEqual(2);
    // The blanks are still inputs inside the sentence; typing in one changes neither the note nor the record of notes.
    const input = closed.getByLabel("빈칸 1", { exact: true });
    const before = await stored(page, CARD_LESSON);
    await input.fill("pick");
    await expect(input).toHaveValue("pick");
    expect(await stored(page, CARD_LESSON)).toBe(before);
    // The first answer (wrong or right) opens the card; only then its sense, example and basis are text a note can sit on.
    await closed.getByLabel("빈칸 2", { exact: true }).fill("down");
    await closed.getByRole("button", { name: "첫 답 남기기" }).click();
    await expect(closed).toHaveAttribute("data-card-open", "true");
    for (const [field, start, length] of [["sense", 0, 6], ["example", 0, 10], ["basis", 4, 6]] as const) {
      await select(page, card(field), start, length);
      await bar(page, "밑줄 긋기").click();
      await expect(segs(page, card(field)).first()).toHaveClass(/np-u/);
      await page.keyboard.press("Escape");
    }
    expect((await storedNotes(page, CARD_LESSON)).map(note => note.block)).toEqual([card("meaning"), card("sentence"), card("sense"), card("example"), card("basis")]);
    await page.reload(); await ready(page);
    for (const field of ["meaning", "sense", "example", "basis"]) await expect(segs(page, card(field)).first()).toHaveClass(/np-u/);
    expect(await page.locator(`[data-note-block="${card("sentence")}"] mark.np-yellow`).count()).toBeGreaterThanOrEqual(2);
    await expect(input).toHaveValue("pick");
    expect(sentenceQuote).toContain("My mom can");
  });

  test("the tool does not open for text inside an input or the question box", async ({ page }) => {
    await openCard(page);
    const input = page.locator(`section.cl-card[data-question-id="${TWO}"]`).getByLabel("빈칸 1", { exact: true });
    await input.fill("pick up the");
    await input.selectText();
    await page.waitForTimeout(400);
    await expect(barOf(page)).toHaveCount(0);
    await page.locator(`section.cl-card[data-question-id="${TWO}"]`).getByRole("button", { name: /질문하기$/ }).click();
    const box = page.getByRole("textbox", { name: "이 카드에 대해 질문하기" });
    await box.fill("질문 칸의 글입니다");
    await box.selectText();
    await page.waitForTimeout(400);
    await expect(barOf(page)).toHaveCount(0);
    // Text of the conversation is not a note block either.
    await page.evaluate(() => { const target = document.querySelector(".lw-chat-pane .lw-input-context p")!; const range = document.createRange(); range.selectNodeContents(target); getSelection()!.removeAllRanges(); getSelection()!.addRange(range); });
    await page.waitForTimeout(400);
    await expect(barOf(page)).toHaveCount(0);
  });

  test("a note on an outdated card is not offered and the old record stays read-only", async ({ page }) => {
    // The card text on screen is the current one; a stored note whose text no longer exists is listed apart and kept.
    await page.goto(CARD_PATH); await ready(page);
    const lost: Note = { id: "lost1", block: `card-${TWO}-meaning`, quote: "이 문구는 이제 자료에 없습니다", prefix: "", suffix: "", start: 0, mark: "yellow", memo: "옛 판에 남긴 메모", createdAt: 1 };
    const gone: Note = { id: "lost2", block: "card-removed-card-basis", quote: "사라진 카드의 글", prefix: "", suffix: "", start: 0, mark: "none", memo: "카드가 없어진 노트", createdAt: 2 };
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [noteStorageKey(CARD_LESSON), noteFileText(CARD_LESSON, [lost, gone])]);
    await page.reload(); await ready(page);
    await expect(page.locator(".np-seg")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "노트 2개" })).toBeVisible();
    await page.getByRole("button", { name: "노트 2개" }).click();
    const panel = page.getByRole("dialog", { name: "노트" });
    await expect(panel.getByRole("heading", { name: "이 글을 찾지 못한 노트 2개" })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "이 수업의 노트 0개" })).toBeVisible();
    await expect(panel).toContainText("이 문구는 이제 자료에 없습니다");
    await expect(panel).toContainText("옛 판에 남긴 메모");
    await expect(panel.locator(".np-item[data-found='false']")).toHaveCount(2);
    await expect(panel.locator(".np-item[data-found='false']").getByRole("button", { name: "이동" })).toHaveCount(0);
    expect((await storedNotes(page, CARD_LESSON)).map(note => note.id)).toEqual(["lost1", "lost2"]);
    // Reading and reloading change nothing in the stored file.
    const raw = await stored(page, CARD_LESSON);
    await page.keyboard.press("Escape"); await page.reload(); await ready(page);
    expect(await stored(page, CARD_LESSON)).toBe(raw);
    // A lost note can be deleted by the learner, with a confirmation.
    await page.getByRole("button", { name: "노트 2개" }).click();
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("dialog", { name: "노트" }).locator(".np-item").first().getByRole("button", { name: "지우기" }).click();
    await expect(page.getByRole("dialog", { name: "노트" }).getByRole("heading", { name: "이 글을 찾지 못한 노트 1개" })).toBeVisible();
  });
});

test.describe("have", () => {
  test("notes on the scene text, the question, the source and the material of the home lesson", async ({ page }) => {
    await openHave(page);
    const quiz = "have-titanic-have-1";
    await select(page, `${quiz}-scene`, 0, 12); await bar(page, "노란 형광펜").click();
    await select(page, `${quiz}-ask`, 0, 4); await bar(page, "밑줄 긋기").click();
    await select(page, `${quiz}-source`, 0, 8); await bar(page, "분홍 형광펜").click();
    await page.keyboard.press("Escape");
    await select(page, "mat-have-desc", 0, 6); await bar(page, "메모 달기").click();
    await page.getByRole("textbox", { name: /에 달 메모/ }).fill("자료에 쓴 메모");
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".lw-scene-text mark.np-yellow")).toHaveCount(1);
    await expect(page.locator(".lw-material-explanation .np-memo-only")).toHaveCount(1);
    // The source line keeps its break and its citation.
    await expect(page.locator(".lw-source").first().locator("br")).toHaveCount(1);
    await expect(page.locator(".lw-source").first().locator("cite")).toHaveCount(1);
    expect((await storedNotes(page, HAVE)).map(note => note.block)).toEqual([`${quiz}-scene`, `${quiz}-ask`, `${quiz}-source`, "mat-have-desc"]);
    const recordBefore = await page.evaluate(key => localStorage.getItem(key), recordKey(HAVE));
    await page.reload(); await ready(page);
    await expect(page.locator(".lw-scene-text mark.np-yellow")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "노트 4개" })).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), recordKey(HAVE))).toBe(recordBefore);
    // A material example (no id in the markup) takes a note too.
    await select(page, "mat-have-z0-ex", 0, 5); await bar(page, "밑줄 긋기").click();
    await expect(page.locator(".lw-material-example .np-u")).toHaveCount(1);
  });

  test("the first answer, the conversation and the outline work with notes in the text", async ({ page }) => {
    const bodies = await mockAi(page);
    await openHave(page);
    const quiz = "have-titanic-have-1";
    await select(page, `${quiz}-scene`, 0, 10); await bar(page, "메모 달기").click();
    await page.getByRole("textbox", { name: /에 달 메모/ }).fill("HAVE-MEMO");
    await page.keyboard.press("Control+Enter");
    const form = page.getByRole("form", { name: "1번 퀴즈 첫 답" });
    await form.locator('input[type="radio"]').first().check();
    await form.getByLabel("그 문장을 고른 까닭").fill("이유");
    await form.getByRole("button", { name: "내 답 제출하고 대화하기", exact: true }).click();
    await expect(page.getByText("검사용 모의 응답").first()).toBeVisible();
    expect(bodies).toHaveLength(1);
    expect(JSON.stringify(bodies)).not.toContain("HAVE-MEMO");
    if (await page.locator(".np-fold").first().isVisible()) await page.locator(".np-fold").first().click();
    await expect(page.locator(".np-memo", { hasText: "HAVE-MEMO" })).toBeVisible();
    // The reading position still moves by the outline.
    const toggle = page.getByRole("button", { name: /^목차 (접기|펼치기)$/ });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await page.getByRole("navigation", { name: "학습 문서 목차" }).getByRole("link").nth(3).click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
  });
});

test.describe("storage", () => {
  test("an unreadable notes file loses only that lesson's notes, with a notice; other lessons and the record are untouched", async ({ page }) => {
    const other = reading.stories.find(item => item.id !== story.id)!;
    await openStory(page, other.id);
    await startReading(page);
    await select(page, "body-0", 0, 10); await bar(page, "밑줄 긋기").click();
    const otherRaw = await stored(page, other.id);
    expect(otherRaw).not.toBeNull();
    await page.goto(`/reading/${story.id}/`); await ready(page);
    await page.evaluate(([key, noteKey]) => { localStorage.setItem(key, JSON.stringify({ v: 1, lesson: "x", notes: "no" })); localStorage.setItem(noteKey, "{broken"); }, [noteStorageKey(story.id), noteStorageKey("another")]);
    await startReading(page);
    const recordRaw = await page.evaluate(key => localStorage.getItem(key), recordKey(story.id));
    await page.reload(); await ready(page);
    await expect(page.locator(".np-banner")).toContainText("저장된 노트를 읽지 못했습니다");
    await expect(page.locator(".np-banner")).toContainText("이 수업의 노트만 비우고");
    await expect(page.locator(".np-seg")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "노트", exact: true })).toBeVisible();
    // Nothing else was touched.
    expect(await stored(page, other.id)).toBe(otherRaw);
    expect(await page.evaluate(key => localStorage.getItem(key), recordKey(story.id))).toBe(recordRaw);
    expect(await page.evaluate(key => localStorage.getItem(key), noteStorageKey("another"))).toBe("{broken");
    await page.getByRole("button", { name: "알겠습니다" }).click();
    await expect(page.locator(".np-banner")).toHaveCount(0);
    // The lesson works again: the next note replaces the unreadable file.
    await select(page, "body-0", 0, 10); await bar(page, "밑줄 긋기").click();
    expect((await storedNotes(page, story.id)).length).toBe(1);
    // The other lesson still has its note.
    await page.goto(`/reading/${other.id}/`); await ready(page);
    await expect(page.locator("[data-note-block='body-0'] .np-u")).toHaveCount(1);
  });

  test("a failed save shows a warning at the notes and in the status line, keeps the notes on screen and retries", async ({ page }) => {
    await openStory(page);
    await startReading(page);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as unknown as { __failNotes: boolean; __original: typeof original }).__failNotes = true;
      Storage.prototype.setItem = function (key: string, value: string) { if (key.startsWith("english-sense-notes-v1:") && (window as unknown as { __failNotes: boolean }).__failNotes) throw new DOMException("full", "QuotaExceededError"); return original.call(this, key, value); };
    });
    await select(page, "body-0", 0, 10);
    await bar(page, "밑줄 긋기").click();
    await expect(page.locator(".np-u")).toHaveCount(1);
    await expect(page.locator(".lw-session-status")).toContainText("노트 저장 실패");
    await expect(page.locator(".np-banner")).toContainText("노트를 저장하지 못했습니다");
    await expect(barOf(page)).toContainText("저장 다시 시도");
    expect(await stored(page, story.id)).toBeNull();
    // The memo editor shows it next to the input.
    await select(page, "body-1", 0, 10);
    await bar(page, "메모 달기").click();
    await expect(page.locator(".np-edit .np-save")).toBeVisible();
    await page.getByRole("textbox", { name: /에 달 메모/ }).fill("저장 실패 중에도 화면에는 남는 메모");
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".np-memo")).toContainText("저장 실패 중에도");
    // The record of the lesson still saves (a different key).
    expect(await page.evaluate(key => localStorage.getItem(key), recordKey(story.id))).not.toBeNull();
    await page.evaluate(() => { (window as unknown as { __failNotes: boolean }).__failNotes = false; });
    await page.locator(".np-banner").getByRole("button", { name: "저장 다시 시도" }).click();
    await expect(page.locator(".np-banner")).toHaveCount(0);
    await expect(page.locator(".lw-session-status")).not.toContainText("노트 저장 실패");
    expect((await storedNotes(page, story.id)).length).toBe(2);
  });

  test("limits: 200 notes per lesson and 500 characters per memo", async ({ page }) => {
    await openStory(page);
    await startReading(page);
    const seed: Note[] = Array.from({ length: noteLimits.notes }, (_, index) => ({ id: `seed${index}`, block: "body-9", quote: `seed ${index}`, prefix: "", suffix: "", start: 0, mark: "underline", memo: "", createdAt: index + 1 }));
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [noteStorageKey(story.id), noteFileText(story.id, seed)]);
    await page.reload(); await ready(page);
    await expect(page.getByRole("button", { name: "노트 200개" })).toBeVisible();
    await select(page, "body-0", 0, 10);
    await bar(page, "밑줄 긋기").click();
    await expect(barOf(page)).toContainText("한 수업에 200개까지");
    expect((await storedNotes(page, story.id)).length).toBe(200);
    await bar(page, "메모 달기").click();
    await expect(barOf(page)).toContainText("한 수업에 200개까지");
    await expect(page.locator(".np-edit")).toHaveCount(0);
    // Make room, then a memo is cut at 500 characters.
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [noteStorageKey(story.id), noteFileText(story.id, seed.slice(0, 5))]);
    await page.reload(); await ready(page);
    await select(page, "body-0", 0, 10);
    await bar(page, "메모 달기").click();
    const field = page.getByRole("textbox", { name: /에 달 메모/ });
    await field.fill("가".repeat(600));
    expect(await field.inputValue()).toHaveLength(500);
    await expect(page.locator(".np-count")).toHaveText("500 / 500");
    await page.keyboard.press("Control+Enter");
    expect((await storedNotes(page, story.id)).at(-1)!.memo).toHaveLength(500);
  });

  test("reading the notes makes no request and no event; the first HTML has no notes", async ({ page, request }) => {
    await page.goto(CARD_PATH); await ready(page);
    const seed: Note[] = [{ id: "a1", block: `card-${TWO}-meaning`, quote: "x", prefix: "", suffix: "", start: 0, mark: "yellow", memo: "", createdAt: 1 }];
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [noteStorageKey(CARD_LESSON), noteFileText(CARD_LESSON, seed)]);
    const urls: string[] = [];
    page.on("request", item => { if (item.url().includes("/api/")) urls.push(item.url()); });
    const recordBefore = await page.evaluate(key => localStorage.getItem(key), recordKey(CARD_LESSON));
    await page.reload(); await ready(page);
    expect(urls).toEqual([]);
    expect(await page.evaluate(key => localStorage.getItem(key), recordKey(CARD_LESSON))).toBe(recordBefore);
    for (const path of [CARD_PATH, `/reading/${story.id}/`, "/"]) {
      const html = await (await request.get(path)).text();
      expect(html).not.toMatch(/np-seg|np-memo|np-margin|np-u\b|english-sense-notes/);
    }
  });
});

test.describe("layout", () => {
  for (const width of [320, 390, 1100, 1440]) {
    test(`${width}px: no horizontal overflow, the tool and a memo are reachable and do not cover the selection`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 700 ? 800 : 900 });
      await openStory(page);
      await startReading(page);
      await select(page, "body-0", 0, 30);
      const tool = await page.evaluate(() => {
        const bar = document.querySelector("[role=toolbar]")!.getBoundingClientRect(), range = getSelection()!.getRangeAt(0).getBoundingClientRect();
        return { left: bar.left, right: bar.right, top: bar.top, bottom: bar.bottom, overlaps: !(bar.bottom <= range.top || bar.top >= range.bottom || bar.right <= range.left || bar.left >= range.right), width: innerWidth, height: innerHeight };
      });
      expect(tool.left).toBeGreaterThanOrEqual(0);
      expect(tool.right).toBeLessThanOrEqual(tool.width + 0.5);
      expect(tool.bottom).toBeLessThanOrEqual(tool.height + 0.5);
      expect(tool.overlaps).toBe(false);
      for (const button of await barOf(page).getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(40);
        expect(box.width).toBeGreaterThanOrEqual(44 - 1);
        expect(await reachable(button)).toBe(true);
      }
      await bar(page, "메모 달기").click();
      await page.getByRole("textbox", { name: /에 달 메모/ }).fill("가로 넘침을 확인하는 조금 긴 메모입니다 ".repeat(4));
      await page.keyboard.press("Control+Enter");
      expect(await overflowX(page)).toBeLessThanOrEqual(1);
      const scroller = await page.locator(".lw-content-scroll").evaluate(element => element.scrollWidth - element.clientWidth);
      expect(scroller).toBeLessThanOrEqual(1);
      if (width >= 1360) {
        const memo = page.locator(".np-memo");
        await expect(memo).toBeVisible();
        const inside = await memo.evaluate(element => { const box = element.getBoundingClientRect(); return box.right <= innerWidth && box.left >= 0; });
        expect(inside).toBe(true);
      } else {
        await page.locator(".np-fold").click();
        const inside = await page.locator(".np-memo").evaluate(element => { const box = element.getBoundingClientRect(); return box.right <= innerWidth && box.left >= 0; });
        expect(inside).toBe(true);
      }
      // The toolbar button is reachable on every width.
      expect(await reachable(page.getByRole("button", { name: "노트 1개" }))).toBe(true);
      await page.getByRole("button", { name: "노트 1개" }).click();
      const dialog = page.getByRole("dialog", { name: "노트" });
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
    });
  }
});
