import assert from "node:assert/strict";
import { test } from "node:test";
import { cardStage, namesExpression } from "../lib/card-lesson";
import { isLessonChatRequest } from "../lib/lesson-chat-contract";
import { isLessonCheckResponse, isOpenedCard, type LessonCheckRequest, type LessonCheckResponse, type OpenedCard } from "../lib/lesson-contract";
import {
  acceptLessonCard, acceptLessonCheck, buildLessonCardRequest, buildLessonCheckRequest, buildLessonRevealRequest, createLessonState, isLessonState, loadLessonRecord, openedCardOf,
  projectLessonArtifacts, registerLessonArtifact, restoreLessonState, submitLessonAttempt, type LessonState,
} from "../lib/lesson-workspace-state";
import { cardBlocks } from "../lib/note-blocks";
import { namelessSummary, cardCount } from "../lib/study-content";
import { getCardLessonView } from "../lib/server/card-lesson-view";
import { lessonContext } from "../lib/server/lesson-chat-context";
import { getServerLessonQuestion, openedCard } from "../lib/server/lesson-catalog";
import { handleLessonCheck } from "../lib/server/lesson-check";
import { judge } from "../lib/server/lesson-judge";
import { getStudyListing, getStudySource, studyPages } from "../lib/server/study-source";

/**
 * The recall gate of the cards lesson: before a first answer the page holds the meaning, the Korean hint, the blank sentence and its
 * source line, and names no expression. The first judgement response carries the card. These tests read all 13 units (195 cards).
 */
const { prep } = getStudySource();
const allUnits = prep.works.flatMap(work => work.units.map(unit => ({ work, unit })));
const allCards = allUnits.flatMap(({ unit }) => unit.cards);

