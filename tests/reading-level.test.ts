import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoryRecordNote } from "../components/story-record-note";
import { createLessonState, endReading, startReading, submitLessonAttempt, acceptLessonCheck, buildLessonCheckRequest, registerLessonArtifact, type LessonDocument } from "../lib/lesson-workspace-state";
import { defaultReadingLevel, levelLimitSeconds, readStoredReading, readingFactsLine, readingLevels, storedReadingText, wordsPerMinuteLabel } from "../lib/reading-level";
import { getPublicLesson } from "../lib/server/lesson-catalog";
import { handleLessonCheck } from "../lib/server/lesson-check";
import { getStudySource } from "../lib/server/study-source";

const T0 = 1_800_000_000_000;
const { reading } = getStudySource();

test("the limit is words ÷ pace × 60 seconds rounded up to 10 seconds, for all 15 stories at all three levels", () => {
  assert.deepEqual(readingLevels.map(level => [level.id, level.wordsPerMinute]), [["relaxed", 100], ["normal", 125], ["fast", 150]]);
  assert.equal(defaultReadingLevel, "normal");
  // 433 words is the worked example of the request: 4:20 / 3:30 / 3:00.
  assert.deepEqual(readingLevels.map(level => levelLimitSeconds(433, level.id)), [260, 210, 180]);
  assert.deepEqual(readingLevels.map(level => levelLimitSeconds(438, level.id)), [270, 220, 180]);
  assert.equal(levelLimitSeconds(500, "normal"), 240, "an exact result is not rounded up again");
  assert.equal(levelLimitSeconds(1, "fast"), 10);
  for (const story of reading.stories) for (const level of readingLevels) {
    const seconds = levelLimitSeconds(story.words, level.id);
    assert.ok(seconds % 10 === 0 && seconds >= story.words / level.wordsPerMinute * 60 && seconds < story.words / level.wordsPerMinute * 60 + 10, `${story.id} ${level.id}`);
  }
  for (const story of reading.stories) assert.ok(levelLimitSeconds(story.words, "relaxed") > levelLimitSeconds(story.words, "normal") && levelLimitSeconds(story.words, "normal") > levelLimitSeconds(story.words, "fast") - 1, story.id);
});

test("the facts line states level, time, pace and how it ended, and leaves out what is not known", () => {
  assert.equal(readingFactsLine({ level: "normal", readMs: 192_000, by: "user", words: 438 }), "수준 보통 · 읽은 시간 3:12 · 분당 약 137낱말 · 직접 끝냄");
  assert.equal(readingFactsLine({ level: "relaxed", readMs: 270_000, by: "time", words: 438 }), "수준 여유 있게 · 읽은 시간 4:30 · 분당 약 97낱말 · 시간 마감");
  assert.equal(readingFactsLine({ readMs: 180_000, by: "user", words: 438 }), "읽은 시간 3:00 · 분당 약 146낱말 · 직접 끝냄", "a record from before levels has no level to state");
  assert.equal(readingFactsLine({ level: "fast", readMs: 0, by: "user", words: 438 }), "수준 빠르게 · 읽은 시간 0:00 · 직접 끝냄", "no pace without a time");
  assert.equal(readingFactsLine({ level: "fast", readMs: 180_000, by: "time", words: 438 }, false), "수준 빠르게 · 읽은 시간 3:00 · 분당 약 146낱말");
  assert.equal(wordsPerMinuteLabel(438, 0), null);
  const text = readingFactsLine({ level: "normal", readMs: 192_000, by: "user", words: 438 });
  assert.ok(!/숙달|완료|진행률|점수|정답률|달성|%/.test(text));
});

