import { getApiEnvironment } from "@/lib/server/cloudflare";
import { handleLearnerRecords } from "@/lib/server/learner-records";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleLearnerRecords(request, await getApiEnvironment(), { localDevelopment: process.env.NODE_ENV === "development" });
}

export async function POST(request: Request): Promise<Response> {
  return handleLearnerRecords(request, await getApiEnvironment(), { localDevelopment: process.env.NODE_ENV === "development" });
}
