import { test, expect, type Page } from "@playwright/test";
import { pages } from "../../lib/server/site-pages";
import ask from "../../content/ask.json";

const words = ["have", "get", "be", "go", "come"];
const publicPages = pages.filter(entry => !entry.parts.some(part => part.kind === "reading" || part.kind === "prep-unit" || part.kind === "scene-workspace"));
const navigation = (page: Page) => page.getByRole("navigation", { name: "사이트", exact: true });
const closeName = "닫고 학습으로 돌아가기";

function decodeHtml(value: string) {
  return value.replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, number: string) => String.fromCodePoint(Number(number)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attribute(html: string, tag: "meta" | "link", key: string, value: string, result: string) {
  for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))) {
    const attributes = Object.fromEntries([...match[0].matchAll(/([^\s=<>]+)\s*=\s*"([^"]*)"/g)].map(item => [item[1], decodeHtml(item[2])]));
    if (attributes[key] === value) return attributes[result];
  }
}

test("all 50 public addresses retain their page metadata, structured data and sitemap entry", async ({ request }) => {
  test.setTimeout(120_000);
  expect(pages).toHaveLength(50);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const entry of pages) {
    const response = await request.get(`/${entry.path}`);
    expect(response.status(), entry.path).toBe(200);
    const html = await response.text(), url = `https://english.artificialmind.kr/${entry.path}`;
    expect(decodeHtml(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""), entry.path).toBe(entry.title);
    expect(attribute(html, "link", "rel", "canonical", "href"), entry.path).toBe(url);
    expect(attribute(html, "meta", "name", "description", "content"), entry.path).toBe(entry.description);
    for (const family of ["og", "twitter"]) {
      const name = family === "og" ? "property" : "name";
      expect(attribute(html, "meta", name, `${family}:title`, "content"), entry.path).toBe(entry.title);
      expect(attribute(html, "meta", name, `${family}:description`, "content"), entry.path).toBe(entry.description);
      expect(attribute(html, "meta", name, `${family}:image`, "content"), entry.path).toBe(`https://english.artificialmind.kr/assets/og/${entry.og || "default"}.png`);
    }
    expect(attribute(html, "meta", "property", "og:url", "content"), entry.path).toBe(url);
    expect(attribute(html, "meta", "name", "twitter:card", "content"), entry.path).toBe("summary_large_image");
    if (entry.path) {
      const structured = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
      expect(structured.some(item => item["@type"] === "BreadcrumbList"), entry.path).toBe(true);
      if (entry.ld === "article") expect(structured.some(item => item["@type"] === "Article" && item.url === url), entry.path).toBe(true);
    }
    expect(sitemap, entry.path).toContain(url);
  }
});

test("every redesigned public page opens the shared navigation without making a lesson record or API request", async ({ page }) => {
  test.setTimeout(120_000);
  expect(publicPages).toHaveLength(21);
  const requests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
  await page.route("**/api/**", route => route.abort());
  for (const entry of publicPages) {
    await page.goto(`/${entry.path}`);
    await expect(page.locator(".public-app")).toBeVisible();
    await expect(page.locator(".lw-session-status")).toHaveCount(0);
    const nav = navigation(page);
    await expect(nav.getByRole("link", { name: "이야기 읽기" })).toHaveAttribute("href", "/reading/");
    await expect(nav.getByRole("link", { name: "문장 해설기" })).toHaveAttribute("href", "/ask/");
    await nav.getByRole("button", { name: "수업 목록", exact: true }).click();
    const lessons = page.getByRole("dialog", { name: "수업 목록", exact: true });
    await expect(lessons).toBeVisible();
    await expect(lessons.locator('a[href^="/practice/titanic/"]')).toHaveCount(5);
    await expect(lessons.locator('a[href^="/reading/"]').filter({ hasNotText: "전체 목록" })).toHaveCount(15);
    await expect(lessons.locator('a[href*="/unit-"]')).toHaveCount(13);
    await lessons.getByRole("button", { name: closeName }).click();
    await expect(nav.getByRole("button", { name: "수업 목록", exact: true })).toBeFocused();
    await nav.getByRole("button", { name: "감각 자료", exact: true }).click();
    const resources = page.getByRole("dialog", { name: "감각 자료", exact: true });
    expect(await resources.getByRole("link").evaluateAll(links => links.map(link => link.getAttribute("href")))).toEqual(words.map(word => `/${word}/`));
    await page.keyboard.press("Escape");
    await expect(resources).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /^english-sense-(learning-workspace|lesson-v4|notes-v1)/.test(key))), entry.path).toEqual([]);
  }
  expect(requests).toEqual([]);
});

