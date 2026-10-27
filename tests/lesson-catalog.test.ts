import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ARTIFACT_LESSON_ID, LEARNING_QUESTION_IDS, LEGACY_HAVE_CONTENT_VERSION } from "../lib/learning-catalog";
import { LESSON_DATA } from "../lib/lesson-registry-data";
import { LESSONS, LESSON_ID_PATTERN, getLessonEntry, hasLessonQuestion, unitLessonId } from "../lib/lesson-registry";
import { buildLessonData, getLessonContentVersion, getPublicLesson, getServerLesson, getServerLessonQuestion, renderLessonData } from "../lib/server/lesson-catalog";
import { getStudySource } from "../lib/server/study-source";
import { splitBlanks } from "../lib/fill-blank";

const { reading, prep } = getStudySource();

test("registry lists 29 lessons in a fixed order: one scene, fifteen stories, thirteen unit card lessons", () => {
  assert.equal(LESSONS.length, 29);
  assert.deepEqual(LESSONS.map(lesson => lesson.kind).filter((kind, index, kinds) => kinds.indexOf(kind) === index), ["scene", "story", "cards"]);
  assert.deepEqual(["scene", "story", "cards"].map(kind => LESSONS.filter(lesson => lesson.kind === kind).length), [1, 15, 13]);
  assert.equal(LESSONS[0].lessonId, ARTIFACT_LESSON_ID);
  assert.deepEqual(LESSONS[0].questionIds, LEARNING_QUESTION_IDS);
  assert.deepEqual(LESSONS.filter(lesson => lesson.kind === "story").map(lesson => lesson.lessonId), reading.stories.map(story => story.id));
  assert.deepEqual(LESSONS.filter(lesson => lesson.kind === "cards").map(lesson => lesson.lessonId), prep.works.flatMap(work => work.units.map(unit => unitLessonId(work.id, unit.n))));
});

test("lesson and question ids follow the identity rule and never repeat", () => {
  for (const lesson of LESSONS) {
    assert.match(lesson.lessonId, LESSON_ID_PATTERN);
    for (const id of lesson.questionIds) assert.match(id, LESSON_ID_PATTERN);
  }
  assert.equal(new Set(LESSONS.map(lesson => lesson.lessonId)).size, 29);
  const questionIds = LESSONS.flatMap(lesson => lesson.questionIds);
  assert.equal(new Set(questionIds).size, questionIds.length);
  assert.equal(LESSONS.reduce((sum, lesson) => sum + lesson.questionIds.length, 0), 7 + reading.stories.reduce((sum, story) => sum + story.questions.length, 0) + prep.works.reduce((sum, work) => sum + work.units.reduce((s, unit) => s + unit.cards.length, 0), 0));
});

test("question ids are the source ids, never positions", () => {
  const story = reading.stories[0];
  assert.deepEqual(getLessonEntry(story.id)?.questionIds, story.questions.map(question => question.id));
  const entry = getLessonEntry("wonder-unit-0")!;
  assert.equal(entry.kind, "cards");
  assert.ok(hasLessonQuestion(entry, "wonder-0-01"));
  assert.ok(!hasLessonQuestion(entry, "wonder-1-01"));
});

test("registry data matches the canonical source and the committed file is exactly what the generator renders", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(LESSON_DATA)), JSON.parse(JSON.stringify(buildLessonData())));
  assert.equal(readFileSync(new URL("../lib/lesson-registry-data.ts", import.meta.url), "utf8"), renderLessonData(buildLessonData()), "npx tsx scripts/generate-lesson-registry.ts 로 다시 만듭니다");
});

test("registry rejects unknown lessons, prototype keys and foreign questions", () => {
  for (const id of ["__proto__", "constructor", "toString", "nope", "", 1, null, undefined]) assert.equal(getLessonEntry(id), undefined);
  assert.equal(hasLessonQuestion(getLessonEntry("bus-dog")!, "green-umbrella-content-1"), false);
  assert.equal(hasLessonQuestion(getLessonEntry("bus-dog")!, undefined), false);
});

test("public projection of every story lesson has no answer, explanation or basis, by key or by text", async () => {
  for (const story of reading.stories) {
    const lesson = await getPublicLesson(story.id);
    assert.equal(lesson.kind, "story");
    if (lesson.kind !== "story") continue;
    assert.deepEqual(Object.keys(lesson).sort(), ["contentVersion", "draft", "kind", "lessonId", "limitSeconds", "paragraphs", "questions", "title", "words", ...(story.pair ? ["pair"] : [])].sort());
    assert.equal(lesson.questions.length, story.questions.length);
    for (const [index, question] of lesson.questions.entries()) {
      const source = story.questions[index];
      assert.deepEqual(Object.keys(question).sort(), ["kind", "options", "question", "questionId", ...(source.card ? ["card"] : [])].sort());
      assert.equal(question.questionId, source.id);
      assert.deepEqual(question.options, source.options);
    }
    const wire = JSON.stringify(lesson);
    for (const key of ["answer", "explain", "basis"]) assert.ok(!wire.includes(`"${key}"`), `${story.id}: ${key}`);
    for (const source of story.questions) {
      assert.ok(!wire.includes(JSON.stringify(source.explain).slice(1, -1)), `${source.id}: explain`);
      if (source.basis) assert.ok(!wire.includes(JSON.stringify(source.basis).slice(1, -1)), `${source.id}: basis`);
    }
  }
});

