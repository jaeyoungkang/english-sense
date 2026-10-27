import { test, expect } from "@playwright/test";
import readingJson from "../../content/reading.json";
import prepJson from "../../content/prep.json";
import type { PrepData, ReadingData } from "../../lib/study-content-types";

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
  await page.getByRole("navigation", { name: "사이트" }).getByRole("link", { name: "읽기" }).click();
  await expect(page).toHaveURL(/\/reading\/$/);
  await page.getByRole("navigation", { name: "사이트" }).getByRole("link", { name: "사전 훈련" }).click();
  await expect(page).toHaveURL(/\/prep\/$/);
  const xml = await (await request.get("/sitemap.xml")).text();
  for (const path of paths) expect(xml).toContain(`https://english.artificialmind.kr/${path}`);
});

test("a story is hidden until start, then hidden again for the quiz, and ends with score and time", async ({ page }) => {
  const story = reading.stories.find(s => s.id === "green-umbrella")!;
  const firstLine = story.paragraphs[0].map(p => p.text).join("");
  await page.goto(`/reading/${story.id}/`);
  await expect(page.locator(".hero .draft-tag")).toHaveText("초안");
  await expect(page.getByText(firstLine)).toHaveCount(0);
  await page.getByRole("button", { name: "읽기 시작" }).click();
  await expect(page.getByText(firstLine)).toBeVisible();
  await expect(page.getByRole("timer")).toContainText(/남은 시간 [23]:\d\d/);
  await page.getByRole("button", { name: "다 읽었습니다" }).click();
  await expect(page.getByText(firstLine)).toHaveCount(0);
  await expect(page.getByText(/만에 읽었습니다/)).toBeVisible();
  for (const [i, q] of story.questions.entries()) {
    const pick = i === 0 ? (q.answer + 1) % q.options.length : q.answer;
    await page.locator(".opt").nth(pick).click();
    await expect(page.locator(".verdict")).toHaveText(i === 0 ? "정답은 초록색 보기입니다." : "맞습니다.");
    await expect(page.locator(".feel")).toHaveText(q.explain);
    await page.getByRole("button", { name: /다음 문제|결과 보기/ }).click();
  }
  await expect(page.locator(".score")).toHaveText(`${story.questions.length - 1} / ${story.questions.length}`);
  await expect(page.getByText(/읽은 시간 0:\d\d \/ 제한 3:00/)).toBeVisible();
});

test("when time runs out the story closes and the quiz starts", async ({ page }) => {
  const story = reading.stories[1];
  await page.clock.install();
  await page.goto(`/reading/${story.id}/`);
  await page.getByRole("button", { name: "읽기 시작" }).click();
  await expect(page.locator(".story")).toBeVisible();
  await page.clock.fastForward((story.limitSeconds + 1) * 1000);
  await expect(page.locator(".story")).toHaveCount(0);
  await expect(page.getByText("시간이 끝나 본문을 가렸습니다.", { exact: false })).toBeVisible();
  await expect(page.locator(".opt")).toHaveCount(story.questions[0].options.length);
});

test("unit cards show their source line and whether the count is for the whole work", async ({ page }) => {
  await page.goto("/prep/wonder/unit-0/");
  const card = page.locator("section.cl-card", { has: page.locator("#wonder-0-12") });
  await expect(card.locator(".cl-count")).toContainText("책 전체");
  await expect(card.locator(".cl-example figcaption")).toHaveText(/^Wonder \(R\. J\. Palacio, 2012\) · \d부$/);
  await page.goto("/prep/zootopia/unit-0/");
  await expect(page.locator("section.cl-card").first().locator(".cl-example figcaption")).toHaveText(/^Zootopia \(2016\) · \d\d:\d\d:\d\d$/);
  await expect(page.locator("section.cl-card").first().locator(".cl-count")).toContainText("영화 전체");
});

test("the reading list separates paired stories by work and marks every story as a draft", async ({ page }) => {
  await page.goto("/reading/");
  const plain = page.locator("section", { has: page.locator("#stories-h") });
  await expect(plain.locator(".link-card")).toHaveCount(reading.stories.filter(s => !s.pair).length);
  const paired = page.locator("section", { has: page.locator("#paired-h") }).first();
  await expect(paired.locator(".link-card")).toHaveCount(reading.stories.filter(s => s.pair).length);
  await expect(paired.locator("#paired-wonder-h")).toContainText("Wonder");
  await expect(paired.getByRole("link", { name: /Leaving in June/ })).toContainText("유닛 3");
  const drafts = reading.stories.filter(s => s.draft).length;
  await expect(page.locator(".link-card .draft-tag")).toHaveCount(drafts);
});

test("a paired story links to its unit, labels expression questions and links each to its card", async ({ page }) => {
  const story = reading.stories.find(s => s.id === "prep-wonder-3")!;
  await page.goto(`/reading/${story.id}/`);
  await expect(page.locator(".pair-note")).toContainText("Wonder 유닛 3 표현으로 쓴 이야기");
  await expect(page.locator(".pair-note a")).toHaveAttribute("href", "/prep/wonder/unit-3/");
  await page.getByRole("button", { name: "읽기 시작" }).click();
  await page.getByRole("button", { name: "다 읽었습니다" }).click();
  const first = story.questions.findIndex(q => q.kind === "expression");
  for (const q of story.questions.slice(0, first)) {
    await expect(page.locator(".card .meta")).toHaveText("내용");
    await page.locator(".opt").nth(q.answer).click();
    await expect(page.locator(".card-link")).toHaveCount(0);
    await page.getByRole("button", { name: "다음 문제" }).click();
  }
  const q = story.questions[first];
  await expect(page.locator(".card .meta")).toHaveText("표현");
  await page.locator(".opt").nth(q.answer).click();
  await expect(page.locator(".feel")).toHaveText(q.explain);
  const link = page.locator(".card-link a");
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
  await expect(page.locator("main h1")).toHaveText("Leaving in June");
  for (const work of prep.works) for (const unit of work.units) {
    const paired = reading.stories.filter(s => s.pair?.work === work.id && s.pair.unit === unit.n);
    if (!paired.length) continue;
    await page.goto(`/prep/${work.id}/unit-${unit.n}/`);
    await expect(page.locator("#pair-read-h + .links .link-card")).toHaveCount(paired.length);
  }
});