test("shared resource windows work with the keyboard and restore focus at 320px in public, story and card pages", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ["/ask/", "/reading/green-umbrella/", "/prep/wonder/unit-0/"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
    const button = navigation(page).getByRole("button", { name: "감각 자료", exact: true });
    await button.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "감각 자료", exact: true });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().left >= 0 && element.getBoundingClientRect().right <= innerWidth)).toBe(true);
    const last = dialog.locator('a[href="/come/"]');
    await last.scrollIntoViewIfNeeded();
    expect(await last.evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return box.height >= 44 && !!hit && element.contains(hit); })).toBe(true);
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: closeName })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  }
});

test("a resource leads to its existing practice and the shared sentence explainer", async ({ page }) => {
  await page.goto("/practice/");
  await navigation(page).getByRole("button", { name: "감각 자료", exact: true }).click();
  await page.getByRole("dialog", { name: "감각 자료", exact: true }).locator('a[href="/come/"]').click();
  await expect(page).toHaveURL(/\/come\/$/);
  await page.locator('main a[href="/practice/titanic/come/"]').first().click();
  await expect(page).toHaveURL(/\/practice\/titanic\/come\/$/);
  await expect(page.locator("#progress")).toHaveText("1 / 7");
  await navigation(page).getByRole("link", { name: "문장 해설기" }).click();
  await expect(page).toHaveURL(/\/ask\/$/);
  await expect(page.getByRole("tab", { name: "영어 문장 해설", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "한국어를 영어로", exact: true })).toBeVisible();
});

test("a real unsubmitted lesson question survives window use and a round trip to the explainer without sending an API request", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
  await page.route("**/api/**", route => route.abort());
  await page.goto("/practice/have/");
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
  const draft = "검증용 미전송 질문: 이 장면의 감각을 다시 살펴봅니다.";
  const field = page.getByLabel("이 장면에 대해 질문하기");
  await field.fill(draft);
  const key = "english-sense-learning-workspace-v3";
  await expect.poll(() => page.evaluate(({ key, draft }) => {
    const record = JSON.parse(localStorage.getItem(key) || "null");
    return record?.artifacts.some((artifact: { messageDraft: string }) => artifact.messageDraft === draft);
  }, { key, draft })).toBe(true);
  const before = await page.evaluate(key => localStorage.getItem(key), key);
  for (const name of ["수업 목록", "감각 자료"]) {
    await navigation(page).getByRole("button", { name, exact: true }).click();
    await page.getByRole("dialog", { name, exact: true }).getByRole("button", { name: closeName }).click();
  }
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(before);
  await navigation(page).getByRole("link", { name: "문장 해설기" }).click();
  await expect(page).toHaveURL(/\/ask\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/practice\/have\/$/);
  await expect(field).toHaveValue(draft);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(before);
  expect(requests).toEqual([]);
});

