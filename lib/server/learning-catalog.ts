import pageData from "../../content/pages.json";
import type { ContentPage, QuizContent, QuizQuestion } from "../content";
import { ARTIFACT_LESSON_ID, LEARNING_QUESTION_IDS, type LearningQuestionId, type PublicLearningCatalog, type PublicLearningQuestion } from "../learning-catalog";

const source = { title: "Magic Tree House #17: Tonight on the Titanic", author: "Mary Pope Osborne", path: "/practice/titanic/have/" };

/** Explicit identities remain tied to these source slots; reordering requires a source migration. */
const slots: Record<LearningQuestionId, number> = {
  "titanic-have-1": 0, "titanic-have-2": 1, "titanic-have-3": 2, "titanic-have-4": 3,
  "titanic-have-5": 4, "titanic-have-6": 5, "titanic-have-7": 6,
};

function questions(): QuizQuestion[] {
  const page = (pageData as ContentPage[]).find((page) => page.path === source.path.slice(1));
  const quiz = page?.parts.find((part): part is QuizContent => part.kind === "quiz");
  /** 이 서버 정본은 고르기·쓰기 문항만 안다. 빈칸 넣기(`fill`)는 정적 연습 페이지의 것이라 걸러 낸다. */
  const list = quiz?.questions.filter((question): question is QuizQuestion => question.type !== "fill");
  if (!list || list.length !== LEARNING_QUESTION_IDS.length) throw new Error("learning_catalog_unavailable");
  return list;
}

async function contentVersion(): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(questions()));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicQuestion(questionId: LearningQuestionId, question: QuizQuestion): PublicLearningQuestion {
  return {
    questionId, type: question.type, ch: question.ch, who: question.who, scene: question.scene, ask: question.ask,
    ...(question.type === "choose" ? { opts: question.opts.map(({ t }) => ({ t })) } : {}),
  };
}

/** The only projection passed to the workspace. Answer-bearing fields stay in this server module. */
export async function getPublicLearningCatalog(): Promise<PublicLearningCatalog> {
  const current = questions();
  return { lessonId: ARTIFACT_LESSON_ID, contentVersion: await contentVersion(), source: { ...source }, questions: LEARNING_QUESTION_IDS.map((id) => publicQuestion(id, current[slots[id]])) };
}

export async function getServerLearningQuestion(questionId: LearningQuestionId): Promise<{ contentVersion: string; question: QuizQuestion; context: Record<string, unknown> }> {
  if (!Object.hasOwn(slots, questionId)) throw new Error("learning_question_unavailable");
  const question = questions()[slots[questionId]];
  return {
    contentVersion: await contentVersion(), question,
    context: {
      lessonId: ARTIFACT_LESSON_ID, questionId, source: `${source.author}, ${source.title}, chapter ${question.ch}`, sourcePath: source.path,
      scene: question.scene, speaker: question.who, question: question.ask,
      ...(question.type === "choose" ? { options: question.opts, explanation: question.feel } : { modelAnswer: question.answer, bookQuotation: question.book, corrections: question.fixes }),
    },
  };
}
