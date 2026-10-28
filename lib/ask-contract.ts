/** Shared browser/server contract for the sentence explainer. No canonical learning data lives here. */
export type AskMode = "explain" | "translate";
export interface Explanation {
  english: string;
  korean: string;
  picture: string;
  headwords: { word: string; in_sentence: string; image: string; nuance: string }[];
  contrasts: { kind: "영어식" | "한국어식 직역" | "라틴어 계열"; text: string; note: string }[];
  alternatives: string[];
  note: string;
}
export const ASK_FOLLOWUP_ENDPOINT = "/api/ask-followup/";
export const askFollowupLimits = { message: 2000, reply: 6000, historyMessages: 20, historyCharacters: 16000, explanationBytes: 256 * 1024, bodyBytes: 512 * 1024 } as const;
export type AskMessage = { role: "user" | "assistant"; content: string };
export type AskFollowupRequest = { recordId: string; requestId: string; mode: AskMode; text: string; explanation: Explanation; messages: AskMessage[]; message: string };
export type AskFollowupResponse = { recordId: string; requestId: string; reply: string };

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const strings = (value: Record<string, unknown>, expected: string[]) => expected.every(key => typeof value[key] === "string");
export const askId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && [...value].length <= max;

export function isExplanation(value: unknown): value is Explanation {
  if (!record(value) || !keys(value, ["english", "korean", "picture", "headwords", "contrasts", "alternatives", "note"]) || !strings(value, ["english", "korean", "picture", "note"])) return false;
  if (!Array.isArray(value.headwords) || !value.headwords.every(item => record(item) && keys(item, ["word", "in_sentence", "image", "nuance"]) && strings(item, ["word", "in_sentence", "image", "nuance"]))) return false;
  if (!Array.isArray(value.contrasts) || !value.contrasts.every(item => record(item) && keys(item, ["kind", "text", "note"]) && strings(item, ["kind", "text", "note"]) && ["영어식", "한국어식 직역", "라틴어 계열"].includes(item.kind as string))) return false;
  return Array.isArray(value.alternatives) && value.alternatives.every(item => typeof item === "string");
}

export function isAskFollowupRequest(value: unknown): value is AskFollowupRequest {
  if (!record(value) || !keys(value, ["recordId", "requestId", "mode", "text", "explanation", "messages", "message"])) return false;
  if (!askId(value.recordId) || !askId(value.requestId) || !["explain", "translate"].includes(value.mode as string) || !text(value.text, 300) || !text(value.message, askFollowupLimits.message) || !isExplanation(value.explanation)) return false;
  if (new TextEncoder().encode(JSON.stringify(value.explanation)).byteLength > askFollowupLimits.explanationBytes) return false;
  if (!Array.isArray(value.messages) || value.messages.length > askFollowupLimits.historyMessages || value.messages.length % 2 !== 0) return false;
  let count = 0;
  for (let i = 0; i < value.messages.length; i++) {
    const item = value.messages[i];
    if (!record(item) || !keys(item, ["role", "content"]) || item.role !== (i % 2 === 0 ? "user" : "assistant") || !text(item.content, i % 2 === 0 ? askFollowupLimits.message : askFollowupLimits.reply)) return false;
    count += [...item.content].length;
  }
  return count <= askFollowupLimits.historyCharacters;
}

export function isAskFollowupResponse(value: unknown): value is AskFollowupResponse {
  return record(value) && keys(value, ["recordId", "requestId", "reply"]) && askId(value.recordId) && askId(value.requestId) && text(value.reply, askFollowupLimits.reply);
}
