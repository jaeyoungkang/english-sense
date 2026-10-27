import { test, expect, type Page } from "@playwright/test";
import readingJson from "../../content/reading.json";
import { levelLimitSeconds, readingLevels, type ReadingLevel } from "../../lib/reading-level";
import { clockLabel } from "../../lib/study-content";
import type { ReadingData } from "../../lib/study-content-types";

const reading = readingJson as ReadingData;
const story = reading.stories.find(item => item.id === "green-umbrella")!;
const key = (id: string) => `english-sense-lesson-v4:${id}`;
const letter = (index: number) => String.fromCharCode(65 + index);
const MASTERY = /숙달|완료|진행률|정답률|점수|달성|성공|%/;
type Rec = {
  events: { kind: string; level?: string; limitSeconds?: number; startedAt?: number; endedAt?: number; by?: string; elapsedMs?: number }[];
  artifacts: { attempts: { check: { match?: boolean } | null }[] }[];
};
const record = (page: Page, id = story.id) => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) || "null"), key(id)) as Promise<Rec | null>;

async function open(page: Page, id = story.id) {
  await page.goto(`/reading/${id}/`);
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
}
const levelRadio = (page: Page, label: string) => page.getByRole("radio", { name: new RegExp(`^${label}`) });
async function start(page: Page, label?: string) {
  if (label) await levelRadio(page, label).check();
  await page.getByRole("button", { name: "읽기 시작" }).click();
  await expect(page.locator(".lw-story-body")).toBeVisible();
}
const finish = async (page: Page) => { await page.getByRole("button", { name: "다 읽었습니다", exact: true }).click(); await expect(page.locator(".lw-story-body")).toHaveCount(0); };
async function answer(page: Page, number: number, choice: number) {
  const form = page.getByRole("form", { name: `문제 ${number} 첫 답`, exact: true });
  await form.getByRole("radio").nth(choice).check();
  await form.getByRole("button", { name: /첫 답 남기기/ }).click();
  await expect(page.getByRole("group", { name: `문제 ${number} 서버 판정`, exact: true })).toBeVisible();
}

