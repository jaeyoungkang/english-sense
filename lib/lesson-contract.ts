import { LESSON_ID_PATTERN } from "./lesson-registry";

export const LESSON_CHECK_ENDPOINT = "/api/lesson-check/";

export const lessonCheckLimits = {
  /** 이야기 문항의 보기 수. 서버는 문항의 실제 보기 수로 다시 검사한다. */
  choices: 4,
  /** 카드 한 장의 빈칸 수 상한. */
  blanks: 3,
  /** 빈칸 하나에 쓸 수 있는 글자 수. */
  input: 100,
  bodyBytes: 4 * 1024,
} as const;

/** 첫 답 또는 수정. 이야기는 보기를 고르고(이유 입력 없음), 카드는 빈칸 수만큼 쓴다. */
export type LessonAttempt = { kind: "choose"; choice: number } | { kind: "fill"; inputs: string[] };

/**
 * `check`는 시도를 판정하고, `reveal`('답 보기')은 카드의 정본 답을 연다.
 * `reveal`은 첫 답이 될 수 있는 입력을 함께 보낸 요청에만 답하며, 이야기에는 쓰지 않는다.
 */
export type LessonCheckRequest = {
  action: "check" | "reveal";
  lessonId: string;
  questionId: string;
  contentVersion: string;
  artifactId: string;
  requestId: string;
  attempt: LessonAttempt;
};

/**
 * 정본과 대조한 결과. 이야기 `choose`는 이 응답에서 처음으로 정답 보기와 해설을 낸다.
 * 카드 `fill`은 빈칸마다 정본 답과 같은지만 말하고 정답 문자열을 담지 않는다.
 * 정본에 없는 자연스러운 답이 있을 수 있어 필드 이름에 "정답"을 단정하는 뜻을 쓰지 않는다.
 */
export type LessonJudgement =
  | { kind: "choose"; choice: number; match: boolean; answerIndex: number; explain: string; basis?: string }
  | { kind: "fill"; matches: boolean[]; allMatch: boolean }
  | { kind: "reveal"; answers: string[] };

export type LessonCheckResponse = {
  requestId: string;
  lessonId: string;
  artifactId: string;
  questionId: string;
  contentVersion: string;
} & LessonJudgement;

export type LessonCheckErrorCode = "invalid_request" | "not_found" | "unsupported_lesson" | "content_changed" | "origin_forbidden" | "unavailable";
export type LessonCheckError = { detail: string; error: { code: LessonCheckErrorCode; message: string } };

const VERSION_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function id(value: unknown): value is string {
  return typeof value === "string" && LESSON_ID_PATTERN.test(value);
}

/** 첫 답·수정의 형식. 수업 기록 v4도 같은 정의로 시도를 검사한다. */
export function isLessonAttempt(value: unknown): value is LessonAttempt {
  if (!record(value)) return false;
  if (value.kind === "choose") return keys(value, ["kind", "choice"]) && Number.isInteger(value.choice) && (value.choice as number) >= 0 && (value.choice as number) < lessonCheckLimits.choices;
  if (value.kind !== "fill" || !keys(value, ["kind", "inputs"]) || !Array.isArray(value.inputs)) return false;
  const inputs: unknown[] = value.inputs;
  if (inputs.length < 1 || inputs.length > lessonCheckLimits.blanks) return false;
  if (!inputs.every((input) => typeof input === "string" && [...input].length <= lessonCheckLimits.input)) return false;
  // 아무것도 쓰지 않은 제출은 답이 아니다. 일부 빈칸을 비워 둔 것은 그 빈칸이 다르다는 판정으로 이어진다.
  return inputs.some((input) => (input as string).trim().length > 0);
}

/** 정확한 키와 형식을 검사한다. 수업·문항의 존재와 판 대조는 서버가 이어서 한다. */
export function isLessonCheckRequest(value: unknown): value is LessonCheckRequest {
  if (!record(value) || !keys(value, ["action", "lessonId", "questionId", "contentVersion", "artifactId", "requestId", "attempt"])) return false;
  if (value.action !== "check" && value.action !== "reveal") return false;
  if (!id(value.lessonId) || !id(value.questionId) || !id(value.artifactId)) return false;
  if (typeof value.requestId !== "string" || !REQUEST_ID_PATTERN.test(value.requestId)) return false;
  if (typeof value.contentVersion !== "string" || !VERSION_PATTERN.test(value.contentVersion)) return false;
  if (!isLessonAttempt(value.attempt)) return false;
  return value.action === "check" || value.attempt.kind === "fill";
}

export function isLessonCheckResponse(value: unknown): value is LessonCheckResponse {
  if (!record(value)) return false;
  const common = ["requestId", "lessonId", "artifactId", "questionId", "contentVersion", "kind"];
  if (typeof value.requestId !== "string" || !REQUEST_ID_PATTERN.test(value.requestId) || !id(value.lessonId) || !id(value.artifactId) || !id(value.questionId)) return false;
  if (typeof value.contentVersion !== "string" || !VERSION_PATTERN.test(value.contentVersion)) return false;
  if (value.kind === "choose") {
    if (!keys(value, [...common, "choice", "match", "answerIndex", "explain", ...(Object.hasOwn(value, "basis") ? ["basis"] : [])])) return false;
    const index = (item: unknown) => Number.isInteger(item) && (item as number) >= 0 && (item as number) < lessonCheckLimits.choices;
    return index(value.choice) && index(value.answerIndex) && typeof value.match === "boolean" && typeof value.explain === "string" && (!Object.hasOwn(value, "basis") || typeof value.basis === "string");
  }
  if (value.kind === "fill") {
    return keys(value, [...common, "matches", "allMatch"]) && Array.isArray(value.matches) && value.matches.length >= 1 && value.matches.length <= lessonCheckLimits.blanks
      && value.matches.every((item) => typeof item === "boolean") && value.allMatch === value.matches.every(Boolean);
  }
  if (value.kind === "reveal") {
    return keys(value, [...common, "answers"]) && Array.isArray(value.answers) && value.answers.length >= 1 && value.answers.length <= lessonCheckLimits.blanks && value.answers.every((item) => typeof item === "string");
  }
  return false;
}
