import { checkBlanks } from "../fill-blank";
import type { LessonAttempt, LessonJudgement } from "../lesson-contract";
import { openedCard, type ServerLessonQuestion } from "./lesson-catalog";

/** 문항과 시도의 종류·범위가 맞지 않는다. 판정 전에 거절할 입력이다. */
export class LessonAttemptError extends Error {}

/**
 * 시도를 서버 정본과 결정적으로 비교한다. AI도, 한도도, 네트워크도 쓰지 않는 순수 함수라 같은 입력에는 늘 같은 결과다.
 * 이야기 `choose`는 정답 보기와 해설을 함께 낸다. 카드 `fill`은 빈칸별 같음/다름과 정오와 무관한 카드의 글(`card`)을 내고
 * 정답 문자열(`drill.answers`)은 내지 않는다. 첫 답은 `isLessonAttempt`가 비어 있지 않은 입력으로 보장한다.
 * 빈칸 비교는 `lib/fill-blank.ts`의 정규화를 쓴다(대소문자·공백·따옴표 차이만 지운다. gonna와 going to는 다른 답이다).
 */
export function judge(question: ServerLessonQuestion, attempt: LessonAttempt): LessonJudgement {
  if (question.kind === "story") {
    const { options, answer, explain, basis } = question.question;
    if (attempt.kind !== "choose") throw new LessonAttemptError("이야기 문제는 보기를 골라 답합니다.");
    if (attempt.choice < 0 || attempt.choice >= options.length) throw new LessonAttemptError("보기 번호를 확인해 주세요.");
    return { kind: "choose", choice: attempt.choice, match: attempt.choice === answer, answerIndex: answer, explain, ...(basis ? { basis } : {}) };
  }
  const { answers } = question.card.drill;
  if (attempt.kind !== "fill") throw new LessonAttemptError("카드 문제는 빈칸을 채워 답합니다.");
  if (attempt.inputs.length !== answers.length) throw new LessonAttemptError("빈칸 수를 확인해 주세요.");
  const { each, correct } = checkBlanks(attempt.inputs, answers);
  return { kind: "fill", matches: each, allMatch: correct, card: openedCard(question.card) };
}

/** '답 보기': 카드의 정본 답을 연다. 첫 답을 낸 뒤에만 열리는 정책은 호출하는 쪽이 첫 답 입력을 요구해 지킨다. */
export function revealAnswers(question: ServerLessonQuestion, attempt: LessonAttempt): LessonJudgement {
  if (question.kind !== "cards" || attempt.kind !== "fill") throw new LessonAttemptError("답 보기는 카드 문제에만 있습니다.");
  const { answers } = question.card.drill;
  if (attempt.inputs.length !== answers.length) throw new LessonAttemptError("빈칸 수를 확인해 주세요.");
  return { kind: "reveal", answers: [...answers] };
}