test.describe("reading level", () => {
  test("the start screen offers three levels with their limits, 보통 is selected, and choosing changes only the limit", async ({ page }) => {
    await open(page);
    const gate = page.locator(".lw-reading-gate");
    const radios = gate.getByRole("radio");
    await expect(radios).toHaveCount(3);
    for (const level of readingLevels) {
      const radio = levelRadio(page, level.label);
      await expect(radio).toBeVisible();
      await expect(radio.locator("xpath=ancestor::label")).toContainText(`${level.label} · 분당 ${level.wordsPerMinute}낱말 · 제한 시간 ${clockLabel(levelLimitSeconds(story.words, level.id))}`);
    }
    // The limits are the formula's: words ÷ pace × 60 seconds, up to 10 seconds.
    const expected = Object.fromEntries(readingLevels.map(level => [level.id, Math.ceil(story.words / level.wordsPerMinute * 60 / 10) * 10]));
    expect(readingLevels.map(level => levelLimitSeconds(story.words, level.id))).toEqual(readingLevels.map(level => expected[level.id]));
    await expect(levelRadio(page, "보통")).toBeChecked();
    await expect(levelRadio(page, "여유 있게")).not.toBeChecked();
    await levelRadio(page, "빠르게").check();
    await expect(levelRadio(page, "보통")).not.toBeChecked();
    // Choosing a level is not an event.
    const saved = await record(page);
    expect(saved === null || (saved.events.length === 0 && saved.artifacts.length === 0)).toBe(true);
    await expect(gate).not.toContainText(MASTERY);
  });

  for (const level of readingLevels) {
    test(`starting at ${level.label} records the level and its limit, and the clock runs on that limit`, async ({ page }) => {
      const limit = levelLimitSeconds(story.words, level.id);
      await page.clock.install();
      await open(page);
      await start(page, level.label);
      await expect(page.locator(".lw-toolbar").getByRole("timer")).toContainText(`남은 시간 ${clockLabel(limit)}`);
      const saved = await record(page) as Rec;
      expect(saved.events).toHaveLength(1);
      expect(saved.events[0]).toMatchObject({ kind: "reading-start", level: level.id, limitSeconds: limit });
      await page.clock.fastForward((limit + 2) * 1000);
      await expect(page.locator(".lw-story-body")).toHaveCount(0);
      const ended = await record(page) as Rec;
      expect(ended.events[1]).toMatchObject({ kind: "reading-end", by: "time", elapsedMs: limit * 1000, endedAt: saved.events[0].startedAt! + limit * 1000 });
    });
  }

  test("the toolbar timer shows the remaining and the elapsed time together and they add up to the limit as the clock advances", async ({ page }) => {
    const limit = levelLimitSeconds(story.words, "normal");
    await page.clock.install();
    await open(page);
    await start(page);
    const timer = page.locator(".lw-toolbar").getByRole("timer");
    await expect(timer).toHaveAttribute("aria-live", "off");
    await expect(timer).toContainText(`남은 시간 ${clockLabel(limit)}`);
    await expect(timer).toContainText("지난 시간 0:00");
    for (const elapsed of [47, 63, 61]) {
      await page.clock.fastForward(elapsed * 1000);
    }
    const total = 47 + 63 + 61;
    await expect(timer).toContainText(`지난 시간 ${clockLabel(total)}`);
    await expect(timer).toContainText(`남은 시간 ${clockLabel(limit - total)}`);
    await expect(timer).not.toContainText(MASTERY);
    // The reading time is never a fixed bar over the body: the timer is in the toolbar and the note above the body is in the flow.
    expect(await page.locator(".lw-reading-clock").evaluate(element => getComputedStyle(element).position)).toBe("static");
    expect(await timer.evaluate(element => getComputedStyle(element.closest(".lw-toolbar")!).position)).not.toBe("fixed");
  });

  test("the note above the body at narrow widths shows both times too", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install();
    await open(page);
    await start(page, "여유 있게");
    await page.clock.fastForward(75 * 1000);
    const note = page.locator(".lw-reading-clock");
    await expect(note).toBeVisible();
    await expect(note).toContainText(`남은 시간 ${clockLabel(levelLimitSeconds(story.words, "relaxed") - 75)}`);
    await expect(note).toContainText("지난 시간 1:15");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("the timer announcements stay at one minute, thirty seconds and the end whatever the level", async ({ page }) => {
    const limit = levelLimitSeconds(story.words, "relaxed");
    await page.clock.install();
    await open(page);
    await start(page, "여유 있게");
    const live = page.locator(".lw-toolbar [role=status]");
    await page.clock.fastForward(40 * 1000);
    await expect(live).toHaveText("");
    await page.clock.fastForward((limit - 40 - 55) * 1000);
    await expect(live).toHaveText("남은 시간이 1분 이하입니다.");
  });
});

test.describe("reading record", () => {
  test("the document states the facts of a reading ended by the learner, and the conversation keeps the level in its marker", async ({ page }) => {
    await page.clock.install();
    await open(page);
    await start(page, "여유 있게");
    await page.clock.fastForward(192 * 1000);
    await finish(page);
    const factLine = page.locator(".lw-reading-record");
    const pace = Math.round(story.words / (192 / 60));
    await expect(factLine).toHaveText(`읽기 기록 수준 여유 있게 · 읽은 시간 3:12 · 분당 약 ${pace}낱말 · 직접 끝냄`);
    await expect(page.locator(".lw-body-hidden")).toContainText("본문을 가렸습니다 · 읽은 시간 3:12");
    await expect(page.locator(".lw-chat-pane .lw-reading-marker").first()).toContainText(`읽기를 시작했습니다 · 수준 여유 있게 · 제한 시간 ${clockLabel(levelLimitSeconds(story.words, "relaxed"))}`);
    await expect(page.locator(".lw-chat-pane .lw-reading-marker").nth(1)).toContainText("읽기를 마쳤습니다 · 읽은 시간 3:12 · 직접 마침");
    const saved = await record(page) as Rec;
    // The browser's clock keeps running while it is "fast-forwarded", so the elapsed time is 192 s plus the few real milliseconds of the test.
    expect(saved.events[1]).toMatchObject({ kind: "reading-end", by: "user" });
    expect(saved.events[1].elapsedMs).toBe(saved.events[1].endedAt! - saved.events[0].startedAt!);
    expect(saved.events[1].elapsedMs!).toBeGreaterThanOrEqual(192_000);
    expect(saved.events[1].elapsedMs!).toBeLessThan(194_000);
    expect(await page.locator("body").innerText()).not.toMatch(MASTERY);
    // The line survives a reload unchanged.
    await page.reload();
    await expect(factLine).toHaveText(`읽기 기록 수준 여유 있게 · 읽은 시간 3:12 · 분당 약 ${pace}낱말 · 직접 끝냄`);
  });

  test("a reading ended by the clock says so", async ({ page }) => {
    const limit = levelLimitSeconds(story.words, "fast");
    await page.clock.install();
    await open(page);
    await start(page, "빠르게");
    await page.clock.fastForward((limit + 5) * 1000);
    await expect(page.locator(".lw-body-hidden")).toBeVisible();
    await expect(page.locator(".lw-reading-record")).toHaveText(`읽기 기록 수준 빠르게 · 읽은 시간 ${clockLabel(limit)} · 분당 약 ${Math.round(story.words / (limit / 60))}낱말 · 시간 마감`);
  });

  test("a v4 record written before levels existed is restored as it is, with the facts it has and no level", async ({ page }) => {
    await open(page);
    await start(page);
    await finish(page);
    // Rewrite the record into the shape written before this change: no level on the start, no elapsed time on the end.
    await page.evaluate(storageKey => {
      const saved = JSON.parse(localStorage.getItem(storageKey)!);
      delete saved.events[0].level; saved.events[0].limitSeconds = 180; delete saved.events[1].elapsedMs;
      saved.events[1].endedAt = saved.events[0].startedAt + 150_000; saved.events[1].by = "user";
      localStorage.setItem(storageKey, JSON.stringify(saved));
    }, key(story.id));
    const before = await page.evaluate(storageKey => localStorage.getItem(storageKey), key(story.id));
    await page.reload();
    await expect(page.locator(".lw-session-status")).not.toContainText("임시 저장 실패");
    await expect(page.locator(".lw-reading-record")).toHaveText(`읽기 기록 읽은 시간 2:30 · 분당 약 ${Math.round(story.words / (150 / 60))}낱말 · 직접 끝냄`);
    await expect(page.locator(".lw-chat-pane .lw-reading-marker").first()).toHaveText("읽기를 시작했습니다 · 제한 시간 3:00");
    await expect(page.getByRole("form", { name: "문제 1 첫 답" })).toBeVisible();
    expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key(story.id))).toBe(before);
  });

  test("a record with an unknown level is not one this app wrote: it is kept and flagged, not shown", async ({ page }) => {
    await open(page);
    await start(page);
    await finish(page);
    const broken = await page.evaluate(storageKey => { const saved = JSON.parse(localStorage.getItem(storageKey)!); saved.events[0].level = "turbo"; const text = JSON.stringify(saved); localStorage.setItem(storageKey, text); return text; }, key(story.id));
    await page.reload();
    await expect(page.locator(".lw-session-status")).toContainText("임시 저장 실패");
    expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key(story.id))).toBe(broken);
  });
});

