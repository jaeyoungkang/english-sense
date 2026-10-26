import prompt from "./prompt.json";

export interface Explanation {
  english: string;
  korean: string;
  picture: string;
  headwords: { word: string; in_sentence: string; image: string; nuance: string }[];
  contrasts: { kind: "영어식" | "한국어식 직역" | "라틴어 계열"; text: string; note: string }[];
  alternatives: string[];
  note: string;
}

export interface QuotaNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface ApiEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_EFFORT?: string;
  PER_IP_PER_DAY?: string;
  GLOBAL_PER_DAY?: string;
  QUOTA_LIMITER?: QuotaNamespace;
}

export interface Dependencies {
  fetch?: typeof fetch;
  now?: () => Date;
  localDevelopment?: boolean;
}

const unavailable = "해설 서버가 아직 준비되지 않았습니다.";
const providerError = "해설을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
const malformed = "해설을 읽지 못했습니다. 다시 시도해 주세요.";
const maxBodyBytes = 8 * 1024;
const maxResponseBytes = 256 * 1024;
const explanationKeys = ["english", "korean", "picture", "headwords", "contrasts", "alternatives", "note"];

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function strings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === "string");
}

export function isExplanation(value: unknown): value is Explanation {
  if (!record(value) || !exactKeys(value, explanationKeys) || !strings(value, ["english", "korean", "picture", "note"])) return false;
  if (!Array.isArray(value.headwords) || !value.headwords.every((item) => record(item) && exactKeys(item, ["word", "in_sentence", "image", "nuance"]) && strings(item, ["word", "in_sentence", "image", "nuance"]))) return false;
  if (!Array.isArray(value.contrasts) || !value.contrasts.every((item) => record(item) && exactKeys(item, ["kind", "text", "note"]) && strings(item, ["kind", "text", "note"]) && ["영어식", "한국어식 직역", "라틴어 계열"].includes(item.kind as string))) return false;
  return Array.isArray(value.alternatives) && value.alternatives.every((item) => typeof item === "string");
}

async function readBounded(body: ReadableStream<Uint8Array> | null, max: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new ApiError(413, "입력한 내용이 너무 깁니다. 300자 이내로 써 주세요.");
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function inputText(request: Request): Promise<string> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "JSON 형식으로 문장을 보내 주세요.");
  }
  const length = request.headers.get("content-length");
  if (length && Number(length) > maxBodyBytes) throw new ApiError(413, "입력한 내용이 너무 깁니다. 300자 이내로 써 주세요.");
  let body: unknown;
  try {
    body = JSON.parse(await readBounded(request.body, maxBodyBytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "입력 형식을 읽지 못했습니다. 문장을 다시 보내 주세요.");
  }
  if (!record(body) || typeof body.text !== "string" || !body.text.trim()) throw new ApiError(400, "문장을 한 글자 이상 써 주세요.");
  if ([...body.text].length > 300) throw new ApiError(400, "문장은 300자 이내로 써 주세요.");
  return body.text.trim();
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) throw new ApiError(503, unavailable);
  return number;
}

function ready(env: ApiEnv): boolean {
  return !!env.ANTHROPIC_API_KEY?.trim() && typeof env.QUOTA_LIMITER?.idFromName === "function" && typeof env.QUOTA_LIMITER?.get === "function";
}

export function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) throw new ApiError(403, "이 사이트에서 문장을 보내 주세요.");
}

