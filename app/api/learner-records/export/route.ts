import { getApiEnvironment } from "@/lib/server/cloudflare";
import { handleLearnerRecordExport } from "@/lib/server/learner-records";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleLearnerRecordExport(request, await getApiEnvironment(), { localDevelopment: process.env.NODE_ENV === "development" });
}
