import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyIpHash, handleAsk, handleHealth, isExplanation, type ApiEnv, type Explanation } from "../lib/server/api";

const explanation: Explanation = {
  english: "I get it.", korean: "알겠습니다.", picture: "이해가 손에 들어옵니다.",
  headwords: [{ word: "get", in_sentence: "get it", image: "이해가 손에 들어옵니다.", nuance: "일상에서 가볍게 씁니다." }],
  contrasts: [{ kind: "영어식", text: "I get it.", note: "가깝게 들립니다." }], alternatives: [], note: "덩어리로 익힙니다.",
};

function setup() {
  const quotaRequests: Record<string, unknown>[] = [];
  const providerRequests: RequestInit[] = [];
  const env: ApiEnv = {
    ANTHROPIC_API_KEY: "test-key-never-real",
    QUOTA_LIMITER: {
      idFromName: (name) => name,
      get: () => ({ fetch: async (request) => { quotaRequests.push(await request.json()); return Response.json({ allowed: true }); } }),
    },
  };
  const fetcher: typeof fetch = async (_input, init) => {
    providerRequests.push(init!);
    return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(explanation) }] });
  };
  return { env, quotaRequests, providerRequests, fetcher };
}

function request(text: unknown = "I get it.", headers: HeadersInit = {}, url = "https://english.example/api/explain"): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers }, body: JSON.stringify({ text }) });
}

test("English and Korean routes preserve provider schema, prompt, cache, effort and fallback configuration", async () => {
  for (const mode of ["explain", "translate"] as const) {
    const fixture = setup();
    const response = await handleAsk(request("  I get it.  "), mode, fixture.env, { fetch: fixture.fetcher });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), explanation);
    const init = fixture.providerRequests[0];
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, "claude-sonnet-5-5");
    assert.equal(body.max_tokens, 16000);
    assert.equal(body.output_config.effort, "low");
    assert.equal(body.output_config.format.schema.additionalProperties, false);
    assert.equal(body.system[0].cache_control.type, "ephemeral");
    assert.match(body.system[0].text, /감각 사전/);
    assert.match(body.messages[0].content, mode === "explain" ? /영어 문장: I get it\.$/ : /한국어 문장: I get it\.$/);
    assert.equal(body.fallbacks, "default");
    assert.equal((init.headers as Record<string, string>)["anthropic-beta"], "server-side-fallback-2026-07-01");
    assert.equal(fixture.quotaRequests.length, 1);
    assert.match(fixture.quotaRequests[0].ipHash as string, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(fixture.quotaRequests).includes("203.0.113.7"));
    assert.ok(!JSON.stringify(fixture.quotaRequests).includes("I get it"));
  }
});

test("invalid text, malformed JSON, content type and oversized bodies never consume quota", async () => {
  const fixture = setup();
  for (const text of [null, 2, {}, [], "", " \n\t ", "a".repeat(301), "😀".repeat(301)]) {
    const response = await handleAsk(request(text), "explain", fixture.env, { fetch: fixture.fetcher });
    assert.equal(response.status, 400, `text type ${typeof text}`);
    const body = await response.json();
    assert.ok(body !== null && typeof body === "object" && "detail" in body);
    assert.equal(typeof body.detail, "string");
  }
  for (const [body, contentType, status] of [["{", "application/json", 400], ["{}", "application/json", 400], ["null", "application/json", 400], ["{}", "text/plain", 415], ["x".repeat(8193), "application/json", 413]] as const) {
    const response = await handleAsk(new Request("https://english.example/api/explain", { method: "POST", body, headers: { "content-type": contentType } }), "explain", fixture.env, { fetch: fixture.fetcher });
    assert.equal(response.status, status);
  }
  assert.equal(fixture.quotaRequests.length, 0);
  assert.equal(fixture.providerRequests.length, 0);
});

test("Unicode code points are counted without splitting emoji into two characters", async () => {
  const fixture = setup();
  assert.equal((await handleAsk(request("😀".repeat(300)), "translate", fixture.env, { fetch: fixture.fetcher })).status, 200);
});

test("cross-origin requests fail, same-origin requests succeed, and no wildcard CORS is sent", async () => {
  const fixture = setup();
  const rejected = await handleAsk(request("hello", { origin: "https://other.example" }), "explain", fixture.env, { fetch: fixture.fetcher });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  assert.equal(fixture.quotaRequests.length, 0);
  assert.equal((await handleAsk(request("hello", { origin: "https://english.example" }), "explain", fixture.env, { fetch: fixture.fetcher })).status, 200);
});

test("missing key, quota binding and provider IP fail closed before paid requests", async () => {
  const fixture = setup();
  for (const env of [{ ...fixture.env, ANTHROPIC_API_KEY: "" }, { ...fixture.env, QUOTA_LIMITER: undefined }]) {
    assert.equal((await handleAsk(request(), "explain", env, { fetch: fixture.fetcher })).status, 503);
    assert.equal(handleHealth(env).status, 503);
    const health = await handleHealth(env).json();
    assert.ok(health !== null && typeof health === "object" && "ready" in health);
    assert.equal(health.ready, false);
  }
  const forwarded = request();
  forwarded.headers.delete("cf-connecting-ip");
  forwarded.headers.set("x-forwarded-for", "203.0.113.7");
  assert.equal((await handleAsk(forwarded, "explain", fixture.env, { fetch: fixture.fetcher })).status, 503);
  assert.equal(fixture.quotaRequests.length, 0);
  assert.equal(fixture.providerRequests.length, 0);
  assert.equal(handleHealth(fixture.env).status, 200);
  assert.equal(handleHealth(fixture.env).headers.get("cache-control"), "no-store");
});

