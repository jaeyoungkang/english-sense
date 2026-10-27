import { handleLessonCheck } from "@/lib/server/lesson-check";

export const dynamic = "force-dynamic";

/** 무료 결정적 판정. Cloudflare 바인딩(사용량 한도·키)을 읽지 않는다. */
export async function POST(request: Request): Promise<Response> {
  return handleLessonCheck(request);
}
