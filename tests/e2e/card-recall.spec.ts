import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import prepJson from "../../content/prep.json";
import type { PrepData } from "../../lib/study-content-types";
import { namesExpression } from "../../lib/card-lesson";
import { noteFileText, noteStorageKey, type Note } from "../../lib/notes";
import type { LessonState } from "../../lib/lesson-workspace-state";

/**
 * The recall gate of the cards lesson: a card shows its meaning, Korean hint, blank sentence and source line and names no expression until
 * the learner gives a first answer (right or wrong). The first judgement response then carries the expression, count, sense, example and basis.
 */
const prep = prepJson as PrepData;
const units = prep.works.flatMap(work => work.units.map(unit => ({ work, unit, path: `/prep/${work.id}/unit-${unit.n}/`, lessonId: `${work.id}-unit-${unit.n}` })));
const wonder0 = units.find(item => item.lessonId === "wonder-unit-0")!;
const big = units.find(item => item.lessonId === "the-intern-unit-0")!;
const TWO = "wonder-0-12", ONE = "wonder-0-01", THIRTEEN = "wonder-0-13";
const cardOf = (id: string) => wonder0.unit.cards.find(card => card.id === id)!;
const recordKey = (lessonId: string) => `english-sense-lesson-v4:${lessonId}`;
const section = (page: Page, id: string) => page.locator(`section.cl-card[data-question-id="${id}"]`);
const blank = (page: Page, id: string, n: number) => section(page, id).getByLabel(`빈칸 ${n}`, { exact: true });
const context = (page: Page) => page.locator(".lw-reading-context");
const timeline = (page: Page) => page.getByRole("log", { name: "학습 수행과 대화" });
const ready = async (page: Page) => { await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중"); };
async function open(page: Page, item = wonder0) { await page.goto(item.path); await ready(page); }
async function submit(page: Page, id: string, inputs: string[]) {
  for (const [index, value] of inputs.entries()) await blank(page, id, index + 1).fill(value);
  await section(page, id).getByRole("button", { name: "첫 답 남기기" }).click();
}
async function stored(page: Page, lessonId = wonder0.lessonId): Promise<LessonState> {
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), recordKey(lessonId))).not.toBeNull();
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), recordKey(lessonId));
}
function countRequests(page: Page, pattern: string) { const urls: string[] = []; page.on("request", request => { if (request.url().includes(pattern)) urls.push(`${request.method()} ${request.url()}`); }); return urls; }
async function outline(page: Page) {
  const toggle = page.getByRole("button", { name: /^목차 (접기|펼치기)$/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return page.getByRole("navigation", { name: "학습 문서 목차" });
}
async function unobscured(locator: Locator) {
  return locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && !!hit && element.contains(hit);
  });
}

/**
 * Everything a learner can see, read or hear on the page, except what a closed card legitimately shows (its blank sentence, hint, meaning and
 * source line, in the document and in the chat's target): the text content, every text attribute, the page title and the meta descriptions.
 * The outline is not excluded: its entries are checked to be the card number and the meaning.
 */
async function nameableText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.body.cloneNode(true) as HTMLElement;
    root.querySelectorAll("script, style, noscript, template, .cl-drill-sentence, .cl-drill-label, .cl-kv, .cl-source, .lw-target-question, .lw-target-hint, nav[aria-label='학습 문서 목차']").forEach(node => node.remove());
    const parts: string[] = [root.textContent || "", document.title];
    document.querySelectorAll("meta[name='description'], meta[property^='og:'], meta[name^='twitter:']").forEach(meta => parts.push(meta.getAttribute("content") || ""));
    document.querySelectorAll("[aria-label], [title], [alt], [placeholder], [aria-description], [aria-roledescription], [value]").forEach(node => {
      if (node.closest("nav[aria-label='학습 문서 목차']")) return;
      for (const name of ["aria-label", "title", "alt", "placeholder", "aria-description", "aria-roledescription", "value"]) { const value = node.getAttribute(name); if (value) parts.push(value); }
    });
    // Descriptions and labels by reference are text of elements that exist; their text is in the content above, unless they are hidden.
    document.querySelectorAll("[aria-describedby], [aria-labelledby]").forEach(node => {
      for (const name of ["aria-describedby", "aria-labelledby"]) for (const id of (node.getAttribute(name) || "").split(/\s+/).filter(Boolean)) { const target = document.getElementById(id); if (target && !target.closest(".cl-drill-sentence, .cl-drill-label, .cl-kv, .cl-source")) parts.push(target.textContent || ""); }
    });
    return parts.join("\n");
  });
}

