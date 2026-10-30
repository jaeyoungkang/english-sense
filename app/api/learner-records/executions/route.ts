import { getApiEnvironment } from "@/lib/server/cloudflare";
import { handleLearnerRecordExecutions } from "@/lib/server/learner-records";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleLearnerRecordExecutions(request, await getApiEnvironment(), { localDevelopment: process.env.NODE_ENV === "development" });
}
