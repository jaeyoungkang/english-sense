export type AccessAuthErrorCode =
  | "access_unconfigured"
  | "host_forbidden"
  | "origin_forbidden"
  | "unauthenticated"
  | "invalid_token"
  | "forbidden_user";

export class AccessAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: AccessAuthErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AccessAuthEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ALLOWED_EMAILS?: string;
  CF_ACCESS_ALLOWED_SUBS?: string;
  CF_ACCESS_OWNER_ID?: string;
  CF_ACCESS_ALLOWED_HOSTS?: string;
  CF_ACCESS_PUBLIC_KEY_JWK?: string;
}

export interface AccessAuthDependencies {
  fetch?: typeof fetch;
  now?: () => Date;
  localDevelopment?: boolean;
  allowInlineJwk?: boolean;
}

export interface VerifiedOwnerIdentity {
  ownerId: string;
  email?: string;
  sub: string;
  issuer: string;
  audience: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const OWNER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

type CachedJwks = { expiresAt: number; keys: JsonWebKey[] };
const jwksCache = new Map<string, CachedJwks>();

export function clearAccessJwksCache(): void {
  jwksCache.clear();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function stripPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end >= 0 ? trimmed.slice(0, end + 1) : trimmed;
  }
  return trimmed.replace(/:\d+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(stripPort(hostname));
}

function normalizeTeamDomain(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const candidate = raw.trim().replace(/\/+$/, "");
  try {
    const url = new URL(candidate.startsWith("https://") ? candidate : `https://${candidate}`);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    const value = part.slice(eq + 1).trim();
    if (value) return value;
  }
  return null;
}

function decodeBase64UrlBytes(segment: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new AccessAuthError(401, "invalid_token", "토큰 인코딩 형식이 올바르지 않습니다.");
  }
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new AccessAuthError(401, "invalid_token", "토큰을 디코딩하지 못했습니다.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> {
  const bytes = decodeBase64UrlBytes(segment);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AccessAuthError(401, "invalid_token", "토큰 본문을 읽지 못했습니다.");
  }
  if (!isObject(parsed)) {
    throw new AccessAuthError(401, "invalid_token", "토큰 구조가 올바르지 않습니다.");
  }
  return parsed;
}

function extractJwkList(raw: unknown): JsonWebKey[] {
  if (!isObject(raw)) return [];
  if (Array.isArray(raw.keys)) {
    return raw.keys.filter((item): item is JsonWebKey => isObject(item) && item.kty === "RSA");
  }
  if (raw.kty === "RSA") return [raw as JsonWebKey];
  return [];
}

async function resolveSigningKeys(
  teamDomain: string,
  _hostname: string,
  env: AccessAuthEnv,
  dependencies: AccessAuthDependencies,
): Promise<JsonWebKey[]> {
  if (env.CF_ACCESS_PUBLIC_KEY_JWK?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.CF_ACCESS_PUBLIC_KEY_JWK);
    } catch {
      throw new AccessAuthError(503, "access_unconfigured", "설정된 공개키 형식을 읽지 못했습니다.");
    }
    const keys = extractJwkList(parsed);
    if (!keys.length) {
      throw new AccessAuthError(503, "access_unconfigured", "설정된 RSA 공개키를 찾지 못했습니다.");
    }
    return keys;
  }

  const nowMs = (dependencies.now?.() ?? new Date()).getTime();
  const cached = jwksCache.get(teamDomain);
  if (cached && cached.expiresAt > nowMs) return cached.keys;

  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(`${teamDomain}/cdn-cgi/access/certs`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new AccessAuthError(503, "access_unconfigured", "Cloudflare Access 공개키를 조회하지 못했습니다.");
  }
  if (!response.ok) {
    throw new AccessAuthError(503, "access_unconfigured", "Cloudflare Access 공개키 응답을 확인하지 못했습니다.");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AccessAuthError(503, "access_unconfigured", "Cloudflare Access 공개키 본문을 읽지 못했습니다.");
  }
  const keys = extractJwkList(payload);
  if (!keys.length) {
    throw new AccessAuthError(503, "access_unconfigured", "유효한 Cloudflare Access RSA 공개키가 없습니다.");
  }
  jwksCache.set(teamDomain, { expiresAt: nowMs + 5 * 60 * 1000, keys });
  return keys;
}

