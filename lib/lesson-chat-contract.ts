import { isLearningChatResponse, validTransport, type LearningChatRequest, type LearningChatResponse } from "./learning-chat-contract";
import { isLessonAttempt, type LessonAttempt } from "./lesson-contract";
import { getLessonEntry, hasLessonQuestion, LESSON_ID_PATTERN } from "./lesson-registry";

/**
 * 이야기·카드 수업의 대화 요청 계약. 장면 수업(`titanic-have`)의 요청은 `learning-chat-contract.ts`가 그대로 받는다.
 * 수업·문항은 레지스트리에서 풀고, 첫 답은 판정 계약의 시도(`LessonAttempt`)와 같은 정의를 쓴다.
 * 첫 답에는 판정 값이 없다. 서버가 `judge`로 다시 판정하므로 브라우저가 정오를 말해도 받지 않는다(정확한 키 검사).
 * 이유 입력은 받지 않는다. 이야기 `choose`는 이유가 없고 카드 `fill`은 빈칸 입력뿐이다.
 */
export type LessonChatRequest = Omit<LearningChatRequest, "lessonId" | "initialAttempt"> & {
  lessonId: string;
  questionId: string;
  contentVersion: string;
  artifactId: string;
  initialAttempt: LessonAttempt | null;
};
export type LessonChatResponse = LearningChatResponse & { lessonId: string; artifactId: string; questionId: string; contentVersion: string };

const VERSION_PATTERN = /^[a-f0-9]{64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

export function isLessonChatRequest(value: unknown): value is LessonChatRequest {
  if (!record(value) || !keys(value, ["lessonId", "questionId", "contentVersion", "artifactId", "requestId", "initialAttempt", "revisions", "messages", "message"])) return false;
  const entry = getLessonEntry(value.lessonId);
  if (!entry || entry.kind === "scene" || !hasLessonQuestion(entry, value.questionId)) return false;
  if (typeof value.contentVersion !== "string" || !VERSION_PATTERN.test(value.contentVersion) || typeof value.artifactId !== "string" || !LESSON_ID_PATTERN.test(value.artifactId)) return false;
  if (value.initialAttempt !== null && (!isLessonAttempt(value.initialAttempt) || value.initialAttempt.kind !== (entry.kind === "story" ? "choose" : "fill"))) return false;
  // 이야기는 정답과 해설을 받은 뒤라 수정이 없다. 수정은 카드 빈칸에만 있다.
  if (entry.kind === "story" && (!Array.isArray(value.revisions) || value.revisions.length > 0)) return false;
  return validTransport(value);
}

export function isLessonChatResponse(value: unknown): value is LessonChatResponse {
  if (!record(value) || !keys(value, ["requestId", "lessonId", "artifactId", "questionId", "contentVersion", "reply", "mode"])) return false;
  const entry = getLessonEntry(value.lessonId);
  if (!entry || entry.kind === "scene" || !hasLessonQuestion(entry, value.questionId)) return false;
  return typeof value.artifactId === "string" && LESSON_ID_PATTERN.test(value.artifactId) && typeof value.contentVersion === "string" && VERSION_PATTERN.test(value.contentVersion)
    && isLearningChatResponse({ requestId: value.requestId, reply: value.reply, mode: value.mode });
}