test("home page serves as the story-reading main hub with category filter tabs, story card grid, and bidirectional prep unit links", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".public-app")).toBeVisible();
  await expect(page.locator("main h1")).toHaveText("이야기로 읽고, 퀴즈로 익히는 영어 감각");
  await expect(page.locator('main a.link-card[href^="/reading/"]')).toHaveCount(15);
  await expect(page.locator('main a.story-pair-unit-link[href^="/prep/"]')).toHaveCount(13);

  // Category filter tabs filter the story card grid and return to all 15 stories
  const filterGroup = page.getByRole("group", { name: "작품별 이야기 분류" });
  await expect(filterGroup).toBeVisible();
  await filterGroup.getByRole("button", { name: /입문·감각 이야기/ }).click();
  await expect(page.locator('main a.link-card[href^="/reading/"]')).toHaveCount(2);
  await filterGroup.getByRole("button", { name: /Wonder 시리즈/ }).click();
  await expect(page.locator('main a.link-card[href^="/reading/"]')).toHaveCount(9);
  await filterGroup.getByRole("button", { name: /영화 명장면/ }).click();
  await expect(page.locator('main a.link-card[href^="/reading/"]')).toHaveCount(4);
  await filterGroup.getByRole("button", { name: /전체 이야기/ }).click();
  await expect(page.locator('main a.link-card[href^="/reading/"]')).toHaveCount(15);

  // Follow a paired prep unit link from the story hub, then jump back to its paired story from the unit page
  await page.locator('main a.story-pair-unit-link[href="/prep/wonder/unit-0/"]').click();
  await expect(page).toHaveURL(/\/prep\/wonder\/unit-0\/$/);
  const topPairLink = page.locator('.lw-document-flow > .pair-note a[href="/reading/prep-wonder-0/"]');
  await expect(topPairLink).toBeVisible();
  await topPairLink.click();
  await expect(page).toHaveURL(/\/reading\/prep-wonder-0\/$/);
});

test("the explainer keeps its request identity and input through a mocked wait, success and usage-limit failure", async ({ page }) => {
  // Every response in this test is mocked; no provider is called.
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const bodies: unknown[] = [];
  await page.route("**/api/explain**", async route => {
    bodies.push(route.request().postDataJSON());
    await waiting;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(ask.sample) });
  });
  await page.goto("/ask/");
  const field = page.getByLabel("해설할 영어 문장을 넣으십시오.");
  await expect(field).toHaveAttribute("maxlength", "300");
  await field.fill("  A sentence for the mocked explanation.  ");
  const submit = page.getByRole("button", { name: "해설 보기", exact: true });
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(page.locator("#result")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("tab", { name: "한국어를 영어로", exact: true })).toBeDisabled();
  await expect.poll(() => bodies.length).toBe(1);
  await field.press("Control+Enter");
  const editedDraft = "A different draft while the original request is waiting.";
  await field.fill(editedDraft);
  await expect(page.locator(".ask-submitted blockquote")).toHaveText("A sentence for the mocked explanation.");
  await navigation(page).getByRole("button", { name: "수업 목록", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(bodies).toEqual([{ text: "A sentence for the mocked explanation." }]);
  release();
  await expect(page.locator("#result .en-big")).toHaveText(ask.sample.english);
  await expect(submit).toBeEnabled();
  await expect(field).toHaveValue(editedDraft);
  await page.route("**/api/explain**", route => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ detail: "검증용 사용량 제한" }) }));
  await submit.click();
  await expect(page.locator("#result").getByRole("alert")).toHaveText("검증용 사용량 제한");
  await expect(field).toHaveValue(editedDraft);
  await expect(submit).toBeEnabled();
});

test("unknown addresses like /readings/ return 404 inside the unified public-app shell with navigation links", async ({ page }) => {
  const response = await page.goto("/readings/");
  expect(response?.status()).toBe(404);
  await expect(page.locator(".public-app")).toBeVisible();
  await expect(page.locator("main h1")).toHaveText("페이지를 찾을 수 없습니다");
  const readingLink = page.locator("main a[href='/reading/']").first();
  await expect(readingLink).toBeVisible();
  await readingLink.click();
  await expect(page).toHaveURL(/\/reading\/$/);
});
