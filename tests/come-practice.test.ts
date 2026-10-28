import assert from "node:assert/strict";
import { test } from "node:test";
import pageData from "../content/pages.json";
import siteData from "../content/site.json";
import type { ContentPage, FillQuestion, QuizContent } from "../lib/content";

const page = (pageData as ContentPage[]).find((entry) => entry.path === "practice/titanic/come/")!;
const quiz = page.parts.find((part): part is QuizContent => part.kind === "quiz")!;

test("the come practice page has five choose questions and two fill questions in the go layout", () => {
  assert.deepEqual(quiz.questions.map((question) => question.type), ["choose", "choose", "choose", "choose", "choose", "fill", "fill"]);
  for (const question of quiz.questions) {
    if (question.type !== "choose") continue;
    assert.equal(question.opts.length, 3);
    assert.deepEqual(question.opts.map((option) => option.k).sort(), ["en", "ko", "la"]);
    assert.ok(question.opts.every((option) => option.why.length > 0) && question.feel.length > 0);
  }
  assert.equal(siteData.books[0].units.come, "고르기 5 · 빈칸 넣기 2");
});

test("a fill question keeps the book text around the blank and puts the model answer, feel and fixes in their own fields", () => {
  const fills = quiz.questions.filter((question): question is FillQuestion => question.type === "fill");
  assert.equal(fills.length, 2);
  for (const fill of fills) {
    assert.match(fill.blank, /\(\s+\)/, "the blank line keeps its empty slot");
    assert.ok(fill.before.length > 0 && fill.after.length > 0);
    assert.equal(fill.hintVerb, "come");
    assert.ok(fill.hintWords.length > 0 && fill.hintKo.length > 0 && fill.feel.length > 0);
    assert.equal(fill.book, fill.answer, "the model answer is the book sentence");
    assert.ok(fill.fixes.length > 0 && fill.fixes.every(([text, why]) => text.includes("→") && why.length > 0));
    for (const secret of [fill.answer, ...fill.hintWords]) assert.ok(![fill.hintKo, fill.blank, ...fill.before, ...fill.after].some((visible) => visible.toLowerCase().includes(secret.toLowerCase())), `visible text must not contain ${secret}`);
  }
  assert.equal(fills[0].fixes[0][0], "Where you come from? → Where did you come from?");
  assert.equal(fills[1].fixes[0][0], "come out → come up");
});

test("the come practice text never says the question word do is explained by a sense", () => {
  const text = JSON.stringify(page);
  assert.ok(!/do[^.]{0,20}감각으로/.test(text));
});
