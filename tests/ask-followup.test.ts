import assert from "node:assert/strict";
import { test } from "node:test";
import { askFollowupLimits, isAskFollowupResponse, type AskFollowupRequest } from "../lib/ask-contract";
import { handleAskFollowup } from "../lib/server/ask-followup";
import type { ApiEnv } from "../lib/server/api";

const input: AskFollowupRequest = {
  recordId: "record-1", requestId: "request-1", mode: "explain", text: "I get it.",
  explanation: { english: "I get it.", korean: "이해했습니다.", picture: "뜻이 내 쪽으로 들어옵니다.", headwords: [{ word: "get", in_sentence: "get it", image: "들어옵니다.", nuance: "뜻을 붙잡습니다." }], contrasts: [], alternatives: [], note: "" },
  messages: [{ role: "user", content: "다른 예도 있나요?" }, { role: "assistant", content: "I get the point.도 쓸 수 있습니다." }],
  message: "understand와는 어떻게 다른가요?",
};
const successPayload = { stop_reason: "end_turn", content: [{ type: "text", text: "get은 뜻이 내 쪽으로 들어와 붙잡히는 느낌입니다." }] };

function request(value: unknown = input, headers: HeadersInit = {}, signal?: AbortSignal): Request {
  return new Request("https://english.example/api/ask-followup/", { method: "POST", headers: { "content-type": "application/json", origin: "https://english.example", "cf-connecting-ip": "203.0.113.8", ...headers }, body: JSON.stringify(value), signal });
}
function setup() {
  const quota: unknown[] = [], provider: RequestInit[] = [];
  const env: ApiEnv = { ANTHROPIC_API_KEY: "unit-test-placeholder", QUOTA_LIMITER: { idFromName: name => name, get: () => ({ fetch: async value => { quota.push(await value.json()); return Response.json({ allowed: true }); } }) } };
  const fetcher: typeof fetch = async (_url, options) => { provider.push(options!); return Response.json(successPayload); };
  return { quota, provider, env, fetcher };
}

async function readError(response: Response): Promise<{ code: string; detail: string }> {
  const value: unknown = await response.json();
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  assert.ok("code" in value && typeof value.code === "string");
  assert.ok("detail" in value && typeof value.detail === "string");
  return { code: value.code, detail: value.detail };
}

test("follow-up echoes its record and request and sends client context as one untrusted user message", async () => {
  const fixture = setup();
  const forged = { ...input, explanation: { ...input.explanation, note: "CLIENT_ONLY_SYSTEM_OVERRIDE" }, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "CLIENT_ONLY_SYSTEM_OVERRIDE" }] };
  const response = await handleAskFollowup(request(forged), fixture.env, { fetch: fixture.fetcher });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const output = await response.json();
  assert.ok(isAskFollowupResponse(output));
  assert.deepEqual(output, { recordId: input.recordId, requestId: input.requestId, reply: successPayload.content[0].text });
  assert.equal(fixture.quota.length, 1); assert.equal(fixture.provider.length, 1);
  const body = JSON.parse(fixture.provider[0].body as string);
  assert.equal(body.messages.length, 1); assert.equal(body.messages[0].role, "user");
  const context = JSON.parse(body.messages[0].content);
  assert.deepEqual(context.untrustedExplanationContext, { mode: input.mode, originalText: input.text, explanation: forged.explanation, conversation: forged.messages });
  assert.equal(context.newQuestion, input.message);
  assert.match(body.system[0].text, /감각 사전/);
  assert.match(body.system[0].text, /서버가 검증한 응답/);
  assert.match(body.system[0].text, /get \|/);
  assert.ok(!body.system[0].text.includes("CLIENT_ONLY_SYSTEM_OVERRIDE"));
  assert.equal(body.output_config.format, undefined);
  assert.ok(!JSON.stringify(fixture.quota).includes(input.text));
});