test.describe("card recall: before a first answer", () => {
  for (const item of units) {
    test(`${item.lessonId}: no expression, count, sense, example or basis shows, is read out or is named (${item.unit.cards.length} cards)`, async ({ page }) => {
      await open(page, item);
      const cards = item.unit.cards;
      await expect(page.locator("section.cl-card")).toHaveCount(cards.length);
      await expect(page.locator("section.cl-card[data-card-open='true']")).toHaveCount(0);
      await expect(page.locator(".cl-count, .cl-example, .cl-basis, .cl-opened")).toHaveCount(0);
      await expect(page.locator(".cl-kv dt")).toHaveText(cards.map(() => "뜻"));
      // Each card is its number and the meaning; the heading is the number alone.
      for (const [index, card] of cards.entries()) {
        const head = section(page, card.id).locator("h2");
        await expect(head).toHaveText(`카드 ${index + 1}`);
        await expect(section(page, card.id).locator(".cl-kv dd")).toHaveText(card.meaning);
        await expect(section(page, card.id).locator(".cl-drill-label")).toContainText(card.drill.hint);
        await expect(section(page, card.id).locator(".cl-source")).toHaveCount(1);
      }
      const nav = await outline(page);
      const entries = await nav.getByRole("link").allInnerTexts();
      expect(entries.map(text => text.replace(/\s+/g, " ").trim())).toEqual(cards.map((card, index) => `${String(index + 1).padStart(2, "0")} 카드 ${index + 1} ${card.meaning}`));
      const text = await nameableText(page);
      const named = cards.filter(card => namesExpression(text, [card.expression])).map(card => card.expression);
      expect(named, "expressions named somewhere visible before any answer").toEqual([]);
      for (const card of cards) for (const closed of [card.sense, card.basis, card.example.text]) expect(text.includes(closed), `${card.id} closed text`).toBe(false);
      // The conversation's target names no expression either.
      await section(page, cards[0].id).getByRole("button", { name: /질문하기$/ }).click();
      await expect(context(page)).toContainText("입력 대상: 카드 1");
      expect(namesExpression((await context(page).innerText()).replace(/한국어 힌트.*/s, ""), cards.map(card => card.expression))).toBe(false);
    });
  }

  test("an empty answer opens nothing and sends nothing; a question before an answer still gets the free preparation guide", async ({ page }) => {
    const requests = countRequests(page, "/api/");
    await open(page);
    await section(page, TWO).getByRole("button", { name: "첫 답 남기기" }).click();
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "false");
    expect(requests).toEqual([]);
    await section(page, TWO).getByRole("button", { name: /질문하기$/ }).click();
    await page.getByLabel("이 카드에 대해 질문하기").fill("힌트가 있나요?");
    const reply = page.waitForResponse(response => response.url().includes("/api/learn-chat/"));
    await page.getByRole("button", { name: "질문 보내기" }).click();
    const body = await (await reply).text();
    expect(JSON.parse(body)).toMatchObject({ mode: "guidance" });
    expect(body).not.toContain("pick up");
    await expect(timeline(page).locator(".lw-assistant-message")).toContainText("뜻과 한국어 힌트");
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "false");
    expect(await nameableText(page)).not.toContain("pick up");
  });
});

