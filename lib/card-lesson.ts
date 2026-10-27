import { learningChatLimits } from "./learning-chat-contract";
import { updateArtifact } from "./learning-thread";
import { lessonCheckLimits, type LessonAttempt } from "./lesson-contract";
import type { PublicCardsLesson } from "./lesson-registry";
import { registerLessonArtifact, type LessonArtifact, type LessonState } from "./lesson-workspace-state";
import type { Place } from "./study-content-types";

/**
 * Pure helpers of the card lesson screen: what the server hands the page, drafts of the blank inputs,
 * the sentence the screen sends to the AI and where a card stands. They state facts (attempts, judgements)
 * and never derive completion, mastery or progress.
 */

/** A story written with the unit's expressions. Public fields only. */
export type PairedStory = { id: string; title: string; words: number; limitSeconds: number; draft: boolean; questions: number };
export type UnitLink = { n: number; when: string; href: string };
/** Everything the unit page shows besides the lesson record: public data prepared by the server. */
export type CardLessonView = {
  lesson: PublicCardsLesson;
  /** "책 전체" or "영화 전체", the base of a card's count. */
  countLabel: string;
  listHref: string;
  prev: UnitLink | null;
  next: UnitLink | null;
  pairs: PairedStory[];
};

/** Source line of an example or a blank sentence. Example: "Wonder (R. J. Palacio, 2012) · 8부", "Zootopia (2016) · 01:21:09". */
export function placeLabel(work: PublicCardsLesson["work"], place: Place) {
  const credit = work.creator ? `${work.creator}, ${work.year}` : String(work.year);
  return `${work.title} (${credit}) · ${"part" in place ? `${place.part}부` : place.time}`;
}

const clip = (value: string, max: number) => { const characters = [...value]; return characters.length <= max ? value : characters.slice(0, max).join(""); };
const questionArtifact = (state: LessonState, questionId: string) => state.artifacts.find(item => item.question.questionId === questionId);

/**
 * Edits one blank of a card's draft. The card gets its record on the first edit, without an event.
 * An unchanged value, an unknown blank and a card whose record belongs to another content version change nothing.
 */
export function setCardInput(state: LessonState, lesson: PublicCardsLesson, questionId: string, index: number, value: string): LessonState {
  const next = clip(value, lessonCheckLimits.input), saved = questionArtifact(state, questionId);
  if (saved && (saved.contentVersion !== lesson.contentVersion || (saved.inputs[index] ?? null) === null || saved.inputs[index] === next)) return state;
  if (!saved && next === "") return state;
  const registered = registerLessonArtifact(state, lesson, questionId), artifact = questionArtifact(registered, questionId)!;
  if (index < 0 || index >= artifact.inputs.length) return state;
  return updateArtifact(registered, artifact.artifactId, item => ({ ...item, inputs: item.inputs.map((input, at) => at === index ? next : input) }));
}

/** The unsent question of a card. Same rules as `setCardInput`. */
export function setCardMessageDraft(state: LessonState, lesson: PublicCardsLesson, questionId: string, value: string): LessonState {
  const next = clip(value, learningChatLimits.message), saved = questionArtifact(state, questionId);
  if (saved && (saved.contentVersion !== lesson.contentVersion || saved.messageDraft === next)) return state;
  if (!saved && next === "") return state;
  const registered = registerLessonArtifact(state, lesson, questionId), artifact = questionArtifact(registered, questionId)!;
  return updateArtifact(registered, artifact.artifactId, item => ({ ...item, messageDraft: next }));
}

/** A revision reaches the AI as one line of text. */
export const joinInputs = (inputs: string[]) => inputs.map(input => input.trim() || "(비움)").join(" / ");

/** The learner's answers as the AI request carries them: the first answer as it was, later attempts as text. */
export function cardAttemptsForRequest(artifact: LessonArtifact): { initialAttempt: LessonAttempt | null; revisions: { text: string }[] } {
  const [first, ...later] = artifact.attempts;
  return { initialAttempt: first ? structuredClone(first.attempt) : null, revisions: later.map(entry => ({ text: entry.attempt.kind === "fill" ? joinInputs(entry.attempt.inputs) : "" })) };
}

/** The request the "AI에게 설명 요청" button sends. The AI never changes the server judgement. */
export const explainRequestMessage = "처음 채운 빈칸을 이 카드의 표현과 예문에 비추어 설명해 주세요. 서버 판정에서 같다고 하거나 다르다고 한 이유를 함께 살펴보고, 스스로 고쳐 볼 지점이 있으면 알려 주세요.";

/**
 * Where a card stands for the input area:
 * `old` (another content version, read only), `first` (no attempt), `waiting` (the newest attempt has no judgement),
 * `match` (the newest attempt equals the canonical answer), `revise` (it differs and another attempt is allowed), `limit` (no more attempts).
 */
export type CardStage = "old" | "first" | "waiting" | "match" | "revise" | "limit";
export function cardStage(artifact: LessonArtifact, lesson: Pick<PublicCardsLesson, "contentVersion">): CardStage {
  if (artifact.contentVersion !== lesson.contentVersion) return "old";
  const last = artifact.attempts.at(-1);
  if (!last) return "first";
  if (!last.check) return "waiting";
  if (last.check.kind === "fill" && last.check.allMatch) return "match";
  return artifact.attempts.length > learningChatLimits.revisions ? "limit" : "revise";
}

/** Attempts made after the answers were shown carry this mark. */
export const madeAfterReveal = (artifact: LessonArtifact, index: number) => !!artifact.reveal && index >= artifact.reveal.afterAttempts;

/** "첫 답" or "수정 n". */
export const attemptName = (index: number) => index === 0 ? "첫 답" : `수정 ${index}`;

export const sameInputs = (a: string[], b: string[]) => a.length === b.length && a.every((input, index) => input === b[index]);
