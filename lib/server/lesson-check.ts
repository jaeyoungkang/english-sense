import { ApiError, checkOrigin, type ApiEnv, type Dependencies } from "./api";
import { getLessonContentVersion, getServerLessonQuestion } from "./lesson-catalog";
import { LessonAttemptError, judge, revealAnswers } from "./lesson-judge";
import { getLessonEntry, hasLessonQuestion } from "../lesson-registry";
import { isLessonCheckRequest, lessonCheckLimits, type LessonCheckErrorCode, type LessonCheckRequest, type LessonCheckResponse } from "../lesson-contract";

const unavailable = "판정을 받지 못했습니다. 답은 남아 있으니 다시 판정해 주세요.";
const tooLong = "보낸 내용이 너무 깁니다. 답을 줄이고 다시 보내 주세요.";

class CheckError extends Error {
  constructor(readonly status: number, readonly code: LessonCheckErrorCode, message: string) { super(message); }
}

function json(value: unknown, status = 200, extra?: HeadersInit): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}

async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("body_limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function readInput(request: Request): Promise<LessonCheckRequest> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new CheckError(415, "invalid_request", "답은 JSON 형식으로 보내 주세요.");
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > lessonCheckLimits.bodyBytes) throw new CheckError(413, "invalid_request", tooLong);
  let input: unknown;
  try {
    input = JSON.parse(await boundedText(request.body, lessonCheckLimits.bodyBytes));
  } catch (error) {
    if (error instanceof Error && error.message === "body_limit") throw new CheckError(413, "invalid_request", tooLong);
    throw new CheckError(400, "invalid_request", "답 형식을 읽지 못했습니다. 다시 보내 주세요.");
  }
  if (!isLessonCheckRequest(input)) throw new CheckError(400, "invalid_request", "답과 문제를 확인해 주세요. 빈칸 하나는 100자 이내로 쓰고, 빈칸은 세 개까지입니다.");
  return input;
}

/**
 * 수업 판정 요청의 처리 순서: 메서드 → Origin → 본문 형식·크기 → 계약 형식 → 수업·문항 존재 → 판 대조 → 시도 검사 → 판정.
 * 판정은 서버 정본과의 결정적 비교이므로 키, 사용량 한도, 공급자, 네트워크를 쓰지 않는다. 그래서 한도가 다 찬 날에도 응답한다.
 * `env`와 `dependencies`는 대화 API와 같은 호출 모양을 맞추려 받을 뿐 읽지 않는다. 테스트가 이를 건드리면 실패하는 객체를 넘겨 확인한다.
 */
export async function handleLessonCheck(request: Request, _env?: ApiEnv, _dependencies?: Dependencies): Promise<Response> {
  try {
    if (request.method !== "POST") return json({ detail: "POST 요청으로 답을 보내 주세요.", error: { code: "invalid_request", message: "POST 요청으로 답을 보내 주세요." } }, 405, { Allow: "POST" });
    checkOrigin(request);
    const input = await readInput(request);
    const entry = getLessonEntry(input.lessonId);
    if (!entry) throw new CheckError(404, "not_found", "수업을 찾지 못했습니다.");
    // 장면 수업(have)은 기존 대화 경로가 맡는다. 이 경로의 판정 대상이 아니다.
    if (entry.kind === "scene") throw new CheckError(400, "unsupported_lesson", "이 수업은 이 경로에서 판정하지 않습니다.");
    if (!hasLessonQuestion(entry, input.questionId)) throw new CheckError(404, "not_found", "문제를 찾지 못했습니다.");
    const contentVersion = await getLessonContentVersion(entry.lessonId);
    if (input.contentVersion !== contentVersion) throw new CheckError(409, "content_changed", "학습 자료가 바뀌었습니다. 이전 답은 보존하고 현재 자료로 새 문제를 열어 주세요.");
    const question = getServerLessonQuestion(entry.lessonId, input.questionId);
    const judgement = input.action === "reveal" ? revealAnswers(question, input.attempt) : judge(question, input.attempt);
    const response: LessonCheckResponse = { requestId: input.requestId, lessonId: entry.lessonId, artifactId: input.artifactId, questionId: input.questionId, contentVersion, ...judgement };
    return json(response);
  } catch (error) {
    const mapped = error instanceof CheckError ? error
      : error instanceof LessonAttemptError ? new CheckError(400, "invalid_request", error.message)
      : error instanceof ApiError ? new CheckError(error.status, "origin_forbidden", error.message)
      : new CheckError(503, "unavailable", unavailable);
    return json({ detail: mapped.message, error: { code: mapped.code, message: mapped.message } }, mapped.status);
  }
}
