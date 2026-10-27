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

test("fill-in drills accept lenient right answers, flag wrong ones and reveal answers with sources", async ({ page }) => {
  await page.goto("/prep/wonder/unit-0/");
  const card = page.locator("article", { has: page.locator("#wonder-0-12-h") });
  await expect(card.locator(".count")).toContainText("책 전체");
  await expect(card.locator("figcaption")).toHaveText(/^Wonder \(R\. J\. Palacio, 2012\) · \d부$/);
  await card.getByLabel("빈칸 1").fill("pick");
  await card.getByLabel("빈칸 2").fill("out");
  await card.getByRole("button", { name: "확인" }).click();
  await expect(card.getByRole("status")).toHaveText("아직 아닙니다. 고쳐 쓰거나 답을 보십시오.");
  await card.getByLabel("빈칸 2").fill("  UP ");
  await card.getByLabel("빈칸 2").press("Enter");
  await expect(card.getByRole("status")).toHaveText("맞습니다.");
  await expect(card.getByRole("button", { name: "확인" })).toBeDisabled();

  const other = page.locator("article").first();
  await other.getByRole("button", { name: "답 보기" }).click();
  await expect(other.getByRole("status")).toContainText("답: kind of");
  await expect(other.getByLabel("빈칸", { exact: true })).toHaveValue("kind of");

  await page.goto("/prep/zootopia/unit-0/");
  await expect(page.locator("article").first().locator("figcaption")).toHaveText(/^Zootopia \(2016\) · \d\d:\d\d:\d\d$/);
  await expect(page.locator("article").first().locator(".count")).toContainText("영화 전체");
});
