import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import prompt from "../lib/server/prompt.json";
import { ARTIFACT_LESSON_ID, LEARNING_QUESTION_IDS } from "../lib/learning-catalog";
import { learningChatLimits } from "../lib/learning-chat-contract";
import type { LessonChatRequest } from "../lib/lesson-chat-contract";
import { LESSONS } from "../lib/lesson-registry";
import type { ApiEnv } from "../lib/server/api";
import { getServerLearningQuestion } from "../lib/server/learning-catalog";
import { handleLearningChat } from "../lib/server/learning-chat";
import { getLessonContentVersion, getServerLessonQuestion } from "../lib/server/lesson-catalog";
import { lessonGuidance, lessonSystemPrompt } from "../lib/server/lesson-chat-context";
import { findHeadwords, findHeadwordsInMessage, namedHeadwords, SENSE_ENTRY_LIMIT, selectSenseHeadwords, senseEntry, senseHeadwords, senseSection } from "../lib/server/sense-entries";
import { storyExplainRequestMessage } from "../lib/story-lesson";

const STORY_MARK = "서버에서 조회한 현재 수업 자료:\n";
const reply = "이 장면에서는 이렇게 들립니다.";

function setup() {
  const providerRequests: RequestInit[] = [];
  const env: ApiEnv = {
    ANTHROPIC_API_KEY: "test-key-never-real",
    QUOTA_LIMITER: { idFromName: (name) => name, get: () => ({ fetch: async () => Response.json({ allowed: true }) }) },
  };
  const fetcher: typeof fetch = async (_url, init) => {
    providerRequests.push(init!);
    return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: reply }] });
  };
  return { env, providerRequests, fetcher };
}