export async function dailyIpHash(day: string, ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${day}:${ip}`);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function takeQuota(request: Request, env: ApiEnv, dependencies: Dependencies): Promise<void> {
  const perIpLimit = positiveInt(env.PER_IP_PER_DAY, 30);
  const globalLimit = positiveInt(env.GLOBAL_PER_DAY, 600);
  let ip = request.headers.get("cf-connecting-ip");
  if (!ip && dependencies.localDevelopment && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)) ip = "localhost";
  if (!ip) throw new ApiError(503, unavailable);
  const day = (dependencies.now?.() ?? new Date()).toISOString().slice(0, 10);
  const ipHash = await dailyIpHash(day, ip);
  let response: Response;
  try {
    const namespace = env.QUOTA_LIMITER!;
    response = await namespace.get(namespace.idFromName(day)).fetch(new Request("https://quota.internal/take", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, ipHash, perIpLimit, globalLimit }),
    }));
  } catch {
    throw new ApiError(503, unavailable);
  }
  let result: unknown;
  try { result = await response.json(); } catch { throw new ApiError(503, unavailable); }
  if (response.status === 429 && record(result)) {
    if (result.reason === "global") throw new ApiError(429, "오늘 쓸 수 있는 횟수를 모두 썼습니다. 내일 다시 써 주세요.");
    if (result.reason === "ip") throw new ApiError(429, `한 사람이 하루에 ${perIpLimit}번까지 쓸 수 있습니다. 내일 다시 써 주세요.`);
  }
  if (!response.ok || !record(result) || result.allowed !== true) throw new ApiError(503, unavailable);
}

function task(mode: "explain" | "translate", text: string): string {
  return mode === "explain"
    ? "다음 영어 문장을 감각 사전으로 해설하라. english 칸에는 이 문장을 그대로 두고(맞춤법이 틀렸으면 고친 문장), 문장이 어색하면 note에 영어 화자가 실제로 쓰는 문장을 알려라.\n\n영어 문장: " + text
    : "다음 한국어 문장을 영어 화자가 그 장면에서 실제로 할 말로 옮기고, 그 영어 문장을 감각 사전으로 해설하라. 기본동사와 불변화사를 쓸 수 있으면 우선한다. contrasts에는 이 한국어를 그대로 옮긴 한국어식 직역을 꼭 넣는다.\n\n한국어 문장: " + text;
}

async function askClaude(mode: "explain" | "translate", text: string, env: ApiEnv, dependencies: Dependencies): Promise<Explanation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await (dependencies.fetch ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 16000,
        system: [{ type: "text", text: prompt.rules, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: task(mode, text) }],
        output_config: { effort: env.ANTHROPIC_EFFORT || "low", format: { type: "json_schema", schema: prompt.schema } },
        fallbacks: "default",
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new ApiError(503, "지금 해설 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.");
      throw new ApiError(502, providerError);
    }
    let payload: unknown;
    try { payload = JSON.parse(await readBounded(response.body, maxResponseBytes)); } catch { throw new ApiError(502, malformed); }
    if (!record(payload)) throw new ApiError(502, malformed);
    if (payload.stop_reason === "refusal") return { english: "", korean: "", picture: "", headwords: [], contrasts: [], alternatives: [], note: "이 문장은 해설하지 않았습니다. 다른 문장으로 써 주세요." };
    if (payload.stop_reason === "max_tokens") throw new ApiError(502, "해설이 길어 끝까지 만들지 못했습니다. 문장을 줄여 다시 시도해 주세요.");
    if (payload.stop_reason !== "end_turn" || !Array.isArray(payload.content)) throw new ApiError(502, malformed);
    const blocks = payload.content.filter((block) => record(block) && block.type === "text");
    if (blocks.length !== 1 || typeof blocks[0].text !== "string") throw new ApiError(502, malformed);
    let explanation: unknown;
    try { explanation = JSON.parse(blocks[0].text); } catch { throw new ApiError(502, malformed); }
    if (!isExplanation(explanation)) throw new ApiError(502, malformed);
    return explanation;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, providerError);
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleAsk(request: Request, mode: "explain" | "translate", env: ApiEnv, dependencies: Dependencies = {}): Promise<Response> {
  try {
    if (request.method !== "POST") return json({ detail: "POST 요청으로 문장을 보내 주세요." }, 405, { Allow: "POST" });
    checkOrigin(request);
    const text = await inputText(request);
    if (!ready(env)) throw new ApiError(503, unavailable);
    await takeQuota(request, env, dependencies);
    return json(await askClaude(mode, text, env, dependencies));
  } catch (error) {
    return error instanceof ApiError ? json({ detail: error.message }, error.status) : json({ detail: unavailable }, 503);
  }
}

export function handleHealth(env: ApiEnv): Response {
  let configured = ready(env);
  try { positiveInt(env.PER_IP_PER_DAY, 30); positiveInt(env.GLOBAL_PER_DAY, 600); } catch { configured = false; }
  return json({ ok: configured, ready: configured, model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5" }, configured ? 200 : 503);
}
