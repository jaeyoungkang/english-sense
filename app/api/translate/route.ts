import { handleAsk } from "@/lib/server/api";
import { getApiEnvironment } from "@/lib/server/cloudflare";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleAsk(request, "translate", await getApiEnvironment(), { localDevelopment: process.env.NODE_ENV === "development" });
}