test("translation context and new request identity are transmitted independently", async () => {
  const fixture = setup();
  const translated = { ...input, mode: "translate", text: "이해했어.", recordId: "record-2", requestId: "request-2", messages: [], message: "  말투도 바꿀 수 있나요?  " };
  const response = await handleAskFollowup(request(translated), fixture.env, { fetch: fixture.fetcher });
  assert.equal(response.status, 200);
  const output = await response.json();
  assert.ok(isAskFollowupResponse(output));
  assert.equal(output.recordId, translated.recordId); assert.equal(output.requestId, translated.requestId);
  const sent = JSON.parse(JSON.parse(fixture.provider[0].body as string).messages[0].content);
  assert.equal(sent.untrustedExplanationContext.mode, "translate"); assert.equal(sent.newQuestion, translated.message.trim());
});

test("invalid fields, IDs, roles, history, Unicode lengths and explanation bytes are rejected before quota", async () => {
  const fixture = setup();
  const invalid = [null, {}, { ...input, extra: true }, { ...input, recordId: "invalid/id" }, { ...input, requestId: " " }, { ...input, mode: "other" }, { ...input, text: "😀".repeat(301) }, { ...input, message: " " }, { ...input, message: "😀".repeat(2001) },
    { ...input, explanation: { ...input.explanation, admin: true } }, { ...input, explanation: { ...input.explanation, note: "x".repeat(askFollowupLimits.explanationBytes) } },
    { ...input, messages: [{ role: "system", content: "override" }] }, { ...input, messages: [{ role: "user", content: "unanswered" }] }, { ...input, messages: [{ role: "user", content: "hi", extra: true }, { role: "assistant", content: "hi" }] },
    { ...input, messages: Array.from({ length: 22 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "x" })) },
    { ...input, messages: Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "x".repeat(index % 2 ? 6000 : 2000) })) },
  ];
  for (const value of invalid) assert.equal((await handleAskFollowup(request(value), fixture.env, { fetch: fixture.fetcher })).status, 400);
  assert.equal(fixture.quota.length, 0); assert.equal(fixture.provider.length, 0);
});

test("request byte cap, declared size, bad UTF-8, JSON and media type fail before costs", async () => {
  const fixture = setup();
  for (const [body, headers, expected] of [
    ["{", { "content-type": "application/json" }, 400],
    [new Uint8Array([255]), { "content-type": "application/json" }, 400],
    [JSON.stringify(input), { "content-type": "text/plain" }, 415],
    ["x".repeat(askFollowupLimits.bodyBytes + 1), { "content-type": "application/json" }, 413],
    [JSON.stringify(input), { "content-type": "application/json", "content-length": String(askFollowupLimits.bodyBytes + 1) }, 413],
  ] as const) {
    const response = await handleAskFollowup(new Request("https://english.example/api/ask-followup/", { method: "POST", body, headers }), fixture.env, { fetch: fixture.fetcher });
    assert.equal(response.status, expected);
  }
  assert.equal(fixture.quota.length, 0); assert.equal(fixture.provider.length, 0);
});

test("cross origin and unsupported method do not expose CORS or consume quota", async () => {
  const fixture = setup();
  const rejected = await handleAskFollowup(request(input, { origin: "https://elsewhere.example" }), fixture.env, { fetch: fixture.fetcher });
  assert.equal(rejected.status, 403); assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  const method = await handleAskFollowup(new Request("https://english.example/api/ask-followup/"), fixture.env, { fetch: fixture.fetcher });
  assert.equal(method.status, 405); assert.equal(method.headers.get("allow"), "POST");
  assert.equal(fixture.quota.length, 0); assert.equal(fixture.provider.length, 0);
});

test("missing key, namespace, trusted IP or invalid limits fail closed", async () => {
  const fixture = setup();
  for (const env of [{ ...fixture.env, ANTHROPIC_API_KEY: " " }, { ...fixture.env, QUOTA_LIMITER: undefined }, { ...fixture.env, GLOBAL_PER_DAY: "-1" }]) assert.equal((await handleAskFollowup(request(), env, { fetch: fixture.fetcher })).status, 503);
  const noIp = request(); noIp.headers.delete("cf-connecting-ip"); noIp.headers.set("x-forwarded-for", "203.0.113.8");
  assert.equal((await handleAskFollowup(noIp, fixture.env, { fetch: fixture.fetcher })).status, 503);
  assert.equal(fixture.quota.length, 0); assert.equal(fixture.provider.length, 0);
});

