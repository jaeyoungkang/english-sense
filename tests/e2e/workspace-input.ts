import { expect, type Locator, type Page } from "@playwright/test";

// The scene lesson's answers and revisions are made in the quiz itself and questions in the conversation.
// Move through the same explicit actions as a learner. Reading a card or changing
// the selected target alone must never be treated as submitting an answer.
export async function openQuestionInput(page: Page) {
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toBeVisible();
}

export async function openFirstAnswerInput(page: Page, number: number) {
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
  await expect(page.getByRole("form", { name: `${number}번 퀴즈 첫 답`, exact: true })).toBeVisible();
}

/** The quiz section of one artifact, found by its id. */
export const quizOf = (page: Page, artifactId: string): Locator => page.locator(`.lw-quiz-artifact[data-artifact-id="${artifactId}"]`);

/** Makes a quiz the input target the way a learner does: the button in the quiz. Selecting is not an event. */
export async function chooseQuiz(page: Page, artifactId: string) {
  await quizOf(page, artifactId).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true }).click();
  await expectQuizTarget(page, artifactId);
}

export async function expectQuizTarget(page: Page, artifactId: string) {
  await expect(quizOf(page, artifactId).getByRole("button", { name: "이 퀴즈에 질문하기", exact: true })).toHaveAttribute("aria-pressed", "true");
}
