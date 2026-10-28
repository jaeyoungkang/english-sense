import { getApiEnvironment } from "@/lib/server/cloudflare";
import { handleAskFollowup } from "@/lib/server/ask-followup";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleAskFollowup(request, await getApiEnvironment(), { localDevelopment: process.env.NODE_ENV === "development" });
}
