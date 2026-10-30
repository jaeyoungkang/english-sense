import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { ApiEnv } from "./api";

export async function getApiEnvironment(): Promise<ApiEnv> {
  let bindings: ApiEnv = {};
  try {
    const context = await getCloudflareContext({ async: true });
    bindings = context.env as unknown as ApiEnv;
  } catch {
    // A standalone Next.js server has no quota binding and must fail closed.
  }
  if (process.env.NODE_ENV !== "development") return bindings;
  return {
    ...bindings,
    ANTHROPIC_API_KEY: bindings.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
    CF_ACCESS_TEAM_DOMAIN: bindings.CF_ACCESS_TEAM_DOMAIN || process.env.CF_ACCESS_TEAM_DOMAIN,
    CF_ACCESS_AUD: bindings.CF_ACCESS_AUD || process.env.CF_ACCESS_AUD,
    CF_ACCESS_ALLOWED_EMAILS: bindings.CF_ACCESS_ALLOWED_EMAILS || process.env.CF_ACCESS_ALLOWED_EMAILS,
    CF_ACCESS_ALLOWED_SUBS: bindings.CF_ACCESS_ALLOWED_SUBS || process.env.CF_ACCESS_ALLOWED_SUBS,
    CF_ACCESS_OWNER_ID: bindings.CF_ACCESS_OWNER_ID || process.env.CF_ACCESS_OWNER_ID,
    CF_ACCESS_ALLOWED_HOSTS: bindings.CF_ACCESS_ALLOWED_HOSTS || process.env.CF_ACCESS_ALLOWED_HOSTS,
    CF_ACCESS_PUBLIC_KEY_JWK: bindings.CF_ACCESS_PUBLIC_KEY_JWK || process.env.CF_ACCESS_PUBLIC_KEY_JWK,
  };
}
