import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isLessonCheckRequest, isLessonCheckResponse, lessonCheckLimits, type LessonCheckRequest, type LessonCheckResponse } from "../lib/lesson-contract";
import { LESSONS } from "../lib/lesson-registry";
import { getLessonContentVersion } from "../lib/server/lesson-catalog";
import { handleLessonCheck } from "../lib/server/lesson-check";
import { LessonAttemptError, judge } from "../lib/server/lesson-judge";
import { getServerLessonQuestion } from "../lib/server/lesson-catalog";
import { getStudySource } from "../lib/server/study-source";
import type { ApiEnv, Dependencies } from "../lib/server/api";

const { reading, prep } = getStudySource();
const story = reading.stories[0];
const storyQuestion = story.questions[0];
const unit = prep.works[0].units[0];
const card = unit.cards.find((item) => item.id === "wonder-0-12")!; // 빈칸 둘: pick … up
const goingCard = prep.works.find((work) => work.id === "wonder")!.units.flatMap((item) => item.cards).find((item) => item.id === "wonder-1-07")!;

function post(value: unknown, headers: HeadersInit = {}, url = "https://english.example/api/lesson-check/"): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof value === "string" ? value : JSON.stringify(value) });
}

async function storyRequest(overrides: Partial<LessonCheckRequest> = {}): Promise<LessonCheckRequest> {
  return { action: "check", lessonId: story.id, questionId: storyQuestion.id, contentVersion: await getLessonContentVersion(story.id), artifactId: "quiz-story-1", requestId: "req-1", attempt: { kind: "choose", choice: 0 }, ...overrides };
}

async function cardRequest(overrides: Partial<LessonCheckRequest> = {}, target = card): Promise<LessonCheckRequest> {
  const lessonId = prep.works.flatMap((work) => work.units.map((item) => ({ work, item }))).find(({ item }) => item.cards.includes(target))!;
  const id = `${lessonId.work.id}-unit-${lessonId.item.n}`;
  return { action: "check", lessonId: id, questionId: target.id, contentVersion: await getLessonContentVersion(id), artifactId: "quiz-card-1", requestId: "req-2", attempt: { kind: "fill", inputs: target.drill.answers.map(() => "wrong") }, ...overrides };
}

/** 값을 읽는 순간 실패하는 객체: 판정이 한도 객체(env)나 fetch(dependencies)에 닿으면 테스트가 깨진다. */
function trap<T extends object>(label: string): T {
  return new Proxy({}, { get: (_target, key) => { throw new Error(`${label}.${String(key)}에 닿았습니다`); }, has: () => { throw new Error(`${label}에 닿았습니다`); } }) as T;
}

async function call(value: unknown, headers?: HeadersInit): Promise<{ status: number; body: any; text: string; response: Response }> {
  const response = await handleLessonCheck(post(value, headers), trap<ApiEnv>("env"), trap<Dependencies>("dependencies"));
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), text, response };
}

