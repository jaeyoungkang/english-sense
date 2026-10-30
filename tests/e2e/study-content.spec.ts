import { test, expect } from "@playwright/test";
import readingJson from "../../content/reading.json";
import prepJson from "../../content/prep.json";
import type { PrepData, ReadingData } from "../../lib/study-content-types";
import { clockLabel } from "../../lib/study-content";
import { levelLimitSeconds } from "../../lib/reading-level";

const reading = readingJson as ReadingData;
const prep = prepJson as PrepData;
const paths = ["reading/", ...reading.stories.map(s => `reading/${s.id}/`), "prep/",
  ...prep.works.flatMap(w => [`prep/${w.id}/`, ...w.units.map(u => `prep/${w.id}/unit-${u.n}/`)])];

test("reading and prep pages are public, linked from the menu, in the sitemap and fit 320px", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of paths) {
    const response = await page.goto(`/${path}`);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://english.artificialmind.kr/${path}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  expect(errors).toEqual([]);
  await page.goto("/practice/");
  await page.getByRole("navigation", { name: "사이트", exact: true }).getByRole("button", { name: "수업 목록", exact: true }).click();
  await page.getByRole("dialog", { name: "수업 목록" }).locator('a[href="/reading/"]').click();
  await expect(page).toHaveURL(/\/reading\/$/);
  await page.getByRole("navigation", { name: "사이트", exact: true }).getByRole("button", { name: "수업 목록", exact: true }).click();
  await page.getByRole("dialog", { name: "수업 목록" }).locator('a[href="/prep/"]').click();
  await expect(page).toHaveURL(/\/prep\/$/);
  const xml = await (await request.get("/sitemap.xml")).text();
  for (const path of paths) expect(xml).toContain(`https://english.artificialmind.kr/${path}`);
});

test("a story shows the body and questions open from the start, and optional timed reading covers the body for recall", async ({ page }) => {
  const story = reading.stories.find(s => s.id === "green-umbrella")!;
  const firstLine = story.paragraphs[0].map(p => p.text).join("");
  await page.goto(`/reading/${story.id}/`);
  await expect(page.locator(".lw-toolbar .draft-tag")).toHaveCount(0);
  await expect(page.getByText(firstLine)).toBeVisible();
  await expect(page.getByRole("form", { name: "문제 1 첫 답" })).toBeVisible();
  await page.getByRole("button", { name: "읽기 시작" }).click();
  await expect(page.getByText(firstLine)).toBeVisible();
  await expect(page.getByRole("form", { name: "문제 1 첫 답" })).toHaveCount(0);
  // The default level is 보통, so the first limit is its own, not the old fixed 3:00.
  await expect(page.getByRole("timer")).toContainText(new RegExp(`남은 시간 (${clockLabel(levelLimitSeconds(story.words, "normal"))}|${clockLabel(levelLimitSeconds(story.words, "normal") - 1)}|${clockLabel(levelLimitSeconds(story.words, "normal") - 2)})`));
  await page.getByRole("button", { name: "다 읽었습니다", exact: true }).click();
  await expect(page.getByText(firstLine)).toHaveCount(0);
  await expect(page.getByText(/본문을 가렸습니다 · 읽은 시간 0:\d\d/)).toBeVisible();
  await expect(page.getByRole("form", { name: "문제 1 첫 답" })).toBeVisible();
});