test.describe("card recall: the first answer opens the card", () => {
  test("a wrong first answer opens the card with the expression, count, sense, example and basis; only that card opens", async ({ page }) => {
    await open(page);
    const card = cardOf(TWO);
    const checked = page.waitForResponse(response => response.url().includes("/api/lesson-check/"));
    await submit(page, TWO, ["pick", "down"]);
    const body = JSON.parse(await (await checked).text());
    expect(body).toMatchObject({ kind: "fill", matches: [true, false], allMatch: false });
    expect(body.card).toEqual({ expression: "pick up", count: card.count, ...(card.countInPart !== undefined ? { countInPart: card.countInPart } : {}), sense: card.sense, basis: card.basis, example: card.example });
    expect(JSON.stringify(body)).not.toContain('"answers"');
    const opened = section(page, TWO);
    await expect(opened).toHaveAttribute("data-card-open", "true");
    await expect(opened.locator("h2")).toHaveText(/^pick up/);
    await expect(opened.locator(".cl-count")).toContainText(`책 전체 ${card.count}번`);
    await expect(opened.locator(".cl-kv dd")).toHaveText([card.meaning, card.sense]);
    await expect(opened.locator(".cl-example blockquote")).toHaveText(card.example.text);
    await expect(opened.locator(".cl-example figcaption")).toContainText("Wonder");
    await expect(opened.locator(".cl-basis")).toContainText(card.basis);
    await expect(opened.locator("p[role=status].lw-sr-only")).toContainText("표현·감각·예문이 열렸습니다");
    // The outline names this card now, and only this one; the conversation names it in its labels.
    const nav = await outline(page);
    await expect(nav.getByRole("link", { name: /카드 12 / })).toContainText("pick up");
    await expect(nav.getByRole("link", { name: /카드 13 / })).not.toContainText("I mean");
    await expect(nav.getByRole("link", { name: /카드 13 / })).toContainText(cardOf(THIRTEEN).meaning);
    await expect(page.locator("section.cl-card[data-card-open='true']")).toHaveCount(1);
    await expect(context(page)).toContainText("입력 대상: 카드 12 · pick up");
    await expect(timeline(page).locator(".lw-event-line").first()).toHaveText("카드 12 · pick up · 첫 답 pick / down");
    await expect(opened.getByRole("button", { name: "카드 12 · pick up 질문하기" })).toBeVisible();
    // Revising goes on as before, and the card stays open with the first copy of its text.
    await blank(page, TWO, 2).fill("up");
    await opened.getByRole("button", { name: "수정해서 다시 판정" }).click();
    await expect(opened.locator(".cl-judgement").last()).toContainText("정본 답과 같습니다.");
    const record = await stored(page);
    const [first, second] = record.artifacts[0].attempts;
    expect(first.check).toMatchObject({ kind: "fill", card: { expression: "pick up" } });
    expect(second.check?.kind === "fill" && "card" in second.check).toBe(false);
    expect(record.events.map(event => event.kind)).toEqual(["initial", "check", "revision", "check"]);
  });

  test("a right first answer opens the card too, the opened card survives a reload, and a reload sends no request", async ({ page }) => {
    await open(page);
    await submit(page, ONE, ["kind of"]);
    await expect(section(page, ONE)).toHaveAttribute("data-card-open", "true");
    await expect(section(page, ONE).locator("h2")).toHaveText(/^kind of/);
    await expect(section(page, ONE).locator(".cl-judgement")).toContainText("정본 답과 같습니다.");
    const requests = countRequests(page, "/api/");
    await page.reload();
    await ready(page);
    await expect(section(page, ONE)).toHaveAttribute("data-card-open", "true");
    await expect(section(page, ONE).locator(".cl-opened")).toContainText(cardOf(ONE).sense);
    await expect(context(page)).not.toContainText("카드 12");
    expect(requests).toEqual([]);
    const nav = await outline(page);
    await expect(nav.getByRole("link", { name: /카드 1 / })).toContainText("kind of");
    expect((await stored(page)).artifacts[0].attempts[0].check).toMatchObject({ kind: "fill", allMatch: true, card: { expression: "kind of" } });
  });

  test("a judgement that cannot be had keeps the card closed and the first answer, and judging again opens it", async ({ page }) => {
    await open(page);
    await page.route("**/api/lesson-check/**", route => route.abort());
    await submit(page, TWO, ["pick", "down"]);
    await expect(section(page, TWO).locator(".lw-judgement-failed")).toContainText("판정을 받지 못했습니다. 답은 남아 있습니다.");
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "false");
    await expect(section(page, TWO).locator(".cl-closed-note")).toContainText("판정을 받으면");
    expect(await nameableText(page)).not.toContain("pick up");
    expect((await stored(page)).artifacts[0].attempts[0]).toMatchObject({ attempt: { kind: "fill", inputs: ["pick", "down"] }, check: null });
    await page.reload();
    await ready(page);
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "false");
    await expect(blank(page, TWO, 2)).toHaveValue("down");
    await page.unroute("**/api/lesson-check/**");
    await section(page, TWO).getByRole("button", { name: "다시 판정" }).click();
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "true");
    await expect(section(page, TWO).locator("h2")).toHaveText(/^pick up/);
  });

  test("a response that arrives after the learner moved to another card opens the original card and nothing else, and the page does not move", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/lesson-check/**", async route => { await gate; await route.continue(); });
    await open(page);
    await submit(page, TWO, ["pick", "down"]);
    await expect(section(page, TWO).locator(".lw-waiting")).toBeVisible();
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "false");
    // While the judgement is pending the learner works on card 13, below the card that will open.
    await blank(page, THIRTEEN, 1).fill("x");
    await expect(context(page)).toContainText(/입력 대상: 카드 13(?!\d)/);
    // Card 13 is at the top of the screen, so the card that opens (12) is entirely above what the learner is reading.
    await section(page, THIRTEEN).locator("h2").evaluate(element => element.scrollIntoView({ block: "start" }));
    const topBefore = await section(page, THIRTEEN).locator("h2").evaluate(element => Math.round(element.getBoundingClientRect().top));
    release();
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "true");
    await expect(page.locator("section.cl-card[data-card-open='true']")).toHaveCount(1);
    await expect(section(page, THIRTEEN)).toHaveAttribute("data-card-open", "false");
    await expect(context(page)).toContainText(/입력 대상: 카드 13(?!\d)/);
    await expect(context(page)).not.toContainText("pick up");
    const topAfter = await section(page, THIRTEEN).locator("h2").evaluate(element => Math.round(element.getBoundingClientRect().top));
    expect(Math.abs(topAfter - topBefore), "the card the learner is reading stays where it was").toBeLessThanOrEqual(2);
    const record = await stored(page);
    expect(record.artifacts.find(artifact => artifact.question.questionId === TWO)!.attempts[0].check).toMatchObject({ card: { expression: "pick up" } });
    expect(record.artifacts.find(artifact => artifact.question.questionId === THIRTEEN)!.attempts).toHaveLength(0);
  });
});

/** What the app wrote before cards opened with the first answer: the full card in the snapshot and a check without `card`. */
async function makeOldRecord(page: Page) {
  await submit(page, TWO, ["pick", "down"]);
  await expect(section(page, TWO)).toHaveAttribute("data-card-open", "true");
  const card = cardOf(TWO);
  const full = { questionId: card.id, expression: card.expression, count: card.count, meaning: card.meaning, sense: card.sense, basis: card.basis, example: card.example, drill: { ...("part" in card.drill ? { part: card.drill.part } : { time: card.drill.time }), sentence: card.drill.sentence, hint: card.drill.hint, blanks: 2 } };
  await page.evaluate(([key, snapshot]) => {
    const record = JSON.parse(localStorage.getItem(key)!);
    for (const artifact of record.artifacts) { artifact.question = snapshot; for (const attempt of artifact.attempts) if (attempt.check) delete attempt.check.card; }
    localStorage.setItem(key, JSON.stringify(record));
  }, [recordKey(wonder0.lessonId), full] as const);
}

test.describe("card recall: records written before the gate", () => {
  test("an old record restores closed with an open button per judged card; the button judges the same first answer again and only the card is taken", async ({ page }) => {
    await open(page);
    await makeOldRecord(page);
    const before = await page.evaluate(key => localStorage.getItem(key), recordKey(wonder0.lessonId));
    const requests = countRequests(page, "/api/");
    await page.reload();
    await ready(page);
    expect(requests, "restoring makes no request").toEqual([]);
    expect(await page.evaluate(key => localStorage.getItem(key), recordKey(wonder0.lessonId))).toBe(before);
    const card = section(page, TWO);
    await expect(card).toHaveAttribute("data-card-open", "false");
    await expect(card.locator("h2")).toHaveText("카드 12");
    await expect(card.locator(".cl-attempt")).toContainText("down");
    await expect(card.locator(".cl-judgement")).toContainText("정본 답과 다릅니다.");
    expect(await nameableText(page), "the old snapshot's expression is not shown").not.toContain("pick up");
    await expect(card.getByRole("button", { name: "카드 내용 열기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "카드 내용 열기" })).toHaveCount(1);
    await expect(context(page)).not.toContainText("pick up");
    const sent: { action: string; attempt: unknown }[] = [];
    page.on("request", request => { if (request.url().includes("/api/lesson-check/")) sent.push(request.postDataJSON()); });
    await card.getByRole("button", { name: "카드 내용 열기" }).click();
    await expect(card).toHaveAttribute("data-card-open", "true");
    await expect(card.locator("h2")).toHaveText(/^pick up/);
    await expect(card.locator(".cl-opened")).toContainText(cardOf(TWO).sense);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: "check", attempt: { kind: "fill", inputs: ["pick", "down"] } });
    await expect(card.getByRole("button", { name: "카드 내용 열기" })).toHaveCount(0);
    const after = await stored(page);
    const was = JSON.parse(before!) as LessonState;
    expect(after.events).toEqual(was.events);
    expect(after.artifacts[0].attempts[0].attempt).toEqual(was.artifacts[0].attempts[0].attempt);
    expect(after.artifacts[0].attempts[0].check).toMatchObject({ kind: "fill", matches: [true, false], card: { expression: "pick up" } });
    await page.reload();
    await ready(page);
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "true");
    expect(sent).toHaveLength(1);
  });

  test("a failed attempt to open an old card keeps it closed and the first answer, and can be tried again", async ({ page }) => {
    await open(page);
    await makeOldRecord(page);
    await page.reload();
    await ready(page);
    await page.route("**/api/lesson-check/**", route => route.abort());
    await section(page, TWO).getByRole("button", { name: "카드 내용 열기" }).click();
    await expect(section(page, TWO).locator(".cl-card-note")).toContainText("카드 내용을 가져오지 못했습니다. 첫 답은 남아 있습니다.");
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "false");
    expect((await stored(page)).artifacts[0].attempts[0].attempt).toEqual({ kind: "fill", inputs: ["pick", "down"] });
    await page.unroute("**/api/lesson-check/**");
    await section(page, TWO).getByRole("button", { name: "카드 내용 열기" }).click();
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "true");
  });

  test("a damaged card in a stored judgement isolates that lesson's record and leaves the original text", async ({ page }) => {
    await open(page);
    await submit(page, TWO, ["pick", "down"]);
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "true");
    await page.evaluate(key => {
      const record = JSON.parse(localStorage.getItem(key)!);
      record.artifacts[0].attempts[0].check.card.sense = 7;
      localStorage.setItem(key, JSON.stringify(record));
    }, recordKey(wonder0.lessonId));
    const damaged = await page.evaluate(key => localStorage.getItem(key), recordKey(wonder0.lessonId));
    await page.reload();
    await expect(page.locator(".lw-save-warning").first()).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), recordKey(wonder0.lessonId))).toBe(damaged);
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "false");
  });
});

