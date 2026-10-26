import { test, expect } from "@playwright/test";
import pages from "../../content/pages.json";
import ask from "../../content/ask.json";
import type { QuizContent } from "../../lib/content";

test("all migrated routes retain content, canonical URLs and responsive layout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.url().includes("/_next/static/") && response.status() >= 400) errors.push(`Asset ${response.status()}: ${response.url()}`);
  });
  for (const entry of pages) {
    const response = await page.goto(`/${entry.path}`);
    expect(response?.status(), entry.path).toBe(200);
    await expect(page).toHaveTitle(entry.title);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://english.artificialmind.kr/${entry.path}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("sense diagram changes when another use is chosen", async ({ page }) => {
  await page.goto("/have/");
  const tabs = page.locator(".chip");
  const second = tabs.nth(1);
  const firstExample = await page.locator("#z-ex").textContent();
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#z-ex")).not.toHaveText(firstExample || "");
});

test("quiz completes choosing, writing, feedback and restart", async ({ page }) => {
  const entry = pages.find(p => p.path === "practice/titanic/have/")!;
  const quiz = entry.parts.find(p => p.kind === "quiz") as QuizContent;
  if (quiz.kind !== "quiz") throw new Error("Missing migrated quiz");
  await page.goto(`/${entry.path}`);
  for (const question of quiz.questions) {
    if (question.type === "choose") {
      await page.locator(".opt").nth(question.opts.findIndex(option => option.k === "en")).click();
      await expect(page.getByText("맞습니다.", { exact: true })).toBeVisible();
    } else {
      await page.locator("#quiz textarea").fill("My own answer.");
      await page.getByRole("button", { name: "모범 답 보기", exact: true }).click();
      await expect(page.locator(".feedback .en").first()).toHaveText(question.answer);
    }
    await page.getByRole("button", { name: /다음 문제|결과 보기/ }).click();
  }
  await expect(page.locator(".score")).toHaveText("5 / 5");
  await page.getByRole("button", { name: "처음부터 다시" }).click();
  await expect(page.locator("#progress")).toHaveText("1 / 7");
});

test("explanation UI uses same-origin APIs and recovers from errors", async ({ page }) => {
  await page.route("**/api/explain**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "잠시 뒤 다시 써 주십시오." }) }));
  await page.goto("/ask/");
  await page.getByLabel("해설할 영어 문장을 넣으십시오.").fill("We don't have much time.");
  await page.getByRole("button", { name: "해설 보기", exact: true }).click();
  await expect(page.locator("#result").getByRole("alert")).toHaveText("잠시 뒤 다시 써 주십시오.");
  await page.route("**/api/translate**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(ask.sample) }));
  await page.getByRole("tab", { name: "한국어를 영어로", exact: true }).click();
  await page.getByLabel("영어로 옮길 한국어 문장을 넣으십시오.").fill("시간이 별로 없어.");
  await page.getByRole("button", { name: "영어로 옮기기", exact: true }).click();
  await expect(page.locator("#result .en-big")).toHaveText(ask.sample.english);
  await expect(page.getByRole("button", { name: "영어로 옮기기", exact: true })).toBeEnabled();
});

test("legacy links redirect and unknown pages return 404", async ({ request }) => {
  for (const word of ["have", "get", "be", "ask"]) {
    const response = await request.get(`/${word}.html`, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(`/${word}/`);
  }
  expect((await request.get("/does-not-exist/")).status()).toBe(404);
  const xml = await request.get("/sitemap.xml");
  expect(xml.ok()).toBe(true);
  for (const entry of pages) expect(await xml.text()).toContain(`https://english.artificialmind.kr/${entry.path}`);
});
