import { handleHealth } from "@/lib/server/api";
import { getApiEnvironment } from "@/lib/server/cloudflare";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleHealth(await getApiEnvironment());
}
