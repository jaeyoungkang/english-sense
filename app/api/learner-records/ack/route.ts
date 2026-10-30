import { getApiEnvironment } from "@/lib/server/cloudflare";
import { handleLearnerRecordAck } from "@/lib/server/learner-records";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleLearnerRecordAck(request, await getApiEnvironment(), { localDevelopment: process.env.NODE_ENV === "development" });
}