test.describe("questions answered inside the document", () => {
  test("the choice is picked in the question, the judgement and the explanation appear right under it, and the conversation keeps one line", async ({ page }) => {
    const chat: string[] = [];
    await page.route("**/api/learn-chat/**", async route => { chat.push(route.request().url()); await route.fulfill({ status: 500, json: {} }); });
    await open(page);
    await start(page);
    await finish(page);
    const q = story.questions[0], wrong = (q.answer + 1) % q.options.length;
    const section = page.locator(`.lw-story-question[data-question-id="${q.id}"]`);
    // Before the answer the question section holds the choices as a form, and no judgement exists anywhere.
    await expect(section.getByRole("form", { name: "문제 1 첫 답" }).getByRole("radio")).toHaveCount(4);
    await expect(page.locator(".lw-judgement")).toHaveCount(0);
    await expect(page.getByText(q.explain)).toHaveCount(0);
    await section.getByRole("radio").nth(wrong).check();
    await expect(page.locator(".lw-reading-context")).toContainText("입력 대상: 문제 1");
    await section.getByRole("button", { name: /첫 답 남기기/ }).click();
    const judged = section.getByRole("group", { name: "문제 1 서버 판정", exact: true });
    await expect(judged).toContainText("정본 답과 다릅니다.");
    await expect(judged).toContainText(`정본 답: ${letter(q.answer)}. ${q.options[q.answer]}`);
    await expect(judged).toContainText(q.explain);
    // The explanation sits below the options of the same section, in the document's flow, and not in the conversation.
    const order = await section.evaluate(element => {
      const options = element.querySelector(".lw-question-options"), item = element.querySelector(".lw-judgement");
      return !!options && !!item && !!(options.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) && !!element.closest(".lw-content-pane");
    });
    expect(order).toBe(true);
    await expect(page.locator(".lw-chat-pane").getByText(q.explain)).toHaveCount(0);
    await expect(page.locator(".lw-chat-pane .lw-judgement")).toHaveCount(0);
    await expect(section.locator(".lw-question-options li").nth(wrong)).toContainText("내 첫 답");
    await expect(section.locator(".lw-question-options li").nth(q.answer)).toContainText("정본 답");
    const lines = page.locator(".lw-chat-pane .lw-event-line");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveText(`문제 1 · 첫 답 ${letter(wrong)}를 남겼습니다`);
    await expect(lines.nth(1)).toContainText(`문제 1 · 첫 답 ${letter(wrong)} · 정본 답과 다릅니다`);
    // A second question keeps the real order of the conversation.
    const q2 = story.questions[1];
    await page.locator(`.lw-story-question[data-question-id="${q2.id}"]`).getByRole("radio").nth(q2.answer).check();
    await page.locator(`.lw-story-question[data-question-id="${q2.id}"]`).getByRole("button", { name: /첫 답 남기기/ }).click();
    await expect(lines).toHaveCount(4);
    await expect(lines.nth(3)).toContainText(`문제 2 · 첫 답 ${letter(q2.answer)} · 정본 답과 같습니다`);
    await expect(page.locator(".lw-reading-context")).toContainText("입력 대상: 문제 2");
    const kinds = await page.locator(".lw-chat-pane .lw-timeline-event").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-event-kind")));
    expect(kinds).toEqual(["reading-start", "reading-end", "initial", "check", "initial", "check"]);
    // A "문서에서 보기" button returns to the question in the document.
    await lines.nth(1).getByRole("button", { name: "문서에서 보기" }).click();
    await expect(section).toBeInViewport();
    expect(chat).toEqual([]);
    // The page and the conversation survive a reload with the same lines and the same judgements under the questions.
    await page.reload();
    await expect(page.locator(".lw-chat-pane .lw-event-line")).toHaveCount(4);
    await expect(section.getByRole("group", { name: "문제 1 서버 판정", exact: true })).toContainText(q.explain);
    await expect(page.locator(".lw-reading-context")).toContainText("입력 대상: 문제 2");
    expect(await page.locator("body").innerText()).not.toMatch(/정답입니다|숙달|완료|진행률|점수|정답률/);
  });

  test("an unanswered choice is a draft that survives a reload without becoming an event", async ({ page }) => {
    await open(page);
    await start(page);
    await finish(page);
    const q = story.questions[2];
    const section = page.locator(`.lw-story-question[data-question-id="${q.id}"]`);
    await section.getByRole("radio").nth(3).check();
    await page.reload();
    await expect(section.getByRole("radio").nth(3)).toBeChecked();
    const saved = await record(page) as Rec;
    expect(saved.events.map(event => event.kind)).toEqual(["reading-start", "reading-end"]);
  });
});