async function respond(request: LessonCheckRequest): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const response = await handleLessonCheck(new Request("https://english.example/api/lesson-check/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), text };
}
const ok = async (request: LessonCheckRequest) => { const result = await respond(request); assert.equal(result.status, 200, result.text); return result.body as unknown as LessonCheckResponse; };
const checkOf = (lessonId: string, contentVersion: string, questionId: string, inputs: string[], overrides: Partial<LessonCheckRequest> = {}): LessonCheckRequest =>
  ({ action: "check", lessonId, questionId, contentVersion, artifactId: "a-1", requestId: "r-1", attempt: { kind: "fill", inputs }, ...overrides });

test("the public view of every unit (195 cards) holds only what shows before a first answer", async () => {
  let cards = 0;
  for (const { work, unit } of allUnits) {
    const view = (await getCardLessonView(work.id, unit.n))!;
    const json = JSON.stringify(view);
    assert.equal(view.lesson.cards.length, unit.cards.length);
    for (const key of ['"expression"', '"count"', '"countInPart"', '"sense"', '"basis"', '"example"', '"answers"']) assert.equal(json.includes(key), false, `${work.id} unit ${unit.n}: no ${key} key`);
    for (const [index, card] of unit.cards.entries()) {
      cards++;
      const shown = view.lesson.cards[index];
      assert.deepEqual(Object.keys(shown).sort(), ["drill", "meaning", "questionId"], card.id);
      assert.deepEqual(Object.keys(shown.drill).sort(), ["blanks", "hint", "sentence", ...("part" in card.drill ? ["part"] : ["time"])].sort(), card.id);
      // The closed texts of the card (sense, basis, example) are not in the view, nor is any other card's.
      for (const closed of [card.sense, card.basis, card.example.text]) assert.equal(json.includes(JSON.stringify(closed).slice(1, -1)), false, `${card.id}: closed text is not in the view`);
      // What does show names no expression of its own card.
      assert.equal(namesExpression(card.meaning, [card.expression]), false, `${card.id}: the meaning names the expression`);
      assert.equal(namesExpression(card.drill.hint, [card.expression]), false, `${card.id}: the hint names the expression`);
    }
    const expressions = unit.cards.map(card => card.expression);
    assert.equal(namesExpression(view.lesson.unit.summary, expressions), false, `${work.id} unit ${unit.n}: the summary names an expression: ${view.lesson.unit.summary}`);
    for (const story of view.pairs) assert.equal(story.title === null ? false : namesExpression(story.title, expressions), false, `${work.id} unit ${unit.n}: the story title ${story.title} names an expression`);
  }
  assert.equal(cards, 195);
});

test("a story whose title names one of the unit's expressions is listed without its title; other titles stay", async () => {
  assert.equal(namesExpression("Ask Dude", ["Dude"]), true);
  assert.equal(namesExpression("The Seven O'Clock E-mails", ["e-mail"]), true);
  assert.equal(namesExpression("Tuesday Again", ["again"]), true);
  assert.equal(namesExpression("Known for Something", ["be known for"]), true, "the form without 'be' counts");
  assert.equal(namesExpression("Night School", ["go to school", "first day (of school)"]), false);
  assert.equal(namesExpression("Step, Step, Slide", ["hang out (with)", "look at / look up"]), false);
  assert.equal(namesExpression("Leaving in June", ["leave", "in the world"]), false);
  assert.equal(namesExpression("Two Hands", [""]), false);
  const dude = (await getCardLessonView("wonder", 4))!, june = (await getCardLessonView("wonder", 3))!;
  assert.deepEqual(dude.pairs.map(story => story.title), [null]);
  assert.deepEqual(june.pairs.map(story => story.title), ["Leaving in June"]);
  assert.deepEqual((await getCardLessonView("wonder", 8))!.pairs.map(story => story.title), [null]);
  assert.deepEqual((await getCardLessonView("groundhog-day", 0))!.pairs.map(story => story.title), [null]);
  assert.deepEqual((await getCardLessonView("the-intern", 0))!.pairs.map(story => story.title), [null]);
});

test("unit summaries, list pages and page descriptions name no expression", () => {
  assert.equal(namelessSummary("책 전체에 자주 나오는 표현 21개(kind of 136회, have to 110회, look at/up 151회 …)"), "책 전체에 자주 나오는 표현 21개");
  assert.equal(namelessSummary("12개(stare at, even though, raise one's hand, by the way …)"), "표현 12개");
  assert.equal(namelessSummary("표현 5개"), "표현 5개");
  const listing = getStudyListing();
  for (const work of listing.prep.works) for (const unit of work.units) {
    const cards = prep.works.find(item => item.id === work.id)!.units.find(item => item.n === unit.n)!.cards;
    assert.equal(namesExpression(unit.summary, cards.map(card => card.expression)), false, `${work.id} unit ${unit.n}: ${unit.summary}`);
    assert.ok(!/[()]/.test(unit.summary), unit.summary);
  }
  const pages = studyPages().filter(page => page.parts.some(part => part.kind === "prep-unit"));
  assert.equal(pages.length, 13);
  for (const page of pages) {
    const part = page.parts[0] as { kind: "prep-unit"; id: string; unit: number };
    const cards = prep.works.find(work => work.id === part.id)!.units.find(unit => unit.n === part.unit)!.cards;
    assert.equal(namesExpression(`${page.title} ${page.description}`, cards.map(card => card.expression)), false, `${page.path}: ${page.description}`);
    assert.match(page.description, /익힐 표현/);
  }
  assert.equal(cardCount(prep.works[0]) > 0, true);
});

test("every check response of a card (195 cards) carries its card whether the answer is wrong or right, and never the answers", async () => {
  let cards = 0;
  for (const { work, unit } of allUnits) {
    const lessonId = `${work.id}-unit-${unit.n}`, view = (await getCardLessonView(work.id, unit.n))!;
    for (const card of unit.cards) {
      cards++;
      for (const inputs of [card.drill.answers.map(() => "zzz"), card.drill.answers, card.drill.answers.map((_, at) => at === 0 ? "zzz" : card.drill.answers[at])]) {
        const body = await ok(checkOf(lessonId, view.lesson.contentVersion, card.id, inputs));
        assert.equal(body.kind, "fill");
        if (body.kind !== "fill") continue;
        assert.deepEqual(body.card, openedCard(card), `${card.id}: the card is opened the same way for ${JSON.stringify(inputs)}`);
        assert.equal(isLessonCheckResponse(body), true, card.id);
        assert.equal(isOpenedCard(body.card), true);
        const text = JSON.stringify(body);
        assert.equal(text.includes('"answers"'), false, `${card.id}: no answers key`);
        assert.equal(text.includes('"drill"'), false, `${card.id}: no drill`);
        assert.equal(text.includes(JSON.stringify(card.drill.answers)), false, `${card.id}: no answers array`);
        assert.deepEqual(Object.keys(body.card!).sort(), ["basis", "example", "expression", "sense", ...(card.countInPart !== undefined ? ["count", "countInPart"] : ["count"])].sort(), card.id);
      }
    }
  }
  assert.equal(cards, 195);
});

test("an empty first answer opens nothing: it is refused before any judgement and the body has no card", async () => {
  const unit = prep.works[0].units[0], card = unit.cards.find(item => item.id === "wonder-0-12")!, view = (await getCardLessonView("wonder", 0))!;
  for (const inputs of [["", ""], [" ", "\t"], [""], []]) {
    const result = await respond(checkOf("wonder-unit-0", view.lesson.contentVersion, card.id, inputs));
    assert.equal(result.status, 400, JSON.stringify(inputs));
    assert.equal(result.text.includes("pick up"), false);
    assert.equal(result.text.includes('"card"'), false);
  }
  // One filled blank is enough, right or wrong.
  const partial = await ok(checkOf("wonder-unit-0", view.lesson.contentVersion, card.id, ["", "x"]));
  assert.equal(partial.kind === "fill" && partial.card?.expression, "pick up");
  // An old content version, a story lesson and a malformed card are refused without a card.
  const stale = await respond(checkOf("wonder-unit-0", "0".repeat(64), card.id, ["pick", "up"]));
  assert.equal(stale.status, 409);
  assert.equal(stale.text.includes("pick up"), false);
  // 'reveal' still opens the answers only, never the card.
  const reveal = await ok(checkOf("wonder-unit-0", view.lesson.contentVersion, card.id, ["pick", ""], { action: "reveal" }));
  assert.deepEqual(Object.keys(reveal).sort(), ["answers", "artifactId", "contentVersion", "kind", "lessonId", "questionId", "requestId"]);
});

test("the contract validates the card when present and still accepts a response without one", () => {
  const base = { requestId: "r", lessonId: "wonder-unit-0", artifactId: "a", questionId: "wonder-0-12", contentVersion: "a".repeat(64), kind: "fill", matches: [true, false], allMatch: false };
  const card: OpenedCard = { expression: "pick up", count: 4, sense: "집어 올린다", basis: "감각 사전 up", example: { part: 3, text: "Mom will pick me up." } };
  assert.equal(isLessonCheckResponse(base), true, "a response without a card (an old record's check) stays valid");
  assert.equal(isLessonCheckResponse({ ...base, card }), true);
  assert.equal(isLessonCheckResponse({ ...base, card: { ...card, countInPart: 2 } }), true);
  assert.equal(isLessonCheckResponse({ ...base, card: { ...card, example: { time: "00:01:02", text: "x" } } }), true);
  for (const [name, bad] of [
    ["extra key", { ...card, answers: ["up"] }], ["missing expression", { ...card, expression: undefined }], ["blank expression", { ...card, expression: " " }],
    ["negative count", { ...card, count: -1 }], ["fractional count", { ...card, count: 1.5 }], ["string sense", { ...card, sense: 3 }], ["example without text", { ...card, example: { part: 3 } }],
    ["example with both places", { ...card, example: { part: 3, time: "00:00:01", text: "x" } }], ["null", null], ["array", []], ["long expression", { ...card, expression: "x".repeat(501) }],
  ] as const) assert.equal(isLessonCheckResponse({ ...base, card: bad }), false, name);
  // A card on a response that is not a fill judgement is not part of the contract.
  assert.equal(isLessonCheckResponse({ requestId: "r", lessonId: "x", artifactId: "a", questionId: "q", contentVersion: "a".repeat(64), kind: "reveal", answers: ["up"], card }), false);
});

/** The state of one card after the learner typed and the real handler judged. */
async function answered(inputs: string[], index = 11, id = "wonder-unit-0") {
  const view = (await getCardLessonView("wonder", 0))!, lesson = view.lesson, questionId = lesson.cards[index].questionId;
  let state = registerLessonArtifact(createLessonState(lesson), lesson, questionId);
  const artifactId = state.artifacts[0].artifactId;
  state = submitLessonAttempt(state, lesson, artifactId, { kind: "fill", inputs });
  const request = buildLessonCheckRequest(state, lesson, artifactId, "check-1");
  const response = await ok(request);
  return { lesson, state, artifactId, request, response, accepted: acceptLessonCheck(state, request, response), id };
}

test("the first judgement's card is kept in the record and opens the card; a later judgement does not repeat it", async () => {
  const { lesson, state, artifactId, request, response, accepted } = await answered(["pick", "down"]);
  assert.equal(openedCardOf(state.artifacts[0]), null, "closed before the judgement is accepted");
  assert.equal(response.kind === "fill" && response.card?.expression, "pick up");
  assert.equal(isLessonState(accepted), true);
  assert.equal(openedCardOf(accepted.artifacts[0])?.expression, "pick up");
  const restored = restoreLessonState(JSON.stringify(accepted), lesson, 0);
  assert.equal(JSON.stringify(restored), JSON.stringify(accepted), "the card survives the round trip");
  assert.equal(openedCardOf(projectLessonArtifacts(restored, lesson)[11])?.example.text.length! > 0, true);
  assert.equal(request.attempt.kind, "fill");
  // A revision is judged again; its response carries the card again, and the record keeps the first copy only.
  const revised = submitLessonAttempt(accepted, lesson, artifactId, { kind: "fill", inputs: ["pick", "up"] });
  const second = buildLessonCheckRequest(revised, lesson, artifactId, "check-2");
  const next = acceptLessonCheck(revised, second, await ok(second));
  assert.equal(isLessonState(next), true);
  assert.equal(next.artifacts[0].attempts[1].check?.kind === "fill" && "card" in next.artifacts[0].attempts[1].check, false);
  assert.equal(next.artifacts[0].attempts[0].check?.kind === "fill" && !!next.artifacts[0].attempts[0].check.card, true);
  assert.equal(cardStage(next.artifacts[0], lesson), "match");
  // A wrong first answer opens the card as well as a right one.
  const right = await answered(["pick", "up"]);
  assert.equal(openedCardOf(right.accepted.artifacts[0])?.expression, "pick up");
});

test("a judgement for another request, attempt or lesson is not adopted, so the card never opens on the wrong artifact", async () => {
  const { state, request, response } = await answered(["pick", "down"]);
  assert.equal(acceptLessonCheck(state, { ...request, requestId: "other" }, response), state);
  assert.equal(acceptLessonCheck(state, { ...request, artifactId: "q-other" }, { ...response, artifactId: "q-other" } as LessonCheckResponse), state);
  assert.equal(acceptLessonCheck(state, { ...request, attempt: { kind: "fill", inputs: ["pick", "up"] } }, response), state);
});

/** A record as the app wrote it before cards opened with the first answer: the full card in the snapshot, a check without `card`. */
async function legacyRecord() {
  const { lesson, accepted } = await answered(["pick", "down"]);
  const source = prep.works[0].units[0].cards[11];
  const state = structuredClone(accepted);
  const artifact = state.artifacts[0];
  if (artifact.attempts[0].check?.kind === "fill") delete artifact.attempts[0].check.card;
  artifact.question = { questionId: source.id, expression: source.expression, count: source.count, meaning: source.meaning, sense: source.sense, basis: source.basis, example: { ...source.example }, drill: { ...source.drill, answers: undefined, blanks: 2 } } as never;
  delete (artifact.question as unknown as { drill: { answers?: unknown } }).drill.answers;
  return { lesson, raw: JSON.stringify(state), state, artifactId: artifact.artifactId };
}

test("an old v4 record (full card snapshot, check without card) restores unchanged, stays closed, and opens through the same first answer", async () => {
  const { lesson, raw, artifactId } = await legacyRecord();
  assert.equal(isLessonState(JSON.parse(raw)), true);
  const restored = restoreLessonState(raw, lesson, 0);
  assert.equal(JSON.stringify(restored), raw, "restoring changes nothing in the record");
  const load = loadLessonRecord(key => key.endsWith("wonder-unit-0") ? raw : null, lesson, 0);
  assert.equal(load.ok, true);
  const artifact = projectLessonArtifacts(restored, lesson)[11];
  assert.equal(openedCardOf(artifact), null, "the snapshot's expression is never what opens a card");
  // The button: the same first answer is judged again and only the card is taken.
  const request = buildLessonCardRequest(restored, lesson, artifactId, "open-1");
  assert.equal(request.action, "check");
  assert.deepEqual(request.attempt, { kind: "fill", inputs: ["pick", "down"] });
  const response = await ok(request);
  const opened = acceptLessonCard(restored, request, response);
  assert.notEqual(opened, restored);
  assert.equal(isLessonState(opened), true);
  assert.equal(openedCardOf(opened.artifacts[0])?.expression, "pick up");
  assert.deepEqual(opened.events, restored.events, "opening a card writes no event");
  assert.equal(opened.artifacts[0].attempts[0].attempt.kind, "fill");
  assert.equal(JSON.stringify(opened.artifacts[0].attempts[0].check && { ...opened.artifacts[0].attempts[0].check, card: undefined }), JSON.stringify(restored.artifacts[0].attempts[0].check), "the stored judgement is otherwise untouched");
  assert.equal(JSON.stringify(restoreLessonState(JSON.stringify(opened), lesson, 0)), JSON.stringify(opened));
  // Once opened it cannot be opened again, and a second response changes nothing.
  assert.throws(() => buildLessonCardRequest(opened, lesson, artifactId, "open-2"), /이미 열린/);
  assert.equal(acceptLessonCard(opened, request, response), opened);
});

test("opening an old record's card refuses a response that does not belong to it", async () => {
  const { lesson, raw, artifactId } = await legacyRecord();
  const restored = restoreLessonState(raw, lesson, 0);
  const request = buildLessonCardRequest(restored, lesson, artifactId, "open-1");
  const response = await ok(request);
  assert.equal(acceptLessonCard(restored, { ...request, requestId: "other" }, response), restored);
  assert.equal(acceptLessonCard(restored, request, { ...response, artifactId: "q-other" } as LessonCheckResponse), restored);
  assert.equal(acceptLessonCard(restored, { ...request, attempt: { kind: "fill", inputs: ["pick", "up"] } }, response), restored);
  assert.equal(acceptLessonCard(restored, request, { ...response, matches: [false, false], allMatch: false } as LessonCheckResponse), restored, "a judgement that disagrees with the stored one is not adopted");
  if (response.kind === "fill") {
    const { card: _card, ...withoutCard } = response;
    assert.equal(acceptLessonCard(restored, request, withoutCard as LessonCheckResponse), restored, "a response without a card opens nothing");
  }
  // A card without a first answer, or one whose first answer was not judged, has nothing to open.
  const fresh = registerLessonArtifact(createLessonState(lesson), lesson, lesson.cards[0].questionId);
  assert.throws(() => buildLessonCardRequest(fresh, lesson, fresh.artifacts[0].artifactId, "open-3"));
  const unjudged = submitLessonAttempt(fresh, lesson, fresh.artifacts[0].artifactId, { kind: "fill", inputs: ["x"] });
  assert.throws(() => buildLessonCardRequest(unjudged, lesson, unjudged.artifacts[0].artifactId, "open-4"));
  // A record of another content version is read only: no card is opened for it.
  const old = restoreLessonState(raw.replaceAll(lesson.contentVersion, "e".repeat(64)), lesson, 0);
  assert.throws(() => buildLessonCardRequest(old, lesson, artifactId, "open-5"), /읽기만/);
});

test("a damaged card, an incomplete legacy snapshot or a stray key in the record isolates the record and keeps the original", async () => {
  const { lesson, accepted } = await answered(["pick", "down"]);
  const damage = (change: (record: any) => void) => { const copy = structuredClone(accepted) as any; change(copy); return JSON.stringify(copy); };
  const bad = [
    damage(record => { record.artifacts[0].attempts[0].check.card.extra = 1; }),
    damage(record => { record.artifacts[0].attempts[0].check.card.expression = 7; }),
    damage(record => { delete record.artifacts[0].attempts[0].check.card.sense; }),
    damage(record => { record.artifacts[0].attempts[0].check.card = "pick up"; }),
    damage(record => { record.artifacts[0].question.expression = "pick up"; }),
    damage(record => { record.artifacts[0].question.surprise = true; }),
    damage(record => { delete record.artifacts[0].question.meaning; }),
  ];
  for (const raw of bad) {
    assert.equal(isLessonState(JSON.parse(raw)), false);
    assert.throws(() => restoreLessonState(raw, lesson, 0), /읽지 못했습니다/);
    const load = loadLessonRecord(() => raw, lesson, 0);
    assert.equal(load.ok, false, "the record is isolated: the lesson reports it and the original text is left to the caller untouched");
  }
  // Text that no longer matches the closed snapshot of the current version is refused as before.
  const tampered = JSON.parse(JSON.stringify(accepted));
  tampered.artifacts[0].question.drill.sentence = "Changed ___ sentence ___.";
  assert.throws(() => restoreLessonState(JSON.stringify(tampered), lesson, 0), /맞지 않습니다/);
});

test("the notes of a card reach its sense, example and basis only after the card is open", async () => {
  const { lesson, accepted } = await answered(["pick", "down"]);
  const closedBlocks = cardBlocks(lesson, () => null), openBlocks = cardBlocks(lesson, id => { const saved = accepted.artifacts.find(item => item.question.questionId === id); return saved ? openedCardOf(saved) : null; });
  const pick = lesson.cards[11].questionId;
  assert.equal(`card-${pick}-sense` in closedBlocks, false);
  assert.equal(`card-${pick}-sense` in openBlocks, true);
  assert.equal(`card-${lesson.cards[0].questionId}-sense` in openBlocks, false, "only the answered card opened");
});

test("the AI context and the chat request contract do not change: the card's text is in the context once and the judgement keeps its old shape", async () => {
  const { lesson, request } = await answered(["pick", "down"]);
  const question = getServerLessonQuestion(lesson.lessonId, request.questionId);
  const judged = judge(question, request.attempt);
  assert.equal(judged.kind === "fill" && judged.card?.expression, "pick up", "the judgement itself carries the card");
  const context = lessonContext(question, judged) as Record<string, any>;
  assert.equal(context.serverJudgement.card, undefined);
  assert.deepEqual(context.serverJudgement, { kind: "fill", matches: [true, false], allMatch: false });
  assert.equal(context.card.expression, "pick up");
  const body = { lessonId: lesson.lessonId, questionId: request.questionId, contentVersion: lesson.contentVersion, artifactId: request.artifactId, requestId: "r-2", initialAttempt: request.attempt, revisions: [], messages: [], message: "질문" };
  assert.equal(isLessonChatRequest(body), true);
  assert.deepEqual(Object.keys(body).sort(), ["artifactId", "contentVersion", "initialAttempt", "lessonId", "message", "messages", "questionId", "requestId", "revisions"]);
});

test("'답 보기' still needs a first answer and shows the answers only", async () => {
  const { lesson, state, artifactId } = await answered(["pick", "down"]);
  const empty = registerLessonArtifact(createLessonState(lesson), lesson, lesson.cards[3].questionId);
  assert.throws(() => buildLessonRevealRequest(empty, lesson, empty.artifacts[0].artifactId, "reveal-0"));
  const request = buildLessonRevealRequest(state, lesson, artifactId, "reveal-1");
  const body = await ok(request);
  assert.equal(body.kind, "reveal");
  assert.equal(JSON.stringify(body).includes("pick up"), false);
});