test("when time runs out the story closes and the questions open", async ({ page }) => {
  const story = reading.stories[1];
  await page.clock.install();
  await page.goto(`/reading/${story.id}/`);
  await page.getByRole("button", { name: "읽기 시작" }).click();
  await expect(page.locator(".lw-story-body")).toBeVisible();
  await page.clock.fastForward((levelLimitSeconds(story.words, "normal") + 1) * 1000);
  await expect(page.locator(".lw-story-body")).toHaveCount(0);
  await expect(page.getByText("시간 마감", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("form", { name: "문제 1 첫 답" }).getByRole("radio")).toHaveCount(story.questions[0].options.length);
});

test("unit cards show their source line, and once opened by a first answer whether the count is for the whole work", async ({ page }) => {
  await page.goto("/prep/wonder/unit-0/");
  const card = page.locator("section.cl-card", { has: page.locator("#wonder-0-12") });
  // Before a first answer the card holds the blank sentence and its source line; the count and the example open with the first answer.
  await expect(card.locator(".cl-source")).toHaveText(/^Wonder \(R\. J\. Palacio, 2012\) · \d부$/);
  await expect(card.locator(".cl-count, .cl-example")).toHaveCount(0);
  await card.getByLabel("빈칸 1", { exact: true }).fill("pick");
  await card.getByRole("button", { name: "첫 답 남기기" }).click();
  await expect(card.locator(".cl-count")).toContainText("책 전체");
  await expect(card.locator(".cl-example figcaption")).toHaveText(/^Wonder \(R\. J\. Palacio, 2012\) · \d부$/);
  await page.goto("/prep/zootopia/unit-0/");
  const first = page.locator("section.cl-card").first();
  await expect(first.locator(".cl-source")).toHaveText(/^Zootopia \(2016\) · \d\d:\d\d:\d\d$/);
  await first.getByLabel("빈칸 1", { exact: true }).fill("x");
  await first.getByRole("button", { name: "첫 답 남기기" }).click();
  await expect(first.locator(".cl-example figcaption")).toHaveText(/^Zootopia \(2016\) · \d\d:\d\d:\d\d$/);
  await expect(first.locator(".cl-count")).toContainText("영화 전체");
});

test("the reading list separates paired stories by work and shows no draft tags on published stories", async ({ page }) => {
  await page.goto("/reading/");
  const plain = page.locator("section", { has: page.locator("#stories-h") });
  await expect(plain.locator(".link-card")).toHaveCount(reading.stories.filter(s => !s.pair).length);
  const paired = page.locator("section", { has: page.locator("#paired-h") }).first();
  await expect(paired.locator(".link-card")).toHaveCount(reading.stories.filter(s => s.pair).length);
  await expect(paired.locator("#paired-wonder-h")).toContainText("Wonder");
  await expect(paired.getByRole("link", { name: /Leaving in June/ })).toContainText("유닛 3");
  expect(reading.stories.every(s => !s.draft)).toBe(true);
  await expect(page.locator(".link-card .draft-tag")).toHaveCount(0);
});

test("a paired story links to its unit and links each expression question to its card", async ({ page }) => {
  const story = reading.stories.find(s => s.id === "prep-wonder-3")!;
  await page.goto(`/reading/${story.id}/`);
  await expect(page.locator(".pair-note")).toContainText("Wonder 유닛 3 표현으로 쓴 이야기");
  await expect(page.locator(".pair-note a")).toHaveAttribute("href", "/prep/wonder/unit-3/");
  await page.getByRole("button", { name: "읽기 시작" }).click();
  await page.getByRole("button", { name: "다 읽었습니다", exact: true }).click();
  const first = story.questions.findIndex(q => q.kind === "expression");
  // Story and questions are one document: no question kind is shown.
  await expect(page.locator(`.lw-story-question[data-question-id="${story.questions[first].id}"] .lw-artifact-header`)).not.toContainText(/내용|표현/);
  const q = story.questions[first];
  const form = page.getByRole("form", { name: `문제 ${first + 1} 첫 답` });
  await form.getByRole("radio").nth(q.answer).check();
  await form.getByRole("button", { name: /첫 답 남기기/ }).click();
  await expect(page.locator(".lw-judgement-line")).toHaveText("정본 답과 같습니다.");
  await expect(page.locator(".lw-judgement")).toContainText(q.explain);
  const link = page.locator(".lw-judgement-card a");
  await expect(link).toHaveAttribute("href", `/prep/wonder/unit-3/#${q.card}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/prep/wonder/unit-3/#${q.card}$`));
  await expect(page.locator(`section.cl-card[data-question-id="${q.card}"]`)).toBeInViewport();
});

test("a prep unit links to the story written with its expressions", async ({ page }) => {
  await page.goto("/prep/wonder/unit-3/");
  const link = page.getByRole("link", { name: /이 표현으로 읽기: Leaving in June \(4분\)/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/reading\/prep-wonder-3\/$/);
  await expect(page.locator("main h1")).toContainText("Leaving in June");
  for (const work of prep.works) for (const unit of work.units) {
    const paired = reading.stories.filter(s => s.pair?.work === work.id && s.pair.unit === unit.n);
    if (!paired.length) continue;
    await page.goto(`/prep/${work.id}/unit-${unit.n}/`);
    await expect(page.locator("#pair-read-h + .links .link-card")).toHaveCount(paired.length);
  }
});