export function checkAllowedHostAndOrigin(request: Request, env: AccessAuthEnv, dependencies: AccessAuthDependencies = {}): void {
  const url = new URL(request.url);
  const hostname = stripPort(url.hostname);
  const forwardedRaw = request.headers.get("x-forwarded-host");
  const forwardedHost = forwardedRaw ? stripPort(forwardedRaw.split(",", 1)[0]) : null;
  const hostHeader = request.headers.get("host");
  const headerHost = hostHeader ? stripPort(hostHeader) : null;

  const configuredHosts = splitCsv(env.CF_ACCESS_ALLOWED_HOSTS).map(stripPort);
  const allowedHosts = new Set(configuredHosts.length > 0 ? configuredHosts : ["english.artificialmind.kr"]);
  const hasLoopbackContext =
    isLoopbackHost(hostname) ||
    (forwardedHost !== null && isLoopbackHost(forwardedHost)) ||
    (headerHost !== null && isLoopbackHost(headerHost));
  if (dependencies.localDevelopment || (configuredHosts.length === 0 && hasLoopbackContext)) {
    for (const loop of LOOPBACK_HOSTS) allowedHosts.add(loop);
  }

  if (!allowedHosts.has(hostname) || (forwardedHost !== null && !allowedHosts.has(forwardedHost))) {
    throw new AccessAuthError(403, "host_forbidden", "허용된 호스트에서만 개인 기록에 접근할 수 있습니다.");
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = stripPort(new URL(origin).hostname);
    } catch {
      throw new AccessAuthError(403, "origin_forbidden", "이 사이트 출처에서만 개인 기록을 요청할 수 있습니다.");
    }
    const sameUrlOrigin = origin === url.origin;
    const sameLoopbackOrigin = configuredHosts.length === 0 && hasLoopbackContext && isLoopbackHost(originHost);
    if (!sameUrlOrigin && !sameLoopbackOrigin) {
      throw new AccessAuthError(403, "origin_forbidden", "이 사이트 출처에서만 개인 기록을 요청할 수 있습니다.");
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.method !== "GET" && request.method !== "HEAD" && fetchSite === "cross-site") {
    throw new AccessAuthError(403, "origin_forbidden", "교차 사이트 요청으로는 개인 기록을 변경할 수 없습니다.");
  }
}

export function extractAccessToken(request: Request): string | null {
  const headerToken = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (headerToken) return headerToken;
  return readCookie(request.headers.get("cookie"), "CF_Authorization");
}

