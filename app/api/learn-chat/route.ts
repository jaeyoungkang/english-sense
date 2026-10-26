import { getApiEnvironment } from "@/lib/server/cloudflare";
import { handleLearningChat } from "@/lib/server/learning-chat";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleLearningChat(request, await getApiEnvironment(), { localDevelopment: process.env.NODE_ENV === "development" });
}