test.describe("card recall: notes", () => {
  const sense = cardOf(TWO).sense;
  const note = (overrides: Partial<Note>): Note => ({ id: "n1", block: `card-${TWO}-sense`, quote: sense.slice(0, 6), prefix: "", suffix: "", start: 0, mark: "yellow", memo: "닫힌 카드에 남긴 메모", createdAt: 1, ...overrides });

  test("a closed card offers nothing to note beyond its meaning and sentence; a kept note waits as a kind and memo and attaches when the card opens", async ({ page }) => {
    await page.goto(wonder0.path);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [noteStorageKey(wonder0.lessonId), noteFileText(wonder0.lessonId, [note({})])]);
    await page.reload();
    await ready(page);
    for (const field of ["sense", "example", "basis"]) await expect(page.locator(`[data-note-block="card-${TWO}-${field}"]`)).toHaveCount(0);
    await expect(page.locator(".np-seg")).toHaveCount(0);
    await page.getByRole("button", { name: "노트 1개" }).click();
    const panel = page.getByRole("dialog", { name: "노트" });
    await expect(panel.getByRole("heading", { name: "이 수업의 노트 1개" })).toBeVisible();
    await expect(panel.getByRole("heading", { name: /찾지 못한 노트/ })).toHaveCount(0);
    await expect(panel).toContainText("닫힌 카드의 노트");
    await expect(panel).toContainText("닫힌 카드에 남긴 메모");
    await expect(panel).not.toContainText(sense.slice(0, 6));
    await expect(panel).toContainText("첫 답을 낸 뒤 카드가 열리면 이동할 수 있습니다.");
    await page.keyboard.press("Escape");
    await submit(page, TWO, ["pick", "down"]);
    await expect(section(page, TWO)).toHaveAttribute("data-card-open", "true");
    await expect(page.locator(`[data-note-block="card-${TWO}-sense"] mark.np-yellow`)).toHaveCount(1);
  });
});