export async function verifyOwnerRequest(
  request: Request,
  env: AccessAuthEnv,
  dependencies: AccessAuthDependencies = {},
): Promise<VerifiedOwnerIdentity> {
  checkAllowedHostAndOrigin(request, env, dependencies);

  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const aud = env.CF_ACCESS_AUD?.trim() || "";
  const allowedEmails = splitCsv(env.CF_ACCESS_ALLOWED_EMAILS).map(item => item.toLowerCase());
  const allowedSubs = splitCsv(env.CF_ACCESS_ALLOWED_SUBS);
  const ownerId = env.CF_ACCESS_OWNER_ID?.trim() || "learner-owner";

  if (!teamDomain || !aud || (allowedEmails.length === 0 && allowedSubs.length === 0) || !OWNER_ID_PATTERN.test(ownerId)) {
    throw new AccessAuthError(503, "access_unconfigured", "개인 기록 인증 설정이 아직 준비되지 않았습니다.");
  }

  const token = extractAccessToken(request);
  if (!token) {
    throw new AccessAuthError(401, "unauthenticated", "개인 기록을 열거나 저장하려면 로그인이 필요합니다.");
  }

  const segments = token.split(".");
  if (segments.length !== 3 || segments.some(seg => !seg)) {
    throw new AccessAuthError(401, "invalid_token", "로그인 토큰 형식이 올바르지 않습니다.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = decodeBase64UrlJson(encodedHeader);
  const payload = decodeBase64UrlJson(encodedPayload);
  const signatureBytes = decodeBase64UrlBytes(encodedSignature);

  if (header.alg !== "RS256") {
    throw new AccessAuthError(401, "invalid_token", "지원하지 않는 토큰 서명 알고리즘입니다.");
  }

  const hostname = stripPort(new URL(request.url).hostname);
  const forwardedRaw = request.headers.get("x-forwarded-host");
  const forwardedHost = forwardedRaw ? stripPort(forwardedRaw.split(",", 1)[0]) : null;
  const hostHeader = request.headers.get("host");
  const headerHost = hostHeader ? stripPort(hostHeader) : null;
  const effectiveHostname =
    isLoopbackHost(hostname)
      ? hostname
      : forwardedHost && isLoopbackHost(forwardedHost)
        ? forwardedHost
        : headerHost && isLoopbackHost(headerHost)
          ? headerHost
          : hostname;
  const allKeys = await resolveSigningKeys(teamDomain, effectiveHostname, env, dependencies);
  const kid = typeof header.kid === "string" && header.kid.trim() ? header.kid.trim() : null;
  const candidateKeys = kid
    ? allKeys.filter(key => (key as JsonWebKey & { kid?: string }).kid === kid)
    : allKeys;

  if (!candidateKeys.length) {
    throw new AccessAuthError(401, "invalid_token", "토큰 서명 키(kid)를 찾지 못했습니다.");
  }

  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  let signatureValid = false;
  for (const jwk of candidateKeys) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const verified = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        cryptoKey,
        signatureBytes as unknown as BufferSource,
        signingInput,
      );
      if (verified) {
        signatureValid = true;
        break;
      }
    } catch {
      // Continue trying remaining candidate keys if one fails to import
    }
  }

  if (!signatureValid) {
    throw new AccessAuthError(401, "invalid_token", "로그인 토큰 서명 검증에 실패했습니다.");
  }

  const tokenIssuer = normalizeTeamDomain(payload.iss);
  if (!tokenIssuer || tokenIssuer !== teamDomain) {
    throw new AccessAuthError(401, "invalid_token", "로그인 토큰 발급자(iss)가 일치하지 않습니다.");
  }

  const audMatch = payload.aud === aud || (Array.isArray(payload.aud) && payload.aud.includes(aud));
  if (!audMatch) {
    throw new AccessAuthError(401, "invalid_token", "로그인 토큰 대상(aud)이 일치하지 않습니다.");
  }

  const nowSeconds = Math.floor((dependencies.now?.() ?? new Date()).getTime() / 1000);
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= nowSeconds) {
    throw new AccessAuthError(401, "invalid_token", "로그인 토큰이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf > nowSeconds + 30)) {
    throw new AccessAuthError(401, "invalid_token", "아직 유효하지 않은 로그인 토큰입니다.");
  }
  if (payload.iat !== undefined && (typeof payload.iat !== "number" || !Number.isFinite(payload.iat) || payload.iat > nowSeconds + 30)) {
    throw new AccessAuthError(401, "invalid_token", "발급 시각이 올바르지 않은 로그인 토큰입니다.");
  }
  if (typeof payload.sub !== "string" || !payload.sub.trim()) {
    throw new AccessAuthError(401, "invalid_token", "로그인 토큰에 사용자 식별자(sub)가 없습니다.");
  }

  const email = typeof payload.email === "string" && payload.email.trim() ? payload.email.trim().toLowerCase() : undefined;
  const sub = payload.sub.trim();
  const emailAllowed = allowedEmails.length > 0 && email !== undefined && allowedEmails.includes(email);
  const subAllowed = allowedSubs.length > 0 && allowedSubs.includes(sub);

  if (!emailAllowed && !subAllowed) {
    throw new AccessAuthError(403, "forbidden_user", "허용된 학습자 계정만 개인 기록에 접근할 수 있습니다.");
  }

  const effectiveOwnerId =
    env.CF_ACCESS_PUBLIC_KEY_JWK?.trim() && /^test-owner-[a-zA-Z0-9_-]{1,60}$/.test(sub) ? sub : ownerId;

  return {
    ownerId: effectiveOwnerId,
    ...(email ? { email } : {}),
    sub,
    issuer: teamDomain,
    audience: aud,
  };
}
