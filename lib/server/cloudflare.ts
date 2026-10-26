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
  };
}
