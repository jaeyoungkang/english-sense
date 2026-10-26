import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import pageData from "../content/pages.json";
import { LEARNING_QUESTION_IDS, LEGACY_HAVE_CONTENT_VERSION, type LearningQuestionId } from "../lib/learning-catalog";
import { getPublicLearningCatalog, getServerLearningQuestion } from "../lib/server/learning-catalog";

test("public catalog contains seven identified question snapshots without feedback or answers", async () => {
  const catalog = await getPublicLearningCatalog();
  assert.equal(catalog.lessonId, "titanic-have");
  assert.equal(catalog.questions.length, 7);
  assert.deepEqual(catalog.questions.map((question) => question.questionId), LEARNING_QUESTION_IDS);
  assert.deepEqual(catalog.questions.map((question) => question.type), ["choose", "choose", "choose", "choose", "choose", "produce", "produce"]);
  assert.deepEqual(Object.keys(catalog.source).sort(), ["author", "path", "title"]);
  for (const question of catalog.questions) {
    const safeKeys = ["questionId", "type", "ch", "who", "scene", "ask", ...(question.type === "choose" ? ["opts"] : [])];
    assert.deepEqual(Object.keys(question).sort(), safeKeys.sort());
    if (question.type === "choose") {
      assert.equal(question.opts!.length, 3);
      for (const option of question.opts!) assert.deepEqual(Object.keys(option), ["t"]);
    } else assert.equal(question.opts, undefined);
  }
  const wire = JSON.stringify(catalog);
  assert.ok(!wire.includes('"why"'));
  assert.ok(!wire.includes('"feel"'));
  assert.ok(!wire.includes('"answer"'));
  assert.ok(!wire.includes('"fixes"'));
  assert.ok(!wire.includes("He had a white beard and a fancy uniform on."));
});

test("current SHA256 identifies all seven source questions and fixed deployed legacy version", async () => {
  const catalog = await getPublicLearningCatalog();
  const page = pageData.find((page) => page.path === "practice/titanic/have/")!;
  const quiz = page.parts.find((part) => part.kind === "quiz")!;
  assert.ok("questions" in quiz);
  const independentlyHashed = createHash("sha256").update(JSON.stringify(quiz.questions)).digest("hex");
  assert.equal(catalog.contentVersion, independentlyHashed);
  assert.equal(LEGACY_HAVE_CONTENT_VERSION, "e1688b926b2828376fe43011144ed522b8d1716418b4fe4789d7580971bf5cc9");
  assert.equal(catalog.contentVersion, LEGACY_HAVE_CONTENT_VERSION);
});

test("public projection cannot mutate later catalog snapshots or private feedback", async () => {
  const catalog = await getPublicLearningCatalog();
  catalog.questions[0].opts![0].t = "client mutation";
  catalog.source.title = "client mutation";
  const fresh = await getPublicLearningCatalog();
  const server = await getServerLearningQuestion("titanic-have-1");
  assert.notEqual(fresh.questions[0].opts![0].t, "client mutation");
  assert.notEqual(fresh.source.title, "client mutation");
  assert.equal(server.question.type, "choose");
  assert.ok("explanation" in server.context);
  await assert.rejects(getServerLearningQuestion("__proto__" as LearningQuestionId));
});