async function judgedRecord(first: number) {
  const doc = (await getPublicLesson("green-umbrella")) as LessonDocument;
  assert.ok(doc.kind === "story");
  let state = endReading(startReading(createLessonState(doc), doc, T0, "relaxed"), T0 + 200_000);
  state = registerLessonArtifact(state, doc, doc.questions[0].questionId);
  const id = state.artifacts[0].artifactId;
  state = submitLessonAttempt(state, doc, id, { kind: "choose", choice: first });
  const request = buildLessonCheckRequest(state, doc, id, "check-1");
  const response = await handleLessonCheck(new Request("https://english.example/api/lesson-check/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
  state = acceptLessonCheck(state, request, await response.json());
  return { doc, state };
}

test("a list reads this browser's record of a story: level, time, pace and the count of first answers equal to the canonical one", async () => {
  const { doc, state } = await judgedRecord(0);
  const judged = state.artifacts[0].attempts[0].check;
  assert.ok(judged?.kind === "choose");
  const text = storedReadingText(readStoredReading(JSON.stringify(state), doc.lessonId, doc.words, T0 + 999_999));
  assert.equal(text, `이 브라우저의 기록 · 수준 여유 있게 · 읽은 시간 3:20 · 분당 약 ${Math.round(doc.words / (200 / 60))}낱말 · 정본과 같은 첫 답 ${judged.match ? 1 : 0}개`);
  assert.ok(!/숙달|완료|진행률|점수|정답률|달성|%|\d\s*\/\s*\d/.test(text!));
  // before any first answer only the reading is stated
  const noAnswer = { ...state, artifacts: [] };
  assert.equal(storedReadingText(readStoredReading(JSON.stringify(noAnswer), doc.lessonId, doc.words, T0 + 999_999)), `이 브라우저의 기록 · 수준 여유 있게 · 읽은 시간 3:20 · 분당 약 ${Math.round(doc.words / (200 / 60))}낱말`);
});

test("a list shows nothing for no record, a damaged record, another lesson's record, an unfinished reading or an unreadable store", async () => {
  const { doc, state } = await judgedRecord(1);
  const read = (raw: string | null, now = T0 + 999_999) => readStoredReading(raw, doc.lessonId, doc.words, now);
  assert.equal(read(null), null);
  for (const raw of ["", "{broken", "null", "[]", "1", '{"version":4}', JSON.stringify({ ...state, version: 3 }), JSON.stringify({ ...state, lessonId: "bus-dog" }), JSON.stringify({ ...state, events: "x" }), JSON.stringify({ ...state, artifacts: {} }), JSON.stringify({ ...state, events: [{ kind: "reading-start", startedAt: "x", limitSeconds: 1 }] }), JSON.stringify({ ...state, events: state.events.map(event => event.kind === "reading-end" ? { ...event, endedAt: -5 } : event) })]) assert.equal(read(raw), null, raw);
  // reading started, not ended, deadline not yet reached: nothing; deadline passed without an end event: ended by time
  const started = { ...state, events: state.events.filter(event => event.kind === "reading-start"), artifacts: [] };
  assert.equal(read(JSON.stringify(started), T0 + 1000), null);
  assert.match(storedReadingText(read(JSON.stringify(started), T0 + 10_000_000))!, /읽은 시간 4:30 /);
  // damaged parts inside artifacts do not throw and are not counted
  const damaged = JSON.parse(JSON.stringify(state)); damaged.artifacts = [null, 5, { attempts: "x" }, { attempts: [null] }, { attempts: [{ check: { kind: "choose", match: "yes" } }] }];
  assert.equal(storedReadingText(read(JSON.stringify(damaged))), `이 브라우저의 기록 · 수준 여유 있게 · 읽은 시간 3:20 · 분당 약 ${Math.round(doc.words / (200 / 60))}낱말 · 정본과 같은 첫 답 0개`);
  // an unknown level is not stated
  const odd = JSON.parse(JSON.stringify(state)); odd.events[0].level = "turbo";
  assert.ok(!storedReadingText(read(JSON.stringify(odd)))!.includes("수준"));
});

test("the list island draws nothing in the prerendered page", () => {
  assert.equal(renderToStaticMarkup(createElement(StoryRecordNote, { storyId: "green-umbrella", words: 438 })), "");
});