test("nothing says mastery, completion, score or progress, closed or open", async ({ page }) => {
  await open(page);
  const closed = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await submit(page, TWO, ["pick", "down"]);
  await expect(section(page, TWO)).toHaveAttribute("data-card-open", "true");
  await outline(page);
  const opened = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  for (const text of [closed, opened]) {
    expect(text).not.toMatch(/숙달|완료|진행률|마스터|달성|점수|정답률|정답입니다|맞습니다|축하|%/);
    expect(text).not.toMatch(/\d+\s*\/\s*\d+\s*(문제|카드|개)/);
  }
});

for (const [width, height] of [[1440, 900], [1100, 800], [390, 844], [320, 640]] as const) {
  test(`${width}px: closed and opened cards of a 22-card unit overflow nothing and the open button, inputs and chat are reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await open(page, big);
    const cards = big.unit.cards;
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    expect(await overflow()).toBe(true);
    const note = section(page, cards[20].id).locator(".cl-closed-note");
    await note.evaluate(element => element.scrollIntoView({ block: "center" }));
    expect(await unobscured(note)).toBe(true);
    const input = blank(page, cards[20].id, 1);
    await input.scrollIntoViewIfNeeded();
    expect(await unobscured(input)).toBe(true);
    // Open one card by a first answer; its text is reachable and the page still does not scroll sideways.
    await input.fill("x");
    await section(page, cards[20].id).getByRole("button", { name: "첫 답 남기기" }).click();
    await expect(section(page, cards[20].id)).toHaveAttribute("data-card-open", "true");
    const opened = section(page, cards[20].id).locator(".cl-opened");
    await opened.evaluate(element => element.scrollIntoView({ block: "center" }));
    expect(await unobscured(section(page, cards[20].id).locator(".cl-example blockquote"))).toBe(true);
    expect(await overflow()).toBe(true);
    const toggle = page.getByRole("button", { name: /^목차 (접기|펼치기)$/ });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const link = page.getByRole("navigation", { name: "학습 문서 목차" }).getByRole("link").nth(20);
    await link.scrollIntoViewIfNeeded();
    await expect(link).toContainText(cards[20].expression);
    expect(await overflow()).toBe(true);
    // The open button of an old record sits in the card and is not covered.
    const card = cards[20];
    const snapshot = { questionId: card.id, expression: card.expression, count: card.count, meaning: card.meaning, sense: card.sense, basis: card.basis, example: card.example, drill: { ...("part" in card.drill ? { part: card.drill.part } : { time: card.drill.time }), sentence: card.drill.sentence, hint: card.drill.hint, blanks: card.drill.answers.length } };
    await page.evaluate(([key, saved]) => {
      const record = JSON.parse(localStorage.getItem(key)!);
      for (const artifact of record.artifacts) { artifact.question = saved; for (const attempt of artifact.attempts) if (attempt.check) delete attempt.check.card; }
      localStorage.setItem(key, JSON.stringify(record));
    }, [recordKey(big.lessonId), snapshot] as const);
    await page.reload();
    await ready(page);
    const button = section(page, cards[20].id).getByRole("button", { name: "카드 내용 열기" });
    await button.evaluate(element => element.scrollIntoView({ block: "center" }));
    expect(await unobscured(button)).toBe(true);
    expect(await overflow()).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("the card-lesson pages' built output holds no card's expression, count, sense, example or basis, and no answers (all 13 units)", async ({ request }) => {
  const server = /(^|\/)(server|server-functions|middleware)(\/|$)|(^|\/)worker\.js$/;
  const files: { path: string; text: string }[] = [];
  const walk = (root: string, label: string, relative = ""): void => {
    for (const name of readdirSync(join(root, relative))) {
      const path = relative ? `${relative}/${name}` : name;
      if (statSync(join(root, path)).isDirectory()) { walk(root, label, path); continue; }
      const code = /\.(m?js|cjs|nft\.json|json)$/.test(name);
      // Server bundles hold the canonical data by design. What must not carry it is everything the browser or a cache serves.
      if (code && server.test(`${label}/${path}`)) continue;
      if (/\.(html|rsc|meta|segment|cache|body|txt|m?js|css)$/.test(name) || name.includes(".segments")) files.push({ path: `${label}/${path}`, text: readFileSync(join(root, path), "utf8") });
    }
  };
  for (const root of [".next/static", ".next/server/app", ".open-next/assets", ".open-next/cache"]) { try { walk(join(process.cwd(), root), root); } catch { /* a root that does not exist in this build is skipped */ } }
  expect(files.length, "the built output must be present: run npm run cf:build first").toBeGreaterThan(100);
  const escapes = (text: string) => [text, text.replaceAll("'", "&#x27;").replaceAll('"', "&quot;"), JSON.stringify(text).slice(1, -1), JSON.stringify(JSON.stringify(text)).slice(1, -1).slice(1, -1)];
  const has = (text: string, value: string) => escapes(value).some(item => text.includes(item));
  const cards = units.flatMap(({ unit }) => unit.cards);
  // The strings a card keeps closed. The expression is a short word run, so it is looked for as a key's value, not as loose text.
  const closedTexts = (card: (typeof cards)[number]) => [card.sense, card.basis, card.example.text];
  const expressionKeyed = (text: string, card: (typeof cards)[number]) => escapes(JSON.stringify(card.expression).slice(1, -1)).some(value => text.includes(`"expression":"${value}"`) || text.includes(`\\"expression\\":\\"${value}\\"`));
  const isUnitPage = (path: string) => /\/prep\/[^/]+\/unit-\d+(\.|\/)/.test(path);
  const hits: string[] = [];
  // 1. No client script or style file, anywhere, holds a closed text (they are long, distinctive strings).
  for (const file of files.filter(item => /\.(m?js|css)$/.test(item.path))) for (const card of cards) for (const closed of closedTexts(card)) if (has(file.text, closed)) hits.push(`${file.path}: ${card.id} closed text`);
  // 2. The prerendered files of the unit pages: no closed text, no expression key, no answers.
  const unitFiles = files.filter(item => isUnitPage(item.path));
  expect(unitFiles.length, "unit pages must be among the scanned files").toBeGreaterThan(30);
  for (const file of unitFiles) {
    if (file.text.includes('"answers"')) hits.push(`${file.path}: answers key`);
    for (const card of cards) {
      for (const closed of closedTexts(card)) if (has(file.text, closed)) hits.push(`${file.path}: ${card.id} closed text`);
      if (expressionKeyed(file.text, card)) hits.push(`${file.path}: ${card.id} expression key`);
    }
  }
  expect(hits).toEqual([]);
  // 3. What the server hands out for each of the 13 unit pages: the first HTML and the RSC payload.
  for (const { path, unit } of units) {
    for (const [label, headers] of [["html", {}], ["rsc", { RSC: "1" }]] as const) {
      const response = await request.get(path, { headers });
      expect(response.status(), `${path} ${label}`).toBe(200);
      const text = await response.text();
      const leaked = unit.cards.flatMap(card => [...closedTexts(card).filter(closed => has(text, closed)).map(() => `${card.id} closed text`), ...(expressionKeyed(text, card) ? [`${card.id} expression key`] : [])]);
      expect(leaked, `${path} ${label}`).toEqual([]);
      for (const key of ['"answers"', '"expression"', '"countInPart"', '"sense"', '"basis"']) expect(text.includes(key) || text.includes(key.replaceAll('"', '\\"')), `${path} ${label} has no ${key}`).toBe(false);
    }
  }
  // 4. The static list pages name no expression either: their unit summaries are counts only.
  for (const work of prep.works) {
    const text = await (await request.get(`/prep/${work.id}/`)).text();
    for (const card of work.units.flatMap(unit => unit.cards)) expect(expressionKeyed(text, card) || closedTexts(card).some(closed => has(text, closed)), `/prep/${work.id}/ ${card.id}`).toBe(false);
    expect(namesExpression(text.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "), work.units.flatMap(unit => unit.cards.map(card => card.expression))), `/prep/${work.id}/ names an expression in its visible text`).toBe(false);
  }
});
