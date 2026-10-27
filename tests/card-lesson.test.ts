import assert from "node:assert/strict";
import { test } from "node:test";
import { cardAttemptsForRequest, cardStage, explainRequestMessage, joinInputs, madeAfterReveal, placeLabel, sameInputs, setCardInput, setCardMessageDraft } from "../lib/card-lesson";
import { isLessonChatRequest, type LessonChatRequest } from "../lib/lesson-chat-contract";
import type { LessonCheckRequest, LessonCheckResponse } from "../lib/lesson-contract";
import { LESSONS } from "../lib/lesson-registry";
import {
  acceptLessonCheck, acceptLessonReveal, buildLessonCheckRequest, buildLessonRevealRequest, createLessonState, isLessonState, projectLessonArtifacts, registerLessonArtifact,
  restoreLessonState, submitLessonAttempt, type LessonState,
} from "../lib/lesson-workspace-state";
import { getCardLessonView } from "../lib/server/card-lesson-view";
import { handleLessonCheck } from "../lib/server/lesson-check";
import { getStudySource } from "../lib/server/study-source";

const view = async (work = "wonder", unit = 0) => (await getCardLessonView(work, unit))!;
async function respond(request: LessonCheckRequest): Promise<LessonCheckResponse> {
  const response = await handleLessonCheck(new Request("https://english.example/api/lesson-check/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
  assert.equal(response.status, 200);
  return await response.json() as LessonCheckResponse;
}
const twoBlanks = async () => {
  const { lesson } = await view();
  const card = lesson.cards.find(item => item.drill.blanks === 2)!;
  return { lesson, card };
};

test("the unit view carries the public lesson only: 13 units, no drill.answers, no answer strings", async () => {
  const { prep } = getStudySource();
  let units = 0;
  for (const work of prep.works) for (const unit of work.units) {
    units++;
    const result = (await getCardLessonView(work.id, unit.n))!;
    const text = JSON.stringify(result);
    assert.equal(result.lesson.cards.length, unit.cards.length);
    assert.equal(text.includes('"answers"'), false, `${work.id} unit ${unit.n}: no answers key`);
    for (const card of unit.cards) {
      assert.equal(text.includes(JSON.stringify(card.drill.answers)), false, `${card.id}: the answers array is not in the view`);
      let filled = card.drill.sentence;
      for (const answer of card.drill.answers) filled = filled.replace("___", answer);
      assert.equal(text.includes(JSON.stringify(filled).slice(1, -1)), false, `${card.id}: the filled sentence is not in the view`);
    }
  }
  assert.equal(units, 13);
  assert.equal(await getCardLessonView("wonder", 99), null);
  assert.equal(await getCardLessonView("nope", 0), null);
});

test("neighbouring units, the count label and the stories written with the expressions come from public fields", async () => {
  const unit3 = await view("wonder", 3);
  assert.equal(unit3.prev?.href, "/prep/wonder/unit-2/");
  assert.equal(unit3.next?.href, "/prep/wonder/unit-4/");
  assert.equal(unit3.countLabel, "책 전체");
  assert.deepEqual(unit3.pairs.map(story => story.id), ["prep-wonder-3"]);
  assert.deepEqual(Object.keys(unit3.pairs[0]).sort(), ["draft", "id", "limitSeconds", "questions", "title", "words"]);
  const movie = await view("zootopia", 0);
  assert.equal(movie.countLabel, "영화 전체");
  assert.equal(movie.prev, null);
  assert.equal(movie.next, null);
  assert.equal(movie.listHref, "/prep/zootopia/");
});

test("the source line of an example (from the judgement's card) and of the blank sentence matches the old page", async () => {
  const { lesson } = await view();
  const request: LessonCheckRequest = { action: "check", lessonId: lesson.lessonId, questionId: lesson.cards[0].questionId, contentVersion: lesson.contentVersion, artifactId: "a-1", requestId: "r-1", attempt: { kind: "fill", inputs: ["x"] } };
  const response = await respond(request);
  assert.equal(response.kind, "fill");
  const example = response.kind === "fill" ? response.card!.example : null;
  assert.match(placeLabel(lesson.work, example!), /^Wonder \(R\. J\. Palacio, 2012\) · \d부$/);
  const movie = await view("zootopia", 0);
  assert.match(placeLabel(movie.lesson.work, movie.lesson.cards[0].drill), /^Zootopia \(2016\) · \d\d:\d\d:\d\d$/);
});

test("typing a blank gives the card its record without an event, and reading or selecting alone changes nothing", async () => {
  const { lesson, card } = await twoBlanks();
  const empty = createLessonState(lesson);
  assert.equal(setCardInput(empty, lesson, card.questionId, 0, ""), empty, "an empty value on an unregistered card changes nothing");
  assert.equal(setCardInput(empty, lesson, card.questionId, 5, "x"), empty, "an unknown blank changes nothing");
  const typed = setCardInput(empty, lesson, card.questionId, 1, "up");
  assert.equal(isLessonState(typed), true);
  assert.deepEqual(typed.events, []);
  assert.deepEqual(typed.artifacts[0].inputs, ["", "up"]);
  assert.equal(setCardInput(typed, lesson, card.questionId, 1, "up"), typed, "the same value is not a change");
  const long = setCardInput(typed, lesson, card.questionId, 0, "x".repeat(150));
  assert.equal([...long.artifacts[0].inputs[0]].length, 100);
  assert.equal(isLessonState(JSON.parse(JSON.stringify(long))), true, "a clipped draft still satisfies the record contract");
  const drafted = setCardMessageDraft(long, lesson, card.questionId, "질문 초안");
  assert.equal(drafted.artifacts[0].messageDraft, "질문 초안");
  assert.equal(setCardMessageDraft(empty, lesson, card.questionId, ""), empty);
});

test("a card of another content version is read only: drafts do not change", async () => {
  const { lesson, card } = await twoBlanks();
  const typed = setCardInput(createLessonState(lesson), lesson, card.questionId, 0, "pick");
  const other = { ...lesson, contentVersion: "f".repeat(64) };
  assert.equal(setCardInput(typed, other, card.questionId, 0, "changed"), typed);
  assert.equal(setCardMessageDraft(typed, other, card.questionId, "changed"), typed);
  assert.equal(cardStage(typed.artifacts[0], other), "old");
});

test("first answer, partial match, revision, reveal and the stages between them", async () => {
  const { lesson, card } = await twoBlanks();
  let state: LessonState = createLessonState(lesson);
  state = setCardInput(setCardInput(state, lesson, card.questionId, 0, "pick"), lesson, card.questionId, 1, "down");
  const artifactId = state.artifacts[0].artifactId;
  assert.equal(cardStage(state.artifacts[0], lesson), "first");
  assert.throws(() => buildLessonRevealRequest(state, lesson, artifactId, "reveal-1"), "no answer can be seen before a first answer");

  state = submitLessonAttempt(state, lesson, artifactId, { kind: "fill", inputs: ["pick", "down"] });
  assert.equal(cardStage(state.artifacts[0], lesson), "waiting");
  const request = buildLessonCheckRequest(state, lesson, artifactId, "check-1");
  const response = await respond(request);
  assert.deepEqual(response.kind === "fill" ? response.matches : null, [true, false]);
  state = acceptLessonCheck(state, request, response);
  assert.equal(cardStage(state.artifacts[0], lesson), "revise");

  const revealRequest = buildLessonRevealRequest(state, lesson, artifactId, "reveal-1");
  state = acceptLessonReveal(state, revealRequest, await respond(revealRequest));
  assert.equal(state.artifacts[0].reveal?.afterAttempts, 1);

  state = submitLessonAttempt(state, lesson, artifactId, { kind: "fill", inputs: ["pick", "up"] });
  assert.equal(madeAfterReveal(state.artifacts[0], 0), false);
  assert.equal(madeAfterReveal(state.artifacts[0], 1), true, "attempts after the answers were shown are marked");
  const second = buildLessonCheckRequest(state, lesson, artifactId, "check-2");
  state = acceptLessonCheck(state, second, await respond(second));
  assert.equal(cardStage(state.artifacts[0], lesson), "match");
  assert.deepEqual(state.artifacts[0].attempts[0].attempt, { kind: "fill", inputs: ["pick", "down"] }, "the first answer is not replaced");
  assert.equal(isLessonState(JSON.parse(JSON.stringify(state))), true);
});

test("the revision limit ends the stages at limit", async () => {
  const { lesson, card } = await twoBlanks();
  let state = registerLessonArtifact(createLessonState(lesson), lesson, card.questionId);
  const artifactId = state.artifacts[0].artifactId;
  for (let round = 0; round < 7; round++) {
    state = submitLessonAttempt(state, lesson, artifactId, { kind: "fill", inputs: [`a${round}`, "b"] });
    const request = buildLessonCheckRequest(state, lesson, artifactId, `check-${round}`);
    state = acceptLessonCheck(state, request, await respond(request));
  }
  assert.equal(state.artifacts[0].attempts.length, 7);
  assert.equal(cardStage(state.artifacts[0], lesson), "limit");
  assert.throws(() => submitLessonAttempt(state, lesson, artifactId, { kind: "fill", inputs: ["x", "y"] }));
});

test("the AI request carries the first answer as it was and later attempts as one line, and passes the request contract", async () => {
  const { lesson, card } = await twoBlanks();
  let state = registerLessonArtifact(createLessonState(lesson), lesson, card.questionId);
  const artifactId = state.artifacts[0].artifactId;
  assert.deepEqual(cardAttemptsForRequest(state.artifacts[0]), { initialAttempt: null, revisions: [] });
  for (const inputs of [["pick", "out"], ["pick", ""]]) {
    state = submitLessonAttempt(state, lesson, artifactId, { kind: "fill", inputs });
    const request = buildLessonCheckRequest(state, lesson, artifactId, `c-${inputs.join("")}`);
    state = acceptLessonCheck(state, request, await respond(request));
  }
  const { initialAttempt, revisions } = cardAttemptsForRequest(state.artifacts[0]);
  assert.deepEqual(initialAttempt, { kind: "fill", inputs: ["pick", "out"] });
  assert.deepEqual(revisions, [{ text: "pick / (비움)" }]);
  const body: LessonChatRequest = { lessonId: lesson.lessonId, questionId: card.questionId, contentVersion: lesson.contentVersion, artifactId, requestId: "r-1", initialAttempt, revisions, messages: [], message: explainRequestMessage };
  assert.equal(isLessonChatRequest(body), true);
  assert.equal(isLessonChatRequest({ ...body, initialAttempt: null }), false, "revisions need a first answer");
  assert.equal(joinInputs(["a", " b "]), "a / b");
  assert.equal(sameInputs(["a"], ["a"]), true);
  assert.equal(sameInputs(["a"], ["a", ""]), false);
});

test("a record restored with an old content version keeps its answers and judgements and reads as old", async () => {
  const { lesson, card } = await twoBlanks();
  let state = registerLessonArtifact(createLessonState(lesson), lesson, card.questionId);
  const artifactId = state.artifacts[0].artifactId;
  state = submitLessonAttempt(state, lesson, artifactId, { kind: "fill", inputs: ["pick", "down"] });
  const request = buildLessonCheckRequest(state, lesson, artifactId, "check-1");
  state = acceptLessonCheck(state, request, await respond(request));
  const stored = JSON.stringify(state).replaceAll(lesson.contentVersion, "e".repeat(64));
  const restored = restoreLessonState(stored, lesson, 0);
  const artifact = projectLessonArtifacts(restored, lesson).find(item => item.question.questionId === card.questionId)!;
  assert.equal(cardStage(artifact, lesson), "old");
  assert.equal(artifact.attempts.length, 1);
  assert.equal(artifact.attempts[0].check?.kind, "fill");
});

test("every unit of the registry has a view and a matching lesson entry", async () => {
  const entries = LESSONS.filter(entry => entry.kind === "cards");
  assert.equal(entries.length, 13);
  for (const entry of entries) {
    const result = (await getCardLessonView(entry.workId, entry.unit))!;
    assert.equal(result.lesson.lessonId, entry.lessonId);
    assert.deepEqual(result.lesson.cards.map(card => card.questionId), [...entry.questionIds]);
  }
});