test("public projection of every card lesson drops the blank answers and keeps only the blank count", async () => {
  for (const work of prep.works) for (const unit of work.units) {
    const lesson = await getPublicLesson(unitLessonId(work.id, unit.n));
    assert.equal(lesson.kind, "cards");
    if (lesson.kind !== "cards") continue;
    assert.deepEqual(Object.keys(lesson).sort(), ["cards", "contentVersion", "kind", "lessonId", "unit", "work"]);
    assert.deepEqual(lesson.cards.map(card => card.questionId), unit.cards.map(card => card.id));
    const wire = JSON.stringify(lesson);
    assert.ok(!wire.includes('"answers"'), unit.when);
    for (const [index, card] of lesson.cards.entries()) {
      const source = unit.cards[index];
      assert.deepEqual(Object.keys(card.drill).sort(), [...(("part" in source.drill) ? ["part"] : ["time"]), "blanks", "hint", "sentence"].sort());
      assert.equal(card.drill.blanks, source.drill.answers.length);
      assert.equal(splitBlanks(card.drill.sentence).length - 1, card.drill.blanks);
      assert.equal(card.drill.sentence, source.drill.sentence);
      assert.ok(card.drill.sentence.includes("___"), card.questionId);
    }
  }
});

test("scene lesson passes the existing public catalog through unchanged", async () => {
  const lesson = await getPublicLesson(ARTIFACT_LESSON_ID);
  assert.equal(lesson.kind, "scene");
  assert.equal(lesson.contentVersion, LEGACY_HAVE_CONTENT_VERSION);
  assert.equal(await getLessonContentVersion(ARTIFACT_LESSON_ID), LEGACY_HAVE_CONTENT_VERSION);
  assert.ok(!JSON.stringify(lesson).includes('"feel"'));
  assert.throws(() => getServerLesson(ARTIFACT_LESSON_ID), /lesson_unavailable/);
});

test("content version is a per-lesson SHA-256 of the whole canonical lesson, answers included", async () => {
  const story = reading.stories[0];
  assert.equal(await getLessonContentVersion(story.id), createHash("sha256").update(JSON.stringify(story)).digest("hex"));
  const unit = prep.works[0].units[0];
  assert.equal(await getLessonContentVersion(unitLessonId(prep.works[0].id, unit.n)), createHash("sha256").update(JSON.stringify({ work: prep.works[0].id, unit })).digest("hex"));
  const versions = await Promise.all(LESSONS.map(lesson => getLessonContentVersion(lesson.lessonId)));
  assert.ok(versions.every(version => /^[a-f0-9]{64}$/.test(version)));
  assert.equal(new Set(versions).size, versions.length);
  assert.equal((await getPublicLesson(story.id)).contentVersion, versions[LESSONS.findIndex(lesson => lesson.lessonId === story.id)]);
});

test("server lookup returns canonical answers only through the server module and rejects unknown ids", () => {
  const story = reading.stories[0];
  const found = getServerLessonQuestion(story.id, story.questions[1].id);
  assert.equal(found.kind, "story");
  if (found.kind === "story") assert.deepEqual(found.question, story.questions[1]);
  const card = prep.works[0].units[0].cards[2];
  const foundCard = getServerLessonQuestion("wonder-unit-0", card.id);
  assert.equal(foundCard.kind, "cards");
  if (foundCard.kind === "cards") assert.deepEqual(foundCard.card.drill.answers, card.drill.answers);
  for (const [lessonId, questionId] of [["__proto__", "x"], ["nope", "x"], [story.id, "__proto__"], [story.id, card.id], ["wonder-unit-0", story.questions[0].id], [ARTIFACT_LESSON_ID, "titanic-have-1"]] as const) {
    assert.throws(() => getServerLessonQuestion(lessonId, questionId), /lesson_(question_)?unavailable/, `${lessonId}/${questionId}`);
  }
  assert.throws(() => getServerLesson("wonder-unit-99"), /lesson_unavailable/);
});

test("mutating a public projection cannot change later projections or the canonical source", async () => {
  const lesson = await getPublicLesson("green-umbrella");
  assert.equal(lesson.kind, "story");
  if (lesson.kind !== "story") return;
  const title = reading.stories[0].title;
  const firstOption = reading.stories[0].questions[0].options[0];
  lesson.title = "client mutation";
  lesson.questions[0].options[0] = "client mutation";
  lesson.paragraphs[0][0].text = "client mutation";
  const fresh = await getPublicLesson("green-umbrella");
  assert.equal(fresh.kind === "story" && fresh.title, title);
  assert.equal(fresh.kind === "story" && fresh.questions[0].options[0], firstOption);
  assert.equal(reading.stories[0].questions[0].options[0], firstOption);
  const cards = await getPublicLesson("wonder-unit-0");
  if (cards.kind === "cards") cards.cards[0].example.text = "client mutation";
  assert.notEqual(prep.works[0].units[0].cards[0].example.text, "client mutation");
});
