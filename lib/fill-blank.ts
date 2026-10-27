export const BLANK = "___";

/** 빈칸 문장을 빈칸 앞뒤 조각으로 나눈다. 조각 수는 빈칸 수보다 하나 많다. */
export function splitBlanks(sentence: string) {
  return sentence.split(BLANK);
}

/** 대소문자, 앞뒤·겹친 공백, 굽은 따옴표와 폭이 다른 글자의 차이를 지운다. */
export function normalizeAnswer(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 빈칸마다 쓴 답이 정답과 같은지 본다. 빈칸 수가 다르면 틀린 것으로 본다. */
export function checkBlanks(inputs: string[], answers: string[]) {
  const each = answers.map((answer, index) => normalizeAnswer(inputs[index] ?? "") === normalizeAnswer(answer));
  return { each, correct: inputs.length === answers.length && each.every(Boolean) };
}
