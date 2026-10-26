export const LEARNING_CHAT_ENDPOINT = "/api/learn-chat/";
export const LEARNING_LESSON_ID = "titanic-have-1" as const;

export const learningChatLimits = {
  message: 2000,
  reason: 2000,
  revision: 2000,
  revisions: 6,
  historyMessage: 6000,
  historyMessages: 20,
  historyCharacters: 16000,
  reply: 6000,
  bodyBytes: 96 * 1024,
} as const;

export type LearningChatMessage = { role: "user" | "assistant"; content: string };
export type LearningChatRequest = {
  lessonId: typeof LEARNING_LESSON_ID;
  requestId: string;
  initialAttempt: { choice: number; reason: string } | null;
  revisions: { text: string }[];
  messages: LearningChatMessage[];
  message: string;
};

export type LearningChatResponse = { requestId: string; reply: string; mode: "guidance" | "ai" };
export type LearningChatErrorCode = "invalid_request" | "origin_forbidden" | "unavailable" | "quota_exceeded" | "provider_error" | "timeout" | "cancelled";
export type LearningChatError = { detail: string; error: { code: LearningChatErrorCode; message: string } };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= max;
}

/** Client history is bounded study material, never a trusted provider/system message. */
export function isLearningChatRequest(value: unknown): value is LearningChatRequest {
  if (!record(value) || !keys(value, ["lessonId", "requestId", "initialAttempt", "revisions", "messages", "message"])) return false;
  if (value.lessonId !== LEARNING_LESSON_ID || typeof value.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.requestId)) return false;
  if (!text(value.message, learningChatLimits.message)) return false;
  if (value.initialAttempt !== null) {
    if (!record(value.initialAttempt) || !keys(value.initialAttempt, ["choice", "reason"]) || !Number.isInteger(value.initialAttempt.choice) || ![0, 1, 2].includes(value.initialAttempt.choice as number) || !text(value.initialAttempt.reason, learningChatLimits.reason)) return false;
  }
  if (!Array.isArray(value.revisions) || value.revisions.length > learningChatLimits.revisions || !value.revisions.every((revision) => record(revision) && keys(revision, ["text"]) && text(revision.text, learningChatLimits.revision))) return false;
  if (value.initialAttempt === null && value.revisions.length > 0) return false;
  if (!Array.isArray(value.messages) || value.messages.length > learningChatLimits.historyMessages) return false;
  let historyCharacters = 0;
  for (const message of value.messages) {
    if (!record(message) || !keys(message, ["role", "content"]) || !["user", "assistant"].includes(message.role as string) || !text(message.content, learningChatLimits.historyMessage)) return false;
    historyCharacters += [...message.content].length;
  }
  return historyCharacters <= learningChatLimits.historyCharacters;
}

export function isLearningChatResponse(value: unknown): value is LearningChatResponse {
  return record(value) && keys(value, ["requestId", "reply", "mode"]) && typeof value.requestId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value.requestId) && text(value.reply, learningChatLimits.reply) && ["guidance", "ai"].includes(value.mode as string);
}
