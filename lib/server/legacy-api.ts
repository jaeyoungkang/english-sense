const allowedOrigins = new Set([
  "https://english.artificialmind.kr",
  "https://jaeyoungkang.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

const routes: Record<string, { method: string; path: string }> = {
  "/health": { method: "GET", path: "/api/health/" },
  "/explain": { method: "POST", path: "/api/explain/" },
  "/translate": { method: "POST", path: "/api/translate/" },
};

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  const vary = headers.get("Vary")?.split(",").map((value) => value.trim()) ?? [];
  if (!vary.some((value) => value.toLowerCase() === "origin")) vary.push("Origin");
  headers.set("Vary", vary.join(", "));
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function error(status: number, detail: string, origin: string | null, headers?: HeadersInit): Response {
  return withCors(Response.json({ detail }, { status, headers }), origin);
}

/** Only the retired API hostname uses this compatibility boundary. */
export async function handleLegacyApi(request: Request, forward: (request: Request) => Promise<Response> | Response): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin !== null && !allowedOrigins.has(origin)) return error(403, "이 사이트에서는 문장을 보낼 수 없습니다.", null);
  const url = new URL(request.url);
  const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : undefined;
  if (!route) return error(404, "요청한 경로를 찾지 못했습니다.", origin);

  if (request.method === "OPTIONS") {
    const requestedMethod = request.headers.get("Access-Control-Request-Method");
    const requestedHeaders = request.headers.get("Access-Control-Request-Headers")?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
    if (!origin || requestedMethod !== route.method || requestedHeaders.some((header) => header !== "content-type")) return error(403, "허용하지 않는 요청입니다.", origin);
    return withCors(new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Methods": route.method, "Access-Control-Allow-Headers": "Content-Type" },
    }), origin);
  }
  if (request.method !== route.method) return error(405, "허용하지 않는 요청 방식입니다.", origin, { Allow: route.method });

  url.pathname = route.path;
  const forwarded = new Request(url, request);
  // This allowlisted legacy boundary owns CORS; the same-origin API remains strict.
  forwarded.headers.delete("Origin");
  return withCors(await forward(forwarded), origin);
}