test("localhost fallback exists only with explicitly enabled local development", async () => {
  const fixture = setup();
  const local = () => {
    const req = request("hello", {}, "http://localhost:3000/api/explain");
    req.headers.delete("cf-connecting-ip");
    return req;
  };
  assert.equal((await handleAsk(local(), "explain", fixture.env, { fetch: fixture.fetcher })).status, 503);
  assert.equal((await handleAsk(local(), "explain", fixture.env, { fetch: fixture.fetcher, localDevelopment: true })).status, 200);
});

test("quota global/IP limits, malformed result and storage outages never reach provider", async () => {
  for (const result of ["global", "ip", "malformed", "outage"]) {
    const fixture = setup();
    fixture.env.QUOTA_LIMITER!.get = () => ({ fetch: async () => {
      if (result === "outage") throw new Error("private storage detail");
      if (result === "malformed") return new Response("not-json");
      return Response.json({ allowed: false, reason: result }, { status: 429 });
    } });
    const response = await handleAsk(request(), "explain", fixture.env, { fetch: fixture.fetcher });
    assert.equal(response.status, ["global", "ip"].includes(result) ? 429 : 503);
    assert.equal(fixture.providerRequests.length, 0);
    assert.ok(!(await response.text()).includes("private storage detail"));
  }
});

test("provider 429, network errors and upstream secrets are mapped to safe messages", async () => {
  for (const status of [429, 401, 500, 0]) {
    const fixture = setup();
    const fetcher: typeof fetch = async () => {
      if (status === 0) throw new Error("private provider detail: test-key-never-real");
      return new Response("private provider detail: test-key-never-real", { status });
    };
    const response = await handleAsk(request(), "explain", fixture.env, { fetch: fetcher });
    assert.equal(response.status, status === 429 ? 503 : 502);
    const text = await response.text();
    assert.ok(!text.includes("private provider detail"));
    assert.ok(!text.includes("test-key-never-real"));
  }
});

test("a stalled provider request is aborted after 60 seconds", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = setup();
  let providerSignal: AbortSignal | undefined;
  let markStarted: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const result = handleAsk(request(), "explain", fixture.env, {
    fetch: async (_input, init) => new Promise((_resolve, reject) => {
      providerSignal = init!.signal as AbortSignal;
      providerSignal.addEventListener("abort", () => reject(new DOMException("request aborted", "AbortError")));
      markStarted();
    }),
  });
  await started;
  assert.ok(providerSignal);
  assert.equal(providerSignal.aborted, false);
  context.mock.timers.tick(60_000);
  assert.equal((await result).status, 502);
  assert.equal(providerSignal.aborted, true);
});

test("refusal retains an explanatory note with every content field empty", async () => {
  const fixture = setup();
  const response = await handleAsk(request(), "explain", fixture.env, { fetch: async () => Response.json({ stop_reason: "refusal", content: [] }) });
  assert.equal(response.status, 200);
  const output = await response.json();
  assert.ok(isExplanation(output));
  assert.equal(output.english, "");
  assert.equal(output.korean, "");
  assert.equal(output.picture, "");
  assert.deepEqual(output.headwords, []);
  assert.deepEqual(output.contrasts, []);
  assert.deepEqual(output.alternatives, []);
  assert.ok(output.note.length > 0);
});

test("truncation and malformed provider output are rejected, including nested schema violations", async () => {
  const outputs = [
    { stop_reason: "max_tokens", content: [] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "{" }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ ...explanation, headwords: [{ word: "get" }] }) }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ ...explanation, extra: true }) }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ ...explanation, contrasts: [{ kind: "other", text: "x", note: "x" }] }) }] },
    { stop_reason: "unknown", content: [] },
    { stop_reason: "end_turn", content: [] },
    { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(explanation) }, { type: "text", text: "extra" }] },
  ];
  for (const payload of outputs) {
    const fixture = setup();
    assert.equal((await handleAsk(request(), "explain", fixture.env, { fetch: async () => Response.json(payload) })).status, 502);
  }
  const fixture = setup();
  assert.equal((await handleAsk(request(), "explain", fixture.env, { fetch: async () => new Response("a".repeat(256 * 1024 + 1)) })).status, 502);
  assert.equal(isExplanation(explanation), true);
  assert.equal(isExplanation({ ...explanation, alternatives: [10] }), false);
});

test("IP hashes change each UTC day and remain deterministic within a day", async () => {
  assert.equal(await dailyIpHash("2026-10-26", "203.0.113.7"), await dailyIpHash("2026-10-26", "203.0.113.7"));
  assert.notEqual(await dailyIpHash("2026-10-26", "203.0.113.7"), await dailyIpHash("2026-10-27", "203.0.113.7"));
});