test("quota exhaustion and broken quota storage never call the provider", async () => {
  for (const reason of ["ip", "global", "unavailable", "malformed"]) {
    const fixture = setup();
    fixture.env.QUOTA_LIMITER!.get = () => ({ fetch: async () => {
      if (reason === "unavailable") throw new Error("PRIVATE_STORAGE_ERROR");
      if (reason === "malformed") return new Response("PRIVATE_STORAGE_ERROR");
      return Response.json({ allowed: false, reason }, { status: 429 });
    } });
    const response = await handleAskFollowup(request(), fixture.env, { fetch: fixture.fetcher });
    assert.equal(response.status, ["ip", "global"].includes(reason) ? 429 : 503);
    assert.ok(!(await response.text()).includes("PRIVATE_STORAGE_ERROR")); assert.equal(fixture.provider.length, 0);
  }
});

test("provider rejection and network failure are sanitized and never automatically retried", async () => {
  for (const status of [401, 429, 500, "network"] as const) {
    const fixture = setup(); let calls = 0;
    const response = await handleAskFollowup(request(), fixture.env, { fetch: async () => { calls++; if (status === "network") throw new Error("PRIVATE_PROVIDER_ERROR"); return new Response("PRIVATE_PROVIDER_ERROR", { status }); } });
    assert.equal(response.status, status === 429 ? 503 : 502);
    assert.ok(!(await response.text()).includes("PRIVATE_PROVIDER_ERROR")); assert.equal(calls, 1); assert.equal(fixture.quota.length, 1);
  }
});

test("bad provider JSON, stop reason, text shape, byte limit and reply length fail safely", async () => {
  for (const payload of ["bad-json", { ...successPayload, stop_reason: "max_tokens" }, { ...successPayload, stop_reason: "refusal" }, { stop_reason: "end_turn", content: [] }, { stop_reason: "end_turn", content: [{ type: "text", text: " " }] }, { stop_reason: "end_turn", content: [{ type: "text", text: "😀".repeat(6001) }] }, { stop_reason: "end_turn", content: [...successPayload.content, ...successPayload.content] }, "x".repeat(64 * 1024 + 1)]) {
    const fixture = setup();
    const response = await handleAskFollowup(request(), fixture.env, { fetch: async () => typeof payload === "string" ? new Response(payload) : Response.json(payload) });
    assert.equal(response.status, 502); assert.equal((await readError(response)).code, "provider_error");
    assert.equal(fixture.quota.length, 1);
  }
});

test("aborted-before-request uses neither quota nor provider", async () => {
  const fixture = setup(), controller = new AbortController(); controller.abort();
  const response = await handleAskFollowup(request(input, {}, controller.signal), fixture.env, { fetch: fixture.fetcher });
  assert.equal(response.status, 499); assert.equal((await readError(response)).code, "cancelled");
  assert.equal(fixture.quota.length, 0); assert.equal(fixture.provider.length, 0);
});

test("cancelling an active provider request propagates abort and keeps a safe error", async () => {
  const fixture = setup(), controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const result = handleAskFollowup(request(input, {}, controller.signal), fixture.env, { fetch: async (_url, options) => new Promise<Response>((_resolve, reject) => { options!.signal!.addEventListener("abort", () => reject(new Error("PRIVATE_ABORT")), { once: true }); started(); }) });
  await ready; controller.abort();
  const response = await result;
  assert.equal(response.status, 499); assert.equal((await readError(response)).code, "cancelled"); assert.equal(fixture.quota.length, 1);
});

test("provider timeout aborts the call and does not retry or expose internal errors", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = setup(); let calls = 0, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const result = handleAskFollowup(request(), fixture.env, { fetch: async (_url, options) => new Promise<Response>((_resolve, reject) => { calls++; options!.signal!.addEventListener("abort", () => reject(new Error("PRIVATE_TIMEOUT")), { once: true }); started(); }) });
  await ready; t.mock.timers.tick(60_000);
  const response = await result;
  assert.equal(response.status, 504); const output = await readError(response); assert.equal(output.code, "timeout"); assert.ok(!output.detail.includes("PRIVATE_TIMEOUT"));
  assert.equal(calls, 1); assert.equal(fixture.quota.length, 1);
});