function post(value: unknown): Request {
  return new Request("https://english.example/api/learn-chat/", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" }, body: JSON.stringify(value) });
}

const entryOf = (lessonId: string) => LESSONS.find(item => item.lessonId === lessonId)!;

async function ask(lessonId: string, questionId: string, attempt: LessonChatRequest["initialAttempt"], message = "이 표현은 어떤 감각인가요?") {
  const fixture = setup();
  const input: LessonChatRequest = { lessonId, questionId, contentVersion: await getLessonContentVersion(lessonId), artifactId: "artifact-1", requestId: "turn-1", initialAttempt: attempt, revisions: [], messages: [], message };
  const response = await handleLearningChat(post(input), fixture.env, { fetch: fixture.fetcher });
  return { response, fixture, system: fixture.providerRequests.length ? (JSON.parse(fixture.providerRequests[0].body as string).system[0].text as string) : "" };
}

const wrongAttemptOf = (lessonId: string, questionId: string): LessonChatRequest["initialAttempt"] => {
  const question = getServerLessonQuestion(lessonId, questionId);
  return question.kind === "story" ? { kind: "choose", choice: (question.question.answer + 1) % 4 } : { kind: "fill", inputs: question.card.drill.answers.map(() => "x") };
};

test("the dictionary has the 31 headwords of the explainer, each as its line in prompt.json", () => {
  const headwords = senseHeadwords();
  assert.equal(headwords.length, 31);
  const lines = prompt.rules.split("\n");
  for (const word of headwords) {
    const entry = senseEntry(word);
    assert.ok(entry && lines.includes(entry), word);
    assert.ok(entry.startsWith(`| ${word} |`), word);
  }
});

test("the system prompt carries the sense frame for stories and cards, and the have prompt does not change", async () => {
  for (const [lessonId, index] of [["bus-dog", 5], ["wonder-unit-0", 11]] as const) {
    const { system } = await ask(lessonId, entryOf(lessonId).questionIds[index], wrongAttemptOf(lessonId, entryOf(lessonId).questionIds[index]));
    assert.match(system, /일반 영어 학습 도구가 아닙니다/);
    assert.match(system, /영어다운 표현을 가려내고 스스로 고르게/);
    assert.match(system, /이미지는 무엇이 어디에 있고 어느 쪽으로 움직이고/);
    assert.match(system, /뉘앙스는 말의 무게와 거리와 일상·격식/);
    assert.match(system, /귀에 걸리지 않는 예와 걸리는 예/);
    assert.match(system, /"이 장면에는 어느 쪽인가"로 견줍니다/);
    assert.match(system, /덩어리로 익히라고/);
    assert.match(system, /게르만어는 감각을 보는 렌즈일 뿐/);
    assert.match(system, /역사나 어원을 강의하지 않고/);
    assert.match(system, /감각 사전에 아직 없는 표현입니다/);
    assert.match(system, /끼워 맞추지 않습니다/);
    assert.equal(/이름 붙이지 말고/.test(system), lessonId === "wonder-unit-0");
    assert.match(system, new RegExp(`${learningChatLimits.reply}자를 넘기지 않으며`));
    assert.ok(system.indexOf("일반 영어 학습 도구가 아닙니다") < system.indexOf(STORY_MARK));
  }
  assert.equal(learningChatLimits.reply, 6000);
});

test("the server picks headwords from the card, the sense question's basis and the expression question's card", () => {
  const card = getServerLessonQuestion("wonder-unit-0", "wonder-0-12");
  assert.deepEqual(selectSenseHeadwords(card), ["up"]);
  const out = getServerLessonQuestion("bus-dog", "bus-dog-sense-1");
  const forWord = getServerLessonQuestion("bus-dog", "bus-dog-sense-2");
  assert.deepEqual(selectSenseHeadwords(out), ["out"]);
  assert.deepEqual(selectSenseHeadwords(forWord), ["for"]);
  // 표현 문제는 짝 카드의 표현에서: "ended up"의 카드(wonder-0-19)는 end up
  const expression = getServerLessonQuestion("prep-wonder-0", "prep-wonder-0-expression-2");
  assert.deepEqual(selectSenseHeadwords(expression), ["up"]);
  assert.deepEqual(selectSenseHeadwords(getServerLessonQuestion("wonder-unit-0", "wonder-0-12"), ""), ["up"]);
});

test("a question without headwords selects none", () => {
  // 표제어가 아닌 말만 있는 카드("I guess")와 줄거리 문제, 근거가 '모델 밖'인 감각 문제
  const none = getServerLessonQuestion("wonder-unit-0", "wonder-0-07");
  assert.ok(none.kind === "cards" && none.card.expression === "I guess");
  assert.deepEqual(selectSenseHeadwords(none), []);
  assert.deepEqual(selectSenseHeadwords(getServerLessonQuestion("bus-dog", "bus-dog-content-1")), []);
  assert.deepEqual(selectSenseHeadwords(getServerLessonQuestion("green-umbrella", "green-umbrella-sense-2")), []);
  assert.deepEqual(namedHeadwords("모델 밖(작업자 판단). close는 표제어가 아니다"), []);
  assert.deepEqual(namedHeadwords("감각 사전 for, 보강 9.11"), ["for"]);
  assert.deepEqual(namedHeadwords("감각 사전 look, at"), ["look", "at"]);
  assert.equal(senseSection([]).includes("없음"), true);
});

test("headwords are at most three for every question and card, with or without a crowded message", () => {
  let withSome = 0;
  for (const entry of LESSONS) {
    if (entry.kind === "scene") continue;
    for (const questionId of entry.questionIds) {
      const question = getServerLessonQuestion(entry.lessonId, questionId);
      for (const message of ["", "왜 get, take, put, 'in'인가요? go out of it"]) {
        const picked = selectSenseHeadwords(question, message);
        assert.ok(picked.length <= SENSE_ENTRY_LIMIT, `${questionId}: ${picked}`);
        assert.equal(new Set(picked).size, picked.length);
        for (const word of picked) assert.ok(senseEntry(word), `${questionId} ${word}`);
      }
      if (selectSenseHeadwords(question).length > 0) withSome += 1;
    }
  }
  assert.ok(withSome > 20);
  // 표현에 표제어가 셋을 넘는 카드는 앞의 셋만 고른다
  const crowded = getServerLessonQuestion("wonder-unit-0", "wonder-0-11");
  assert.ok(crowded.kind === "cards" && crowded.card.expression === "look at / look up");
  assert.deepEqual(selectSenseHeadwords(crowded), ["look", "at", "up"]);
  assert.deepEqual(selectSenseHeadwords(crowded, "'get'은요?"), ["look", "at", "up"]);
});

test("the question's own words are found, with forms, and weak words only when named apart", () => {
  assert.deepEqual(findHeadwords("ran out of milk"), ["run", "out", "of"]);
  assert.deepEqual(findHeadwords("He Went and had it"), ["go", "have"]);
  assert.deepEqual(findHeadwords("picking up"), ["up"]);
  assert.deepEqual(findHeadwordsInMessage("왜 get이 아니라 take인가요?"), ["get", "take"]);
  assert.deepEqual(findHeadwordsInMessage("왜 on이 아니라 in인가요?"), ["on", "in"]);
  assert.deepEqual(findHeadwordsInMessage("What does 'at' show here?"), ["at"]);
  // 영어 문장 속의 to·in은 센다고 할 수 없다
  assert.deepEqual(findHeadwordsInMessage("I want to go to the store in a car"), ["go"]);
  assert.deepEqual(findHeadwordsInMessage("이 문장은 무슨 뜻인가요?"), []);
});

test("the AI context carries exactly the chosen dictionary lines and says which were chosen", async () => {
  const cases: [string, string, string][] = [["wonder-unit-0", "wonder-0-12", "up"], ["bus-dog", "bus-dog-sense-1", "out"], ["bus-dog", "bus-dog-sense-2", "for"]];
  for (const [lessonId, questionId, headword] of cases) {
    const { response, system } = await ask(lessonId, questionId, wrongAttemptOf(lessonId, questionId));
    assert.equal(response.status, 200);
    const section = system.split(STORY_MARK)[0];
    assert.ok(section.includes(`감각 사전에서 서버가 고른 표제어: ${headword}\n`), questionId);
    assert.ok(section.includes(senseEntry(headword)!), questionId);
    for (const other of senseHeadwords()) {
      if (other !== headword) assert.ok(!section.includes(senseEntry(other)!), `${questionId} has ${other}`);
    }
  }
  // 지금 질문이 부른 표제어도 서버가 사전에서 골라 넣는다
  const { system } = await ask("bus-dog", "bus-dog-sense-1", wrongAttemptOf("bus-dog", "bus-dog-sense-1"), "왜 off가 아니라 out인가요?");
  const section = system.split(STORY_MARK)[0];
  assert.ok(section.includes("고른 표제어: out, off\n"));
  assert.ok(section.includes(senseEntry("out")!) && section.includes(senseEntry("off")!) && !section.includes(senseEntry("over")!));
});

test("an expression missing from the dictionary is said to be missing, not explained by invented senses", async () => {
  const { response, system } = await ask("wonder-unit-0", "wonder-0-07", wrongAttemptOf("wonder-unit-0", "wonder-0-07"));
  assert.equal(response.status, 200);
  const section = system.split(STORY_MARK)[0];
  assert.match(section, /감각 사전에서 서버가 고른 표제어: 없음 \(이 표현은 감각 사전에 아직 없습니다\)/);
  for (const word of senseHeadwords()) assert.ok(!section.includes(senseEntry(word)!), word);
  assert.match(section, /"감각 사전에 아직 없는 표현입니다"라고 밝히고 뜻과 쓰임만 짧게 말합니다/);
  assert.match(section, /사전에 없는 감각을 지어내지 않고/);
});

test("before a first answer no model is called and neither the selection nor the section holds answer information (105 questions, 195 cards)", async () => {
  const fixture = setup();
  let count = 0;
  for (const entry of LESSONS) {
    if (entry.kind === "scene") continue;
    for (const questionId of entry.questionIds) {
      count += 1;
      const question = getServerLessonQuestion(entry.lessonId, questionId);
      const input: LessonChatRequest = { lessonId: entry.lessonId, questionId, contentVersion: await getLessonContentVersion(entry.lessonId), artifactId: "artifact-1", requestId: "turn-1", initialAttempt: null, revisions: [], messages: [], message: "get out of up" };
      const response = await handleLearningChat(post(input), fixture.env, { fetch: fixture.fetcher });
      const output = await response.json() as { mode: string; reply: string };
      assert.equal(output.mode, "guidance", questionId);
      assert.equal(output.reply, lessonGuidance(entry.kind), questionId);
      // 안내와 감각 구간에는 정본의 해설·근거·빈칸 답·정답 보기 문장이 없다
      const section = senseSection(selectSenseHeadwords(question, "get out of up"));
      const secrets = question.kind === "story" ? [question.question.explain, question.question.options[question.question.answer], ...(question.question.basis ? [question.question.basis] : [])] : [question.card.sense, question.card.drill.hint];
      for (const secret of secrets) assert.ok(!section.includes(secret) && !output.reply.includes(secret), `${questionId} leaks`);
      // 감각 구간은 표제목 한 줄, 표 머리와 구분선, 고른 사전 줄로만 이루어진다
      const allowed = new Set(["| 표제어 | 이미지 | 뉘앙스 | 예시 |", "| --- | --- | --- | --- |", ...senseHeadwords().map(word => senseEntry(word)!)]);
      for (const line of section.split("\n").slice(1)) assert.ok(allowed.has(line), `${questionId}: ${line}`);
    }
  }
  assert.equal(count, 300);
  assert.equal(fixture.providerRequests.length, 0);
});

test("the story explain request still reaches a prompt that asks for letters and sense words together", async () => {
  const { response, system } = await ask("bus-dog", "bus-dog-sense-1", { kind: "choose", choice: 2 }, storyExplainRequestMessage);
  assert.equal(response.status, 200);
  assert.deepEqual(findHeadwordsInMessage(storyExplainRequestMessage), []);
  assert.match(system, /labeledOptions/);
  assert.match(system, /감각의 말로 설명합니다/);
  assert.match(system, /정답이나 해설을 설명해 달라는 요청에도 이 틀로 답합니다/);
});

test("have requests are byte-identical to before this change", async () => {
  const bodies: string[] = [];
  const env: ApiEnv = { ANTHROPIC_API_KEY: "k", QUOTA_LIMITER: { idFromName: (name) => name, get: () => ({ fetch: async () => Response.json({ allowed: true }) }) } };
  const fetcher: typeof fetch = async (_url, init) => { bodies.push(init!.body as string); return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }); };
  const base = { requestId: "turn-1", revisions: [{ text: "r" }], messages: [{ role: "user", content: "q" }], message: "질문입니다 get out of in" };
  await handleLearningChat(post({ lessonId: "titanic-have-1", ...base, initialAttempt: { choice: 0, reason: "r" } }), env, { fetch: fetcher });
  for (const id of LEARNING_QUESTION_IDS) {
    const target = await getServerLearningQuestion(id);
    const attempt = target.question.type === "produce" ? { kind: "produce", text: "He has red hair.", reason: "r" } : { kind: "choose", choice: 0, reason: "r" };
    await handleLearningChat(post({ lessonId: ARTIFACT_LESSON_ID, questionId: id, contentVersion: target.contentVersion, artifactId: "a-1", ...base, initialAttempt: attempt }), env, { fetch: fetcher });
  }
  assert.equal(bodies.length, 8);
  // 이 변경 전(main 545e205)에 같은 입력으로 얻은 본문 8개의 SHA-256
  assert.equal(createHash("sha256").update(bodies.join("\n")).digest("hex"), "ab01b90a30a89aa713e9c12ff83534845ed2f0b7aedbb2159a5f4bcb0b47446e");
  for (const body of bodies) assert.ok(!body.includes("일반 영어 학습 도구가 아닙니다") && !body.includes("서버가 고른 표제어"));
});

test("lessonSystemPrompt keeps the cache_control request shape and puts the dictionary before the lesson JSON", async () => {
  const { fixture, system } = await ask("wonder-unit-0", "wonder-0-12", wrongAttemptOf("wonder-unit-0", "wonder-0-12"));
  const body = JSON.parse(fixture.providerRequests[0].body as string);
  assert.equal(body.system.length, 1);
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
  assert.equal(body.max_tokens, 2000);
  assert.equal(system, lessonSystemPrompt("cards", JSON.parse(system.split(STORY_MARK)[1]), ["up"]));
  assert.ok(system.indexOf("고른 표제어") < system.indexOf(STORY_MARK));
});