test.describe("what this browser remembers, beside each story in the lists", () => {
  async function readOne(page: Page, id = story.id) {
    await open(page, id);
    await start(page, "여유 있게");
    await finish(page);
    const target = reading.stories.find(item => item.id === id)!;
    await answer(page, 1, target.questions[0].answer);
    await answer(page, 2, (target.questions[1].answer + 1) % 4);
    return await record(page, id) as Rec;
  }
  const noteOf = (page: Page, id: string) => page.locator(`[data-story-record="${id}"]`);

  test("the reading list and the home window show level, time, pace and the count of first answers equal to the canonical one", async ({ page }) => {
    const saved = await readOne(page);
    const matches = saved.artifacts.filter(artifact => artifact.attempts[0]?.check?.match === true).length;
    expect(matches).toBe(1);
    await page.goto("/reading/");
    const note = noteOf(page, story.id);
    await expect(note).toHaveText(new RegExp(`^이 브라우저의 기록 · 수준 여유 있게 · 읽은 시간 0:\\d\\d · 분당 약 \\d+낱말 · 정본과 같은 첫 답 ${matches}개$`));
    await expect(page.locator("[data-story-record]")).toHaveCount(1);
    await expect(page.locator(".link-card", { has: note })).toContainText(story.title);
    expect(await note.innerText()).not.toMatch(MASTERY);
    expect(await note.innerText()).not.toMatch(/\d\s*\/\s*\d/);
    // The home window shows the same note beside that story and nothing beside the others.
    const listed = await note.innerText();
    await page.goto("/");
    await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
    const before = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(name => [name, localStorage.getItem(name)])));
    await page.locator(".lw-toolbar").getByRole("button", { name: "수업 목록", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "수업 목록" });
    await expect(dialog.locator("[data-story-record]")).toHaveCount(1);
    await expect(noteOf(page, story.id)).toHaveText(listed);
    await expect(dialog.getByRole("link", { name: story.title })).toHaveAttribute("href", `/reading/${story.id}/`);
    // Reading the record writes nothing.
    expect(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(name => [name, localStorage.getItem(name)])))).toEqual(before);
  });

  test("without a record, with a damaged record or a record that cannot be read, nothing is shown and the list is complete", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/reading/");
    await expect(page.locator(".link-card").first()).toBeVisible();
    const total = await page.locator(`a.link-card[href^="/reading/"]`).count();
    expect(total).toBe(reading.stories.length);
    await expect(page.locator("[data-story-record]")).toHaveCount(0);
    // A damaged record of one story and a record of another shape.
    await page.evaluate(([a, b, c]) => { localStorage.setItem(a, "{broken"); localStorage.setItem(b, JSON.stringify({ version: 4, lessonId: "bus-dog", events: "x", artifacts: [] })); localStorage.setItem(c, "null"); }, [key(story.id), key("bus-dog"), key("prep-wonder-0")]);
    await page.reload();
    await expect(page.locator(`a.link-card[href^="/reading/"]`)).toHaveCount(total);
    await expect(page.locator("[data-story-record]")).toHaveCount(0);
    // The browser refuses to read: the list still comes out as it is.
    const context = page.context();
    const blocked = await context.newPage();
    await blocked.addInitScript(() => { const original = Storage.prototype.getItem; Storage.prototype.getItem = function (name: string) { if (name.startsWith("english-sense-lesson-v4:")) throw new Error("storage denied"); return original.call(this, name); }; });
    blocked.on("pageerror", error => errors.push(error.message));
    await blocked.goto("/reading/");
    await expect(blocked.locator(`a.link-card[href^="/reading/"]`)).toHaveCount(total);
    await expect(blocked.locator("[data-story-record]")).toHaveCount(0);
    // The home window as well.
    await blocked.goto("/");
    await blocked.locator(".lw-toolbar").getByRole("button", { name: "수업 목록", exact: true }).click();
    await expect(blocked.getByRole("dialog", { name: "수업 목록" }).getByRole("link", { name: /Green Umbrella/ })).toBeVisible();
    await expect(blocked.locator("[data-story-record]")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the first response of the list has no record text: the browser's record is read after the page loads", async ({ request }) => {
    const html = await (await request.get("/reading/")).text();
    expect(html).not.toContain("이 브라우저의 기록");
    expect(html).not.toContain("data-story-record");
    expect(html.replaceAll("<!-- -->", "")).toContain(`제한 시간 ${clockLabel(levelLimitSeconds(story.words, "fast"))}~${clockLabel(levelLimitSeconds(story.words, "relaxed"))}`);
  });
});
