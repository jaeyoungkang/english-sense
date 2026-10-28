import { test, expect } from "@playwright/test";
import pages from "../../content/pages.json";
import type { FillQuestion, QuizContent } from "../../lib/content";

const entry = pages.find(p => p.path === "practice/titanic/come/")!;
const quiz = entry.parts.find(p => p.kind === "quiz") as QuizContent;

test("come practice: five choices then two fills, with hints and answers hidden until asked", async ({ page }) => {
  await page.goto(`/${entry.path}`);
  await expect(page.locator("#progress")).toHaveText("1 / 7");
  for (const question of quiz.questions.slice(0, 5)) {
    if (question.type !== "choose") throw new Error("expected choose");
    await page.locator(".opt").nth(question.opts.findIndex(option => option.k === "en")).click();
    await expect(page.getByText("맞습니다.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "다음 문제", exact: true }).click();
  }
  for (const [index, question] of quiz.questions.slice(5).entries()) {
    const fill = question as FillQuestion;
    await expect(page.locator("#progress")).toHaveText(`${6 + index} / 7`);
    const card = page.locator("#quiz-card");
    await expect(card).toContainText(fill.before[0]);
    await expect(card).toContainText(fill.after[0]);
    await expect(card).toContainText(fill.hintKo);
    await expect(card.locator(".blank")).toHaveCount(1);
    // 요청 전: 정답·힌트·감각·교정은 화면 글자에 없다
    const before = await card.innerText();
    for (const hidden of [fill.answer, fill.feel, fill.fixes[0][1], ...fill.hintWords]) expect(before.toLowerCase()).not.toContain(hidden.toLowerCase());
    await expect(page.locator("#hint-verb")).toHaveCount(0);
    await page.getByRole("button", { name: "힌트 보기", exact: true }).click();
    await expect(page.locator("#hint-verb")).toContainText(fill.hintVerb);
    await expect(page.locator("#hint-words")).toHaveCount(0);
    await page.getByRole("button", { name: "힌트 더 보기", exact: true }).click();
    await expect(page.locator("#hint-words")).toContainText(fill.hintWords[0]);
    await expect(page.locator("#hint-more")).toBeDisabled();
    await expect(page.locator("#fb")).toHaveCount(0);
    await page.locator("#quiz textarea").fill("My own answer.");
    await page.getByRole("button", { name: "모범 답 보기", exact: true }).click();
    await expect(page.locator("#fb .en").first()).toHaveText(fill.answer);
    await expect(page.locator("#fb")).toContainText("책 문장 그대로입니다.");
    await expect(page.locator("#fb")).toContainText(fill.feel);
    await expect(page.locator("#fb .fixes li")).toHaveCount(fill.fixes.length);
    await page.getByRole("button", { name: /다음 문제|결과 보기/ }).click();
  }
  await expect(page.locator(".score")).toHaveText("5 / 5");
  await page.getByRole("button", { name: "처음부터 다시" }).click();
  await expect(page.locator("#progress")).toHaveText("1 / 7");
});

test("come practice fits 320px and the hint state resets for the next question", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/${entry.path}`);
  for (const question of quiz.questions.slice(0, 5)) {
    if (question.type !== "choose") throw new Error("expected choose");
    await page.locator(".opt").nth(0).click();
    await page.getByRole("button", { name: "다음 문제", exact: true }).click();
  }
  await page.getByRole("button", { name: "힌트 보기", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator("#quiz textarea").fill("x");
  await page.getByRole("button", { name: "모범 답 보기", exact: true }).click();
  await page.getByRole("button", { name: "다음 문제", exact: true }).click();
  await expect(page.locator("#hint-verb")).toHaveCount(0);
  await expect(page.locator("#quiz textarea")).toHaveValue("");
});
