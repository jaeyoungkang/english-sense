import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import askData from "../../content/ask.json";
import type { Explanation } from "../../lib/ask-contract";
import type { ArtifactLearningChatRequest } from "../../lib/learning-chat-contract";
import type { ScopeRecordEnvelope } from "../../lib/learner-record-contract";
import type { WebProcessBundle } from "../../lib/process-bundle";
import { importBundleToStudyDirectory } from "../../scripts/sync-study-records";
import { authenticateOwnerContext, signTestAccessJwt } from "./access-test-auth";
import { openFirstAnswerInput } from "./workspace-input";

const readyWorkspace = async (page: Page) => {
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
};

const readyAsk = async (page: Page) => {
  await expect(page.locator(".ask-storage-fact")).not.toContainText("기록 확인 중");
};

const newTestOwnerSub = () => `test-owner-${crypto.randomUUID().slice(0, 12)}`;

test.describe("learner record preservation: owner auth, durable server sync, conflict, import/archive, and canonical export", () => {
  test("owner access boundary rejects unauthenticated, non-owner, and disallowed-host/origin requests while keeping public learning open", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "API and multi-context suite runs on chromium");

    // 1. Public learning works without login and makes zero automatic calls to /api/learner-records/
    const recordApiCalls: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/learner-records")) recordApiCalls.push(req.url());
    });

    await page.goto("/");
    await readyWorkspace(page);
    await expect(page.locator(".lw-personal-sync")).toContainText("개인 서버 보관 연결");
    expect(recordApiCalls).toEqual([]);

    // 2. Direct API calls without token fail with 401 unauthenticated
    const unauthGet = await request.get("/api/learner-records/?scope=titanic-have");
    expect(unauthGet.status()).toBe(401);
    expect(await unauthGet.json()).toMatchObject({ ok: false, code: "unauthenticated" });

    const unauthExport = await request.get("/api/learner-records/export/");
    expect(unauthExport.status()).toBe(401);

    const unauthExec = await request.get("/api/learner-records/executions/?scope=titanic-have&requestId=req-1");
    expect(unauthExec.status()).toBe(401);

    // 3. Valid RS256 token for a non-owner email fails with 403 forbidden_user
    const strangerToken = signTestAccessJwt({ email: "stranger@example.com", sub: "sub-stranger" });
    const strangerRes = await request.get("/api/learner-records/?scope=titanic-have", {
      headers: { "cf-access-jwt-assertion": strangerToken },
    });
    expect(strangerRes.status()).toBe(403);
    expect(await strangerRes.json()).toMatchObject({ ok: false, code: "forbidden_user" });

    // 4. Cross-origin and cross-site requests fail with 403 origin_forbidden
    const ownerToken = signTestAccessJwt();
    const badOriginRes = await request.post("/api/learner-records/", {
      headers: {
        "cf-access-jwt-assertion": ownerToken,
        origin: "https://evil.example.com",
      },
      data: {},
    });
    expect(badOriginRes.status()).toBe(403);
    expect(await badOriginRes.json()).toMatchObject({ ok: false, code: "origin_forbidden" });

    const crossSiteRes = await request.post("/api/learner-records/", {
      headers: {
        "cf-access-jwt-assertion": ownerToken,
        "sec-fetch-site": "cross-site",
      },
      data: {},
    });
    expect(crossSiteRes.status()).toBe(403);
    expect(await crossSiteRes.json()).toMatchObject({ ok: false, code: "origin_forbidden" });
  });

  test("cross-device resumption and revision conflict resolution preserve both drafts across two browser contexts", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "API and multi-context suite runs on chromium");
    const targetUrl = baseURL || "http://127.0.0.1:8787";
    const ownerSub = newTestOwnerSub();

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      await authenticateOwnerContext(contextA, targetUrl, { sub: ownerSub });
      await authenticateOwnerContext(contextB, targetUrl, { sub: ownerSub });

      const pageA = await contextA.newPage();
      await pageA.goto(`${targetUrl}/prep/wonder/unit-4/`);
      await readyWorkspace(pageA);
      await expect(pageA.locator(".lw-personal-sync")).toContainText("개인 서버에 보관됨");

      // Submit card 1 attempt on Device A
      const card1 = pageA.locator('section.cl-card[data-question-id="wonder-4-01"]');
      await card1.getByLabel("빈칸 1", { exact: true }).fill("kind of");
      const checkResponsePromise = pageA.waitForResponse(res => res.url().includes("/api/lesson-check/"));
      await card1.getByRole("button", { name: "첫 답 남기기" }).click();
      await checkResponsePromise;

      // Also type a draft in card 2 on Device A
      const card2A = pageA.locator('section.cl-card[data-question-id="wonder-4-02"]');
      await card2A.getByLabel("빈칸 1", { exact: true }).fill("draft-from-device-A");

      // Wait for Device A to finish syncing to server
      await expect
        .poll(async () => {
          const res = await contextA.request.get(`${targetUrl}/api/learner-records/?scope=wonder-unit-4`);
          const env = (await res.json()) as ScopeRecordEnvelope;
          const state = env.state as { artifacts?: { question: { questionId: string }; inputs: string[]; attempts: unknown[] }[] } | null;
          const c1 = state?.artifacts?.find(a => a.question.questionId === "wonder-4-01");
          const c2 = state?.artifacts?.find(a => a.question.questionId === "wonder-4-02");
          return Boolean(c1?.attempts.length === 1 && c2?.inputs[0] === "draft-from-device-A");
        })
        .toBe(true);

      // Open Device B with empty localStorage and verify cross-device resumption
      const pageB = await contextB.newPage();
      await pageB.goto(`${targetUrl}/prep/wonder/unit-4/`);
      await readyWorkspace(pageB);
      await expect(pageB.locator(".lw-personal-sync")).toContainText("개인 서버에 보관됨");

      const card2B = pageB.locator('section.cl-card[data-question-id="wonder-4-02"]');
      await expect(card2B.getByLabel("빈칸 1", { exact: true })).toHaveValue("draft-from-device-A");
      const card1B = pageB.locator('section.cl-card[data-question-id="wonder-4-01"]');
      await expect(card1B.locator(".cl-trail")).toContainText("첫 답");

      // Advance server revision on Device B by editing card 2
      await card2B.getByLabel("빈칸 1", { exact: true }).fill("updated-on-device-B");
      await expect
        .poll(async () => {
          const res = await contextB.request.get(`${targetUrl}/api/learner-records/?scope=wonder-unit-4`);
          const env = (await res.json()) as ScopeRecordEnvelope;
          const state = env.state as { artifacts?: { question: { questionId: string }; inputs: string[] }[] } | null;
          return state?.artifacts?.find(a => a.question.questionId === "wonder-4-02")?.inputs[0];
        })
        .toBe("updated-on-device-B");

      // Now edit card 3 on Device A (which still holds the older expectedRevision) -> triggers 409 revision_conflict
      const card3A = pageA.locator('section.cl-card[data-question-id="wonder-4-03"]');
      await card3A.getByLabel("빈칸 1", { exact: true }).fill("conflicting-draft-from-A");

      await expect(pageA.locator(".lw-personal-sync")).toHaveAttribute("data-sync-status", "revision-conflict");
      await expect(pageA.locator(".lw-sync-conflict")).toContainText("다른 기기나 창에서 먼저 저장한 변경이 있습니다");
      await expect(pageA.getByRole("button", { name: "서버 최신 상태 유지" })).toBeVisible();
      await expect(pageA.getByRole("button", { name: "이 기기 초안 반영" })).toBeVisible();

      // Resolve by adopting Device A's draft
      await pageA.getByRole("button", { name: "이 기기 초안 반영" }).click();
      await expect(pageA.locator(".lw-personal-sync")).toHaveAttribute("data-sync-status", "server-saved");
      await expect(card3A.getByLabel("빈칸 1", { exact: true })).toHaveValue("conflicting-draft-from-A");

      const afterResolveRes = await contextA.request.get(`${targetUrl}/api/learner-records/?scope=wonder-unit-4`);
      const afterResolveEnv = (await afterResolveRes.json()) as ScopeRecordEnvelope;
      expect(afterResolveEnv.conflictingDrafts).toHaveLength(0);
      const resolvedState = afterResolveEnv.state as { artifacts?: { question: { questionId: string }; inputs: string[] }[] };
      expect(resolvedState.artifacts?.find(a => a.question.questionId === "wonder-4-03")?.inputs[0]).toBe("conflicting-draft-from-A");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("pre-login browser records require explicit import, and starting a new run archives the previous run with restoration", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "API and multi-context suite runs on chromium");
    const targetUrl = baseURL || "http://127.0.0.1:8787";
    const ownerSub = newTestOwnerSub();

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route("**/api/learn-chat/**", async route => {
        const body = route.request().postDataJSON() as ArtifactLearningChatRequest;
        await route.fulfill({
          json: {
            requestId: body.requestId,
            artifactId: body.artifactId,
            questionId: body.questionId,
            contentVersion: body.contentVersion,
            reply: "검사용 모의 AI 해설 응답입니다.",
            mode: "ai",
          },
        });
      });

      // 1. Work in unauthenticated browser first on / (titanic-have)
      await page.goto(`${targetUrl}/`);
      await readyWorkspace(page);

      await openFirstAnswerInput(page, 1);
      const firstForm = page.getByRole("form", { name: "1번 퀴즈 첫 답", exact: true });
      await firstForm.locator('input[type="radio"]').nth(1).check();
      await firstForm.getByLabel("그 문장을 고른 까닭").fill("브라우저 가져오기를 검증하는 첫 풀이입니다.");
      await firstForm.getByRole("button", { name: "내 답 제출하고 대화하기" }).click();
      await expect(page.getByText("검사용 모의 AI 해설 응답입니다.", { exact: true })).toBeVisible();

      // 2. Log in (add CF_Authorization cookie) and reload
      await authenticateOwnerContext(context, targetUrl, { sub: ownerSub });
      await page.reload();
      await readyWorkspace(page);

      // Must NOT auto-import without explicit user action
      await expect(page.locator(".lw-sync-import")).toContainText("로그인 전 이 브라우저에 작성한 임시 기록이 있습니다");
      const beforeImportRes = await context.request.get(`${targetUrl}/api/learner-records/?scope=titanic-have`);
      const beforeImportEnv = (await beforeImportRes.json()) as ScopeRecordEnvelope;
      expect(beforeImportEnv.state).toBeNull();

      // 3. Click explicit import button
      await page.getByRole("button", { name: "이 브라우저 기록을 개인 서버로 가져오기" }).click();
      await expect(page.locator(".lw-personal-sync")).toContainText("개인 서버에 보관됨 · 정본 반영 대기 · 브라우저 기록 가져옴");

      const afterImportRes = await context.request.get(`${targetUrl}/api/learner-records/?scope=titanic-have`);
      const afterImportEnv = (await afterImportRes.json()) as ScopeRecordEnvelope;
      expect(afterImportEnv.provenance).toBe("browser-import");

      const exportRes = await context.request.get(`${targetUrl}/api/learner-records/export/`);
      const exportBundle = (await exportRes.json()) as WebProcessBundle;
      expect(exportBundle.legacyImports.some(item => item.scope === "titanic-have")).toBe(true);
      expect(
        exportBundle.events.some(
          ev =>
            ev.scope === "titanic-have" &&
            ev.kind === "initial" &&
            ev.questionId === "titanic-have-1" &&
            ev.canonicalProblemId === "have-1-choose-1" &&
            ev.canonicalMapped === true,
        ),
      ).toBe(true);

      // 4. Archive and start a new run
      await page.getByRole("button", { name: "보관함으로 옮기고 새 실행 시작" }).click();
      await expect(page.locator(".lw-archive-runs summary")).toContainText("이전 실행 보관함 (1건)");
      await expect(page.getByText("검사용 모의 AI 해설 응답입니다.", { exact: true })).toHaveCount(0);

      // 5. Restore the archived run
      await page.locator(".lw-archive-runs summary").click();
      await page.getByRole("button", { name: "이 실행 복원" }).click();
      await expect(page.getByText("검사용 모의 AI 해설 응답입니다.", { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("failed check history, /ask/ cross-device sync, server execution recovery, and study-and-learn canonical export + ack", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "API and multi-context suite runs on chromium");
    const targetUrl = baseURL || "http://127.0.0.1:8787";
    const ownerSub = newTestOwnerSub();

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const tempStudyRoot = mkdtempSync(join(tmpdir(), "study-and-learn-e2e-"));
    try {
      const ownerToken = await authenticateOwnerContext(contextA, targetUrl, { sub: ownerSub });
      await authenticateOwnerContext(contextB, targetUrl, { sub: ownerSub });

      const pageA = await contextA.newPage();

      // 1. Intermediate check failure history on /prep/wonder/unit-2/
      let failOnce = true;
      await pageA.route("**/api/lesson-check/**", async route => {
        if (failOnce) {
          failOnce = false;
          await route.fulfill({ status: 500, json: { error: "일시적 판정 오류" } });
          return;
        }
        await route.continue();
      });

      await pageA.goto(`${targetUrl}/prep/wonder/unit-2/`);
      await readyWorkspace(pageA);
      const card1 = pageA.locator('section.cl-card[data-question-id="wonder-2-01"]');
      await card1.getByLabel("빈칸 1", { exact: true }).fill("test");
      await card1.getByRole("button", { name: "첫 답 남기기" }).click();
      await expect(card1.getByRole("button", { name: "다시 판정" })).toBeVisible();

      const retryCheckPromise = pageA.waitForResponse(res => res.url().includes("/api/lesson-check/") && res.status() === 200);
      await card1.getByRole("button", { name: "다시 판정" }).click();
      await retryCheckPromise;

      await expect
        .poll(async () => {
          const res = await contextA.request.get(`${targetUrl}/api/learner-records/export/`);
          const bundle = (await res.json()) as WebProcessBundle;
          const kinds = bundle.events.filter(e => e.scope === "wonder-unit-2").map(e => e.kind);
          return kinds.includes("check-failed") && kinds.includes("check");
        })
        .toBe(true);

      // 2. /ask/ cross-device sync
      const sampleExplanation: Explanation = {
        ...(askData.sample as Explanation),
        english: "I have a lot on my plate.",
        korean: "내가 지금 챙겨야 할 일이 많아.",
      };
      await pageA.route("**/api/explain**", async route => {
        await route.fulfill({ json: sampleExplanation });
      });

      await pageA.goto(`${targetUrl}/ask/`);
      await readyAsk(pageA);
      await expect(pageA.locator(".ask-storage-fact")).toContainText("개인 서버 보관 연결됨");

      await pageA.locator("#input").fill("I have a lot on my plate.");
      await pageA.getByRole("button", { name: "해설 보기", exact: true }).click();
      await expect(pageA.locator("#res-badge")).toHaveText("응답 받음");
      await pageA.getByLabel("이 해설에 대해 추가 질문하기", { exact: true }).fill("plate는 접시라는 뜻인가요?");

      await expect
        .poll(async () => {
          const res = await contextA.request.get(`${targetUrl}/api/learner-records/?scope=ask`);
          const env = (await res.json()) as ScopeRecordEnvelope;
          const state = env.state as { entries?: { text: string; followupDraft: string }[] } | null;
          return state?.entries?.[0]?.followupDraft;
        })
        .toBe("plate는 접시라는 뜻인가요?");

      // Verify Device B resumes /ask/ entry and followupDraft from server
      const pageB = await contextB.newPage();
      await pageB.goto(`${targetUrl}/ask/`);
      await readyAsk(pageB);
      await expect(pageB.locator(".ask-submitted blockquote")).toHaveText("I have a lot on my plate.");
      await expect(pageB.getByLabel("이 해설에 대해 추가 질문하기", { exact: true })).toHaveValue("plate는 접시라는 뜻인가요?");

      // 3. Export canonical bundle -> write to study-and-learn temp dir -> Ack receipt -> UI badge updates to "정본 보관 확인됨"
      const exportRes = await contextA.request.get(`${targetUrl}/api/learner-records/export/`);
      expect(exportRes.ok()).toBe(true);
      const rawBundle = (await exportRes.json()) as WebProcessBundle;
      const syncResult = await importBundleToStudyDirectory(rawBundle, {
        studyRootDir: tempStudyRoot,
        expectedOwnerId: ownerSub,
      });
      expect(syncResult.status).toBe("imported");
      expect(syncResult.canonicalFile.events.length).toBeGreaterThan(0);

      const ackRes = await contextA.request.post(`${targetUrl}/api/learner-records/ack/`, {
        headers: { "cf-access-jwt-assertion": ownerToken },
        data: syncResult.ack,
      });
      expect(ackRes.ok()).toBe(true);
      expect(await ackRes.json()).toMatchObject({
        ok: true,
        canonicalExport: { status: "canonical-acknowledged" },
      });

      const writtenFile = JSON.parse(readFileSync(syncResult.filePath, "utf8")) as { bundleId: string; events: unknown[] };
      expect(writtenFile.bundleId).toBe(syncResult.canonicalFile.bundleId);
      expect(writtenFile.events.length).toBe(syncResult.canonicalFile.events.length);

      // Reload pageA and verify the UI badge now shows "정본 보관 확인됨"
      await pageA.reload();
      await readyAsk(pageA);
      await expect(pageA.locator(".lw-personal-sync")).toContainText("개인 서버에 보관됨 · 정본 보관 확인됨");
    } finally {
      rmSync(tempStudyRoot, { recursive: true, force: true });
      await contextA.close();
      await contextB.close();
    }
  });

  test("mobile viewport renders personal record sync bar without horizontal overflow", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile layout check runs on mobile project");
    const targetUrl = baseURL || "http://127.0.0.1:8787";

    const context = await browser.newContext();
    try {
      await authenticateOwnerContext(context, targetUrl, { sub: newTestOwnerSub() });
      const page = await context.newPage();
      await page.goto(`${targetUrl}/prep/wonder/unit-8/`);
      await readyWorkspace(page);
      await expect(page.locator(".lw-personal-sync")).toContainText("개인 서버에 보관됨");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
    } finally {
      await context.close();
    }
  });
});
