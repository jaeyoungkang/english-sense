/** Public study metadata only. Never import answer-bearing content into this module. */
export const ARTIFACT_LESSON_ID = "titanic-have" as const;
export const LEARNING_QUESTION_IDS = ["titanic-have-1", "titanic-have-2", "titanic-have-3", "titanic-have-4", "titanic-have-5", "titanic-have-6", "titanic-have-7"] as const;
export type LearningQuestionId = typeof LEARNING_QUESTION_IDS[number];

/** The seven-question source used by deployed v1/v2; do not update when current content changes. */
export const LEGACY_HAVE_CONTENT_VERSION = "e1688b926b2828376fe43011144ed522b8d1716418b4fe4789d7580971bf5cc9";

export type PublicLearningQuestion = {
  questionId: LearningQuestionId;
  type: "choose" | "produce";
  ch: number;
  who: string;
  scene: string;
  ask: string;
  opts?: { t: string }[];
};

export type PublicLearningCatalog = {
  lessonId: typeof ARTIFACT_LESSON_ID;
  contentVersion: string;
  source: { title: string; author: string; path: string };
  questions: PublicLearningQuestion[];
};
