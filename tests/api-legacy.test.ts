import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAsk, type ApiEnv } from "../lib/server/api";
import { handleLegacyApi } from "../lib/server/legacy-api";

const hostname = "https://mth-english-api.artificialmind.kr";
const site = "https://english.artificialmind.kr";

test("legacy calls rewrite within the Worker, preserving host, method, body and IP headers", async () => {
  for (const path of ["/explain", "/translate"]) {
    const body = JSON.stringify({ text: "I get it." });
    let forwarded = false;
    const response = await handleLegacyApi(new Request(`${hostname}${path}?test=1`, {
      method: "POST", body, headers: { Origin: site, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    }), async (request) => {
      forwarded = true;
      assert.equal(request.url, `${hostname}/api${path}/?test=1`);
      assert.equal(request.method, "POST");
      assert.equal(await request.text(), body);
      assert.equal(request.headers.get("Origin"), null);
      assert.equal(request.headers.get("CF-Connecting-IP"), "203.0.113.7");
      assert.equal(request.headers.get("Content-Type"), "application/json");
      return Response.json({ note: "test" }, { headers: { Vary: "Accept-Encoding", "X-Test": "preserved" } });
    });
    assert.equal(forwarded, true);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), site);
    assert.equal(response.headers.get("Vary"), "Accept-Encoding, Origin");
    assert.equal(response.headers.get("X-Test"), "preserved");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { note: "test" });
  }
});

test("legacy health works without Origin and has no wildcard CORS", async () => {
  const response = await handleLegacyApi(new Request(`${hostname}/health`), (request) => {
    assert.equal(request.url, `${hostname}/api/health/`);
    assert.equal(request.method, "GET");
    return Response.json({ ready: false }, { status: 503 });
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Vary"), "Origin");
});

test("legacy CORS permits only exact production and former local origins", async () => {
  for (const origin of [site, "https://jaeyoungkang.github.io", "http://localhost:8000", "http://127.0.0.1:8000"]) {
    const response = await handleLegacyApi(new Request(`${hostname}/health`, { headers: { Origin: origin } }), () => Response.json({ ready: true }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  }
  for (const origin of ["https://other.example", "null", `${site}.other.example`, `${site}/`, "http://localhost:3000"]) {
    const response = await handleLegacyApi(new Request(`${hostname}/health`, { headers: { Origin: origin } }), () => { throw new Error("must not forward"); });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
});

test("preflight verifies method and requested headers before permitting a request", async () => {
  const forward = () => { throw new Error("preflight must not forward"); };
  const goodHeaders = { Origin: site, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type" };
  const response = await handleLegacyApi(new Request(`${hostname}/explain`, { method: "OPTIONS", headers: goodHeaders }), forward);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), site);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  const invalidHeaders: HeadersInit[] = [
    { ...goodHeaders, "Access-Control-Request-Method": "DELETE" },
    { ...goodHeaders, "Access-Control-Request-Headers": "content-type, x-extra" },
    { ...goodHeaders, Origin: "https://other.example" },
    { "Access-Control-Request-Method": "POST" },
    { Origin: site },
  ];
  for (const headers of invalidHeaders) assert.equal((await handleLegacyApi(new Request(`${hostname}/explain`, { method: "OPTIONS", headers }), forward)).status, 403);
});

test("unknown paths and wrong methods never enter the Next.js handler", async () => {
  const forward = () => { throw new Error("invalid request must not forward"); };
  for (const path of ["/", "/api/explain/", "/__proto__", "/health/", "/other"]) assert.equal((await handleLegacyApi(new Request(`${hostname}${path}`), forward)).status, 404);
  const response = await handleLegacyApi(new Request(`${hostname}/explain`), forward);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "POST");
});

test("allowed legacy calls reach the strict API without relaxing its origin policy", async () => {
  const env: ApiEnv = {};
  const request = new Request(`${hostname}/explain`, { method: "POST", headers: { Origin: site, "Content-Type": "application/json" }, body: JSON.stringify({ text: "hello" }) });
  const response = await handleLegacyApi(request, (forwarded) => handleAsk(forwarded, "explain", env));
  assert.equal(response.status, 503); // Origin passed; absent key/binding remains closed.
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), site);
  assert.equal((await handleAsk(new Request(`${hostname}/api/explain/`, { method: "POST", headers: { Origin: site, "Content-Type": "application/json" }, body: JSON.stringify({ text: "hello" }) }), "explain", env)).status, 403);
});
