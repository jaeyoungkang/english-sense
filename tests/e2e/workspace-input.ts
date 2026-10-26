import { expect, type Page } from "@playwright/test";

// Move through the same explicit actions as a learner. Reading a card or changing
// the selected target alone must never be treated as submitting an answer.
export async function openQuestionInput(page: Page) {
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
  const cancelRevision = page.getByRole("button", { name: "초안을 두고 나중에 쓰기", exact: true });
  if (await cancelRevision.isVisible()) await cancelRevision.click();
  const beforeAnswer = page.getByRole("button", { name: "답하기 전에 질문하기", exact: true });
  if (await beforeAnswer.isVisible()) await beforeAnswer.click();
  await expect(page.getByLabel("이 장면에 대해 질문하기")).toBeVisible();
}

export async function openFirstAnswerInput(page: Page, number: number) {
  await expect(page.locator(".lw-session-status")).not.toContainText("임시 기록 확인 중");
  const resume = page.getByRole("button", { name: "첫 답 이어 쓰기", exact: true });
  if (await resume.isVisible()) await resume.click();
  await expect(page.getByRole("form", { name: `${number}번 퀴즈 첫 답`, exact: true })).toBeVisible();
}