test("a story choice is judged and only that response opens the answer, explanation and basis", async () => {
  const wrong = storyQuestion.answer === 0 ? 1 : 0;
  for (const [choice, match] of [[storyQuestion.answer, true], [wrong, false]] as const) {
    const { status, body, response } = await call(await storyRequest({ attempt: { kind: "choose", choice } }));
    assert.equal(status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(isLessonCheckResponse(body));
    assert.equal(body.kind, "choose");
    if (body.kind !== "choose") continue;
    assert.deepEqual([body.choice, body.match, body.answerIndex, body.explain], [choice, match, storyQuestion.answer, storyQuestion.explain]);
    assert.equal(body.basis, storyQuestion.basis);
    assert.deepEqual([body.requestId, body.lessonId, body.artifactId, body.questionId], ["req-1", story.id, "quiz-story-1", storyQuestion.id]);
    assert.equal(body.contentVersion, await getLessonContentVersion(story.id));
  }
});

test("a story response carries basis only when the source has one", async () => {
  for (const item of reading.stories.flatMap((s) => s.questions.map((q) => ({ s, q })))) {
    const { body } = await call(await storyRequest({ lessonId: item.s.id, questionId: item.q.id, contentVersion: await getLessonContentVersion(item.s.id), attempt: { kind: "choose", choice: item.q.answer } }));
    assert.ok(isLessonCheckResponse(body), `${item.q.id}`);
    assert.equal(Object.hasOwn(body, "basis"), item.q.basis !== undefined, item.q.id);
    assert.equal(body.kind === "choose" && body.match, true);
  }
});

test("fill compares each blank with the shared normalization and does not call gonna and going to the same", async () => {
  const pairs: [string[], boolean[]][] = [
    [["pick", "up"], [true, true]],
    [["  PICK ", "Up"], [true, true]],
    [["pick", "down"], [true, false]],
    [["pickup", "up"], [false, true]],
    [["pick", ""], [true, false]],
  ];
  for (const [inputs, expected] of pairs) {
    const { status, body } = await call(await cardRequest({ attempt: { kind: "fill", inputs } }));
    assert.equal(status, 200);
    assert.ok(isLessonCheckResponse(body));
    assert.deepEqual([body.kind, (body as any).matches, (body as any).allMatch], ["fill", expected, expected.every(Boolean)]);
  }
  const going = await call(await cardRequest({ attempt: { kind: "fill", inputs: ["going to school"] } }, goingCard));
  assert.deepEqual(going.body.matches, [true]);
  const gonna = await call(await cardRequest({ attempt: { kind: "fill", inputs: ["gonna school"] } }, goingCard));
  assert.deepEqual(gonna.body.matches, [false]);
  const curly = prep.works.flatMap((work) => work.units.flatMap((item) => item.cards)).find((item) => item.id === "wonder-1-10")!;
  assert.deepEqual((await call(await cardRequest({ attempt: { kind: "fill", inputs: ["That’s What"] } }, curly))).body.matches, [true]);
});

test("a wrong fill response never contains a canonical answer, by key or by text", async () => {
  const skeleton = (body: Record<string, unknown>) => { const { requestId, lessonId, artifactId, questionId, contentVersion, ...rest } = body; return rest; };
  let cards = 0;
  for (const work of prep.works) for (const item of work.units) for (const target of item.cards) {
    cards += 1;
    const { status, body } = await call(await cardRequest({ attempt: { kind: "fill", inputs: target.drill.answers.map(() => "zzz") } }, target));
    assert.equal(status, 200, target.id);
    assert.deepEqual(Object.keys(body).sort(), ["allMatch", "artifactId", "contentVersion", "kind", "lessonId", "matches", "questionId", "requestId"], target.id);
    assert.deepEqual(skeleton(body), { kind: "fill", matches: target.drill.answers.map(() => false), allMatch: false }, target.id);
  }
  assert.equal(cards, prep.works.reduce((sum, work) => sum + work.units.reduce((s, item) => s + item.cards.length, 0), 0));
  // 응답 전체 문자열에도 답이 없다. 되돌리는 ID에 우연히 들어가지 않도록 요청 ID를 고정 문자열로 둔다.
  const { text } = await call(await cardRequest({ attempt: { kind: "fill", inputs: ["zzz", "zzz"] } }));
  for (const answer of card.drill.answers) assert.ok(!text.toLowerCase().replace(/"contentversion":"[a-f0-9]+"/, "").includes(`"${answer}"`), answer);
  // 정답을 입력해 같음이 되어도 응답은 답 문자열을 새로 내지 않는다.
  const matched = await call(await cardRequest());
  const sameAnswer = await call(await cardRequest({ attempt: { kind: "fill", inputs: card.drill.answers } }));
  assert.deepEqual(Object.keys(sameAnswer.body).sort(), Object.keys(matched.body).sort());
  assert.ok(!("answers" in sameAnswer.body));
});

test("reveal opens the canonical answers only when a first answer comes with it", async () => {
  const withAttempt = await call(await cardRequest({ action: "reveal", attempt: { kind: "fill", inputs: ["pick", ""] } }));
  assert.equal(withAttempt.status, 200);
  assert.ok(isLessonCheckResponse(withAttempt.body));
  assert.deepEqual(withAttempt.body.kind === "reveal" ? withAttempt.body.answers : null, card.drill.answers);
  for (const attempt of [null, undefined, { kind: "fill", inputs: ["", ""] }, { kind: "fill", inputs: [] }, { kind: "choose", choice: 0 }]) {
    const request: Record<string, unknown> = { ...(await cardRequest({ action: "reveal" })), attempt };
    if (attempt === undefined) delete request.attempt;
    const { status, body, text } = await call(request);
    assert.equal(status, 400, JSON.stringify(attempt));
    assert.equal(body.error.code, "invalid_request");
    for (const answer of card.drill.answers) assert.ok(!text.includes(`"${answer}"`));
  }
  // 이야기에는 답 보기가 없다.
  assert.equal((await call(await storyRequest({ action: "reveal", attempt: { kind: "fill", inputs: ["a"] } }))).status, 400);
  // 빈칸 수가 다른 시도로는 열리지 않는다.
  assert.equal((await call(await cardRequest({ action: "reveal", attempt: { kind: "fill", inputs: ["pick"] } }))).status, 400);
});

test("an old content version is rejected with 409 before any judgement", async () => {
  const { status, body, text } = await call(await storyRequest({ contentVersion: "0".repeat(64) }));
  assert.equal(status, 409);
  assert.equal(body.error.code, "content_changed");
  assert.ok(!text.includes(storyQuestion.explain));
  const other = await call(await cardRequest({ contentVersion: await getLessonContentVersion(story.id) }));
  assert.equal(other.status, 409);
  for (const answer of card.drill.answers) assert.ok(!other.text.includes(`"${answer}"`));
});

test("malformed requests are rejected before judgement", async () => {
  const good = await storyRequest();
  const goodCard = await cardRequest();
  const cases: [string, unknown][] = [
    ["extra key", { ...good, reason: "x" }],
    ["missing key", (({ artifactId, ...rest }) => rest)(good)],
    ["unknown action", { ...good, action: "judge" }],
    ["bad lesson id", { ...good, lessonId: "a b" }],
    ["bad request id", { ...good, requestId: "" }],
    ["bad version", { ...good, contentVersion: "abc" }],
    ["choice out of range", { ...good, attempt: { kind: "choose", choice: lessonCheckLimits.choices } }],
    ["negative choice", { ...good, attempt: { kind: "choose", choice: -1 } }],
    ["fractional choice", { ...good, attempt: { kind: "choose", choice: 1.5 } }],
    ["choice with reason", { ...good, attempt: { kind: "choose", choice: 0, reason: "x" } }],
    ["unknown attempt kind", { ...good, attempt: { kind: "produce", text: "x" } }],
    ["no attempt", { ...good, attempt: null }],
    ["four blanks", { ...goodCard, attempt: { kind: "fill", inputs: ["a", "b", "c", "d"] } }],
    ["no blanks", { ...goodCard, attempt: { kind: "fill", inputs: [] } }],
    ["non-string blank", { ...goodCard, attempt: { kind: "fill", inputs: ["a", 1] } }],
    ["long blank", { ...goodCard, attempt: { kind: "fill", inputs: ["a".repeat(lessonCheckLimits.input + 1), "b"] } }],
    ["blank blanks", { ...goodCard, attempt: { kind: "fill", inputs: [" ", ""] } }],
    ["array body", [good]],
    ["null body", null],
    ["not json", "{"],
  ];
  for (const [label, value] of cases) {
    const { status, body } = await call(value);
    assert.equal(status, 400, label);
    assert.equal(body.error.code, "invalid_request", label);
  }
  // 형식은 맞지만 문제와 맞지 않는 시도
  assert.equal((await call({ ...goodCard, attempt: { kind: "fill", inputs: ["only one"] } })).status, 400);
  assert.equal((await call({ ...goodCard, attempt: { kind: "choose", choice: 0 } })).status, 400);
  assert.equal((await call({ ...good, attempt: { kind: "fill", inputs: ["x"] } })).status, 400);
  // 보기가 네 개보다 적은 문항이 생기면 보기 수로 거절한다.
  assert.throws(() => judge(getServerLessonQuestion(story.id, storyQuestion.id), { kind: "choose", choice: storyQuestion.options.length }), LessonAttemptError);
  const wrongMethod = await handleLessonCheck(new Request("https://english.example/api/lesson-check/", { method: "GET" }), trap<ApiEnv>("env"), trap<Dependencies>("dependencies"));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
});

test("unknown lessons and questions, foreign questions and the scene lesson are refused", async () => {
  const good = await storyRequest();
  const missingLesson = await call({ ...good, lessonId: "no-such-lesson" });
  assert.deepEqual([missingLesson.status, missingLesson.body.error.code], [404, "not_found"]);
  for (const lessonId of ["__proto__", "constructor"]) assert.equal((await call({ ...good, lessonId })).status, 404);
  assert.equal((await call({ ...good, questionId: "no-such-question" })).status, 404);
  assert.equal((await call({ ...good, questionId: card.id })).status, 404);
  const scene = await call({ ...good, lessonId: "titanic-have", questionId: "titanic-have-1" });
  assert.deepEqual([scene.status, scene.body.error.code], [400, "unsupported_lesson"]);
});

test("body size, content type and Origin are checked before the body is read as a request", async () => {
  const good = await storyRequest();
  const big = await call({ ...good, requestId: "x".repeat(lessonCheckLimits.bodyBytes) });
  assert.equal(big.status, 413);
  const declared = await handleLessonCheck(post(good, { "content-length": String(lessonCheckLimits.bodyBytes + 1) }));
  assert.equal(declared.status, 413);
  const text = await handleLessonCheck(new Request("https://english.example/api/lesson-check/", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(good) }));
  assert.equal(text.status, 415);
  const foreign = await call(good, { origin: "https://evil.example" });
  assert.deepEqual([foreign.status, foreign.body.error.code], [403, "origin_forbidden"]);
  assert.ok(!foreign.text.includes(storyQuestion.explain));
  assert.equal((await call(good, { origin: "https://english.example" })).status, 200);
  // Origin 거절이 형식 거절보다 먼저다: 본문이 깨져도 403이다.
  assert.equal((await handleLessonCheck(post("{", { origin: "https://evil.example" }))).status, 403);
});

