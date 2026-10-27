/**
 * The request the story lesson's "AI에게 설명 요청" button sends. It rests on the learner's first choice, the server judgement
 * and the canonical explanation that the AI context carries (`lessonContext`: passage, question, `correctOption`, `serverJudgement`).
 * The AI never changes the server judgement.
 */
export const storyExplainRequestMessage = "제가 처음 고른 보기와 서버 판정, 정본 해설을 바탕으로, 정본 답이 왜 그 보기인지와 다른 보기는 왜 아닌지 설명해 주세요. 본문의 어느 부분을 보면 되는지도 짚어 주세요. 판정은 그대로 두고, 스스로 다시 확인해 볼 지점을 알려 주세요.";
