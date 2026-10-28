import { test, expect, type Page } from "@playwright/test";
import prepJson from "../../content/prep.json";
import readingJson from "../../content/reading.json";
import type { PrepData, ReadingData } from "../../lib/study-content-types";

const prep = prepJson as PrepData, reading = readingJson as ReadingData;
const units = prep.works.flatMap(work => work.units.map(unit => `/prep/${work.id}/unit-${unit.n}/`));
const stories = reading.stories.map(story => `/reading/${story.id}/`);
const first = reading.stories[0];
const toolbarButton = (page: Page) => page.locator(".lw-toolbar").getByRole("button", { name: "수업 목록", exact: true });
const storage = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])));

test("the home first response has the toolbar item and no lesson data: no question ids, no answers, no open window", async ({ page }) => {
  const response = await page.goto("/");
  const html = await response!.text();
  expect(html).toContain('aria-label="수업 목록"');
  // The window is drawn only when opened, and the registry's question ids (about 350) never reach the home page.
  expect(html).not.toContain("lw-lesson-list");
  // The titles and addresses are in the page's props, so the checks below are not vacuous.
  expect(html).toContain(`/reading/${first.id}/`);
  expect(html).not.toMatch(/green-umbrella-content-1|wonder-0-01|prep-wonder-3-expression/);
  expect(html).not.toMatch(/\\"(answers|explain|basis)\\"|"(answers|explain|basis)"/);
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
  await expect(toolbarButton(page)).toBeVisible();
});

test("the list window opens from the home toolbar with every story and unit at its existing address, and changes nothing in the have record", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/")) requests.push(request.url()); });
  await page.goto("/");
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
  const before = await storage(page);
  await toolbarButton(page).click();
  const dialog = page.getByRole("dialog", { name: "수업 목록" });
  await expect(dialog).toBeVisible();
  const hrefs = await dialog.getByRole("link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
  expect(hrefs.filter(href => href!.startsWith("/reading/") && href !== "/reading/")).toEqual(stories);
  expect(hrefs.filter(href => /^\/prep\/[^/]+\/unit-\d+\/$/.test(href!))).toEqual(units);
  expect(hrefs.filter(href => /^\/practice\/titanic\/[^/]+\/$/.test(href!))).toEqual(["have", "get", "be", "go", "come"].map(word => `/practice/titanic/${word}/`));
  expect(hrefs).toContain("/practice/");
  expect(hrefs).toContain("/reading/");
  expect(hrefs).toContain("/prep/");
  expect(stories).toHaveLength(15);
  expect(units).toHaveLength(13);
  await expect(dialog.getByRole("link", { name: first.title })).toHaveAttribute("href", `/reading/${first.id}/`);
  await expect(dialog.getByRole("link", { name: "유닛 3 · 3부 앞" }).first()).toBeVisible();
  // Opening and closing the window records nothing and calls no API.
  await dialog.getByRole("button", { name: "닫고 학습으로 돌아가기" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toolbarButton(page)).toBeFocused();
  expect(await storage(page)).toEqual(before);
  expect(requests).toEqual([]);
  await toolbarButton(page).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a list link opens its lesson, whose common window keeps the lesson's own list available", async ({ page }) => {
  await page.goto("/");
  await toolbarButton(page).click();
  await page.getByRole("dialog", { name: "수업 목록" }).getByRole("link", { name: first.title }).click();
  await expect(page).toHaveURL(new RegExp(`/reading/${first.id}/$`));
  await toolbarButton(page).click();
  await page.getByRole("dialog", { name: "수업 목록" }).getByRole("link", { name: "이야기 전체 목록" }).click();
  await expect(page).toHaveURL(/\/reading\/$/);
  await page.goto("/");
  await toolbarButton(page).click();
  const link = page.getByRole("dialog", { name: "수업 목록" }).getByRole("link", { name: "유닛 3 · 3부 앞" }).first();
  const href = (await link.getAttribute("href"))!;
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await toolbarButton(page).click();
  const ownList = page.getByRole("dialog", { name: "수업 목록" }).getByRole("link", { name: "이 작품의 유닛 목록" });
  await expect(ownList).toHaveAttribute("href", "/prep/wonder/");
  await ownList.click();
  await expect(page).toHaveURL(/\/prep\/wonder\/$/);
});

test("at 390px and 320px the toolbar item is reachable and the window has no horizontal overflow", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");
    await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const button = toolbarButton(page);
    await button.scrollIntoViewIfNeeded();
    expect(await button.evaluate(element => { const box = element.getBoundingClientRect(), top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return box.width > 0 && !!top && element.contains(top); })).toBe(true);
    await button.click();
    const dialog = page.getByRole("dialog", { name: "수업 목록" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().right <= innerWidth && element.getBoundingClientRect().left >= 0)).toBe(true);
    const last = dialog.getByRole("link", { name: /유닛/ }).last();
    await last.scrollIntoViewIfNeeded();
    expect(await last.evaluate(element => { const box = element.getBoundingClientRect(), top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return box.height >= 44 && !!top && element.contains(top); })).toBe(true);
    await page.keyboard.press("Escape");
  }
});