test("judging reaches neither the quota object nor the provider and works when the daily quota is spent", async () => {
  const calls: string[] = [];
  const exhausted: ApiEnv = {
    ANTHROPIC_API_KEY: "test-key-never-real",
    PER_IP_PER_DAY: "0",
    GLOBAL_PER_DAY: "0",
    QUOTA_LIMITER: {
      idFromName: (name) => { calls.push("idFromName"); return name; },
      get: () => ({ fetch: async () => { calls.push("quota.fetch"); return Response.json({ reason: "global" }, { status: 429 }); } }),
    },
  };
  const spy: typeof fetch = async () => { calls.push("fetch"); return Response.json({}); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = spy;
  try {
    for (const value of [await storyRequest(), await cardRequest(), await cardRequest({ action: "reveal", attempt: { kind: "fill", inputs: ["pick", "up"] } })]) {
      const response = await handleLessonCheck(post(value, { "cf-connecting-ip": "203.0.113.7" }), exhausted, { fetch: spy });
      assert.equal(response.status, 200);
      await response.text();
    }
    // 거절한 요청도 마찬가지다.
    assert.equal((await handleLessonCheck(post({ nope: 1 }), exhausted, { fetch: spy })).status, 400);
    assert.equal((await handleLessonCheck(post(await storyRequest({ contentVersion: "1".repeat(64) })), exhausted, { fetch: spy })).status, 409);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(calls, []);
});

test("the judging modules do not import quota, provider or Cloudflare code", () => {
  for (const file of ["../lib/server/lesson-check.ts", "../lib/server/lesson-judge.ts", "../app/api/lesson-check/route.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/takeQuota|QUOTA_LIMITER|getApiEnvironment|server\/cloudflare|anthropic|\bfetch\s*\(/i.test(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/"[^"\n]*"/g, '""')), file);
  }
});

test("judging is idempotent: the same request gets the same response", async () => {
  for (const value of [await storyRequest(), await cardRequest(), await cardRequest({ action: "reveal", attempt: { kind: "fill", inputs: ["pick", "up"] } })]) {
    const first = await call(value);
    const second = await call(value);
    assert.equal(first.text, second.text);
  }
});

test("every lesson question can be judged and the response passes the shared contract", async () => {
  let checked = 0;
  for (const lesson of LESSONS) {
    if (lesson.kind === "scene") continue;
    const version = await getLessonContentVersion(lesson.lessonId);
    for (const questionId of lesson.questionIds) {
      const question = getServerLessonQuestion(lesson.lessonId, questionId);
      const attempt = question.kind === "story" ? { kind: "choose" as const, choice: question.question.answer } : { kind: "fill" as const, inputs: question.card.drill.answers };
      const { status, body } = await call({ action: "check", lessonId: lesson.lessonId, questionId, contentVersion: version, artifactId: "quiz-x", requestId: "r", attempt });
      assert.equal(status, 200, questionId);
      assert.ok(isLessonCheckResponse(body), questionId);
      assert.equal(body.kind === "choose" ? body.match : (body as Extract<LessonCheckResponse, { kind: "fill" }>).allMatch, true, questionId);
      checked += 1;
    }
  }
  assert.equal(checked, LESSONS.reduce((sum, lesson) => sum + (lesson.kind === "scene" ? 0 : lesson.questionIds.length), 0));
});

test("the request and response guards reject near misses", async () => {
  const good = await storyRequest();
  assert.ok(isLessonCheckRequest(good));
  assert.ok(!isLessonCheckRequest({ ...good, attempt: { kind: "choose", choice: 4 } }));
  const response = (await call(good)).body;
  assert.ok(isLessonCheckResponse(response));
  assert.ok(!isLessonCheckResponse({ ...response, extra: 1 }));
  assert.ok(!isLessonCheckResponse({ ...response, kind: "fill" }));
  assert.ok(!isLessonCheckResponse({ requestId: "r", lessonId: "a", artifactId: "b", questionId: "c", contentVersion: "0".repeat(64), kind: "fill", matches: [true], allMatch: false }));
});
