import assert from "node:assert/strict";
import { test } from "node:test";
import { askFollowupLimits, type Explanation } from "../lib/ask-contract";
import {
  appendAskEntry, appendAskTurn, askHistoryWindow, completeAskEntry, completeAskTurn, createAskEntry, createAskRecords, createAskTurn,
  failAskEntry, failAskTurn, interruptAskRequest, restoreAskRecords, selectAskEntry, serializeAskRecords, setAskComposer, setAskFollowupDraft,
  validateAskRecords, type AskRecords,
} from "../lib/ask-records";

const at = (n = 0) => new Date(Date.UTC(2026, 9, 28, 0, 0, n)).toISOString();
const explanation = (): Explanation => ({ english: "I get it.", korean: "이해합니다.", picture: "뜻을 잡습니다.", headwords: [{ word: "get", in_sentence: "get it", image: "잡습니다.", nuance: "이해합니다." }], contrasts: [{ kind: "영어식", text: "I get it.", note: "뜻을 잡습니다." }], alternatives: ["I see."], note: "" });
const entry = (id: string, retryOf?: string) => createAskEntry({ id, mode: "explain", text: " I get it.\n", createdAt: at(), ...(retryOf ? { retryOf } : {}) });
const completed = () => completeAskEntry(appendAskEntry(createAskRecords(), entry("entry-1")), "entry-1", explanation(), at(1));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function respond(state: AskRecords, n: number, message = `Question ${n}`, reply = `Reply ${n}`) {
  const pending = appendAskTurn(state, "entry-1", createAskTurn({ id: `turn-${n}`, message, createdAt: at(2) }));
  return completeAskTurn(pending, "entry-1", `turn-${n}`, reply, at(3));
}

test("real submission creates a record, late results stay with their request and JSON keeps originals and drafts", () => {
  const empty = createAskRecords();
  assert.deepEqual(empty.entries, [], "sample explanations are never inserted into the archive");
  let state = setAskComposer(empty, { mode: "translate", text: " 작성 중인 문장\n" });
  state = appendAskEntry(state, entry("entry-1"));
  const pending = state;
  state = appendAskEntry(state, createAskEntry({ id: "entry-2", mode: "translate", text: "안녕하세요.", createdAt: at(1) }));
  const result = explanation();
  state = completeAskEntry(state, "entry-1", result, at(2));
  result.headwords[0].word = "changed externally";
  assert.equal(state.entries[0].result!.headwords[0].word, "get", "the result is a snapshot");
  assert.equal(state.selectedId, "entry-2", "a late result never changes selection");
  assert.equal(pending.entries[0].status, "pending", "reducers never edit earlier state");
  state = setAskFollowupDraft(state, "entry-1", " 이 뜻을 설명해 주십시오.\n");
  state = appendAskTurn(state, "entry-1", createAskTurn({ id: "turn-1", message: " 왜 get입니까?\n", createdAt: at(3) }));
  state = selectAskEntry(state, "entry-2");
  state = completeAskTurn(state, "entry-1", "turn-1", " 잡는 감각입니다.\n", at(4));
  state = failAskEntry(state, "entry-2", " 공급자 실패 원문\n", at(5));
  const raw = serializeAskRecords(state), restored = restoreAskRecords(raw);
  assert.deepEqual(restored, state);
  assert.equal(serializeAskRecords(restored), raw);
  assert.equal(restored.entries[0].text, " I get it.\n");
  assert.equal(restored.entries[0].followupDraft, " 이 뜻을 설명해 주십시오.\n");
  assert.equal(restored.entries[0].turns[0].reply, " 잡는 감각입니다.\n");
  assert.equal(restored.entries[1].error, " 공급자 실패 원문\n");
  assert.deepEqual(restored.composer, { mode: "translate", text: " 작성 중인 문장\n" });
});

test("pending restores as unknown without replay, and entry retries append new identities without erasing failure", () => {
  const pending = appendAskEntry(createAskRecords(), entry("entry-1"));
  let state = restoreAskRecords(serializeAskRecords(pending));
  assert.equal(state.entries[0].status, "unknown");
  assert.equal(pending.entries[0].status, "pending");
  assert.equal(completeAskEntry(state, "entry-1", explanation(), at(2)), state, "an old response cannot complete a restored unknown execution");
  state = appendAskEntry(state, entry("retry-1", "entry-1"));
  state = failAskEntry(state, "retry-1", "첫 재시도 실패", at(2));
  state = appendAskEntry(state, entry("retry-2", "retry-1"));
  state = completeAskEntry(state, "retry-2", explanation(), at(3));
  assert.deepEqual(state.entries.map(item => [item.id, item.status, item.retryOf]), [["entry-1", "unknown", undefined], ["retry-1", "failed", "entry-1"], ["retry-2", "succeeded", "retry-1"]]);
  assert.equal(state.entries[1].error, "첫 재시도 실패");
  assert.equal(failAskEntry(state, "retry-2", "늦은 실패", at(4)), state);
  assert.equal(completeAskEntry(state, "missing", explanation(), at(4)), state);
});

test("leaving an in-flight request makes only that receipt unknown and rejects late completion", () => {
  const pending = appendAskEntry(appendAskEntry(createAskRecords(), entry("entry-1")), entry("entry-2"));
  const left = interruptAskRequest(pending, "entry-1", "entry-1");
  assert.deepEqual(left.entries.map(item => item.status), ["unknown", "pending"]);
  assert.equal(left.selectedId, "entry-2");
  assert.equal(completeAskEntry(left, "entry-1", explanation(), at(2)), left);
  let state = appendAskTurn(completed(), "entry-1", createAskTurn({ id: "turn-1", message: "중단할 질문", createdAt: at(2) }));
  state = setAskFollowupDraft(state, "entry-1", "남길 질문 초안");
  state = interruptAskRequest(state, "entry-1", "turn-1");
  assert.equal(state.entries[0].status, "succeeded");
  assert.equal(state.entries[0].followupDraft, "남길 질문 초안");
  assert.equal(state.entries[0].turns[0].status, "unknown");
  assert.equal(completeAskTurn(state, "entry-1", "turn-1", "늦은 응답", at(3)), state);
  assert.equal(interruptAskRequest(state, "entry-1", "turn-1"), state);
  assert.deepEqual(restoreAskRecords(serializeAskRecords(state)), state);
});

test("a pending follow-up restores as unknown and its retry preserves the earlier message and outcome", () => {
  let state = appendAskTurn(completed(), "entry-1", createAskTurn({ id: "turn-1", message: "왜 그렇습니까?", createdAt: at(2) }));
  state = restoreAskRecords(serializeAskRecords(state));
  assert.equal(state.entries[0].turns[0].status, "unknown");
  assert.equal(completeAskTurn(state, "entry-1", "turn-1", "늦은 응답", at(3)), state);
  state = appendAskTurn(state, "entry-1", createAskTurn({ id: "retry-1", message: "왜 그렇습니까?", createdAt: at(3), retryOf: "turn-1" }));
  state = failAskTurn(state, "entry-1", "retry-1", "재시도 실패", at(4));
  state = appendAskTurn(state, "entry-1", createAskTurn({ id: "retry-2", message: "왜 그렇습니까?", createdAt: at(4), retryOf: "retry-1" }));
  state = completeAskTurn(state, "entry-1", "retry-2", "새 응답", at(5));
  assert.deepEqual(state.entries[0].turns.map(turn => [turn.id, turn.status, turn.retryOf]), [["turn-1", "unknown", undefined], ["retry-1", "failed", "turn-1"], ["retry-2", "succeeded", "retry-1"]]);
  assert.equal(state.entries[0].turns[1].error, "재시도 실패");
  assert.deepEqual(askHistoryWindow(state.entries[0]), { messages: [{ role: "user", content: "왜 그렇습니까?" }, { role: "assistant", content: "새 응답" }], droppedCount: 0 });
});

test("selection and drafts are independent facts; invalid or concurrent submissions are refused", () => {
  let state = completed();
  const initial = createAskEntry({ id: "initial", mode: "explain", text: "A sentence.", createdAt: at(), retryOf: undefined });
  assert.equal(Object.hasOwn(initial, "retryOf"), false);
  assert.equal(appendAskEntry(createAskRecords(), initial).entries.length, 1);
  assert.equal(Object.hasOwn(createAskTurn({ id: "initial-turn", message: "질문", createdAt: at(), retryOf: undefined }), "retryOf"), false);
  const original = serializeAskRecords(state);
  assert.equal(selectAskEntry(state, "entry-1"), state);
  assert.equal(selectAskEntry(state, null).entries, state.entries);
  assert.equal(serializeAskRecords(state), original);
  assert.throws(() => selectAskEntry(state, "missing"));
  assert.throws(() => appendAskEntry(state, entry("entry-1")));
  assert.throws(() => appendAskEntry(state, entry("retry", "entry-1")), "successful requests are not failure retries");
  const pending = appendAskEntry(state, entry("entry-2"));
  assert.throws(() => setAskFollowupDraft(pending, "entry-2", "no explanation yet"));
  assert.throws(() => appendAskTurn(pending, "entry-2", createAskTurn({ id: "turn-2", message: "질문", createdAt: at(2) })));
  state = appendAskTurn(state, "entry-1", createAskTurn({ id: "turn-1", message: "질문", createdAt: at(2) }));
  assert.throws(() => appendAskTurn(state, "entry-1", createAskTurn({ id: "turn-2", message: "둘째 동시 질문", createdAt: at(3) })));
  assert.equal(completeAskTurn(state, "missing", "turn-1", "응답", at(3)), state);
  assert.equal(completeAskTurn(state, "entry-1", "missing", "응답", at(3)), state);
});

test("restoration rejects duplicate identities, missing or impossible states, corrupt dates, fields and snapshots", () => {
  const valid = completed();
  const corruptions: ((state: any) => void)[] = [
    state => { state.schema = 2; }, state => { state.selectedId = "missing"; }, state => { state.extra = true; },
    state => { state.entries.push(clone(state.entries[0])); }, state => { state.entries[0].status = "pending"; },
    state => { state.entries[0].createdAt = "2026-02-30T00:00:00.000Z"; }, state => { state.entries[0].createdAt = "not-a-date"; },
    state => { state.entries[0].finishedAt = "2025-10-28T00:00:00.000Z"; }, state => { delete state.entries[0].result; },
    state => { state.entries[0].result.headwords[0].word = 3; }, state => { state.entries[0].result.extra = "unrecognized"; },
    state => { state.entries[0].result.picture = "x".repeat(askFollowupLimits.explanationBytes); },
    state => { state.entries[0].status = "failed"; delete state.entries[0].result; },
    state => { state.entries[0].turns.push({ id: "entry-1", message: "질문", createdAt: at(2), status: "pending" }); },
    state => { state.entries[0].turns.push({ id: "turn", message: "질문", createdAt: at(2), status: "succeeded", finishedAt: at(3) }); },
    state => { state.entries[0].followupDraft = "x".repeat(2001); }, state => { state.composer.text = "x".repeat(301); },
  ];
  for (const corrupt of corruptions) {
    const state = clone(valid); corrupt(state);
    const raw = JSON.stringify(state);
    assert.throws(() => restoreAskRecords(raw));
    assert.equal(JSON.stringify(state), raw, "a rejected record remains available as its original data");
  }
  assert.throws(() => restoreAskRecords("{unfinished"));
  assert.throws(() => createAskEntry({ id: "a", mode: "explain", text: " ", createdAt: at() }));
  assert.throws(() => createAskTurn({ id: "a", message: "x".repeat(2001), createdAt: at() }));
  assert.throws(() => createAskTurn({ id: "a", message: "질문", createdAt: "2026-10-28" }));
});

test("history sends at most the newest ten successful pairs while the full archive and unsuccessful attempts remain", () => {
  let state = completed();
  for (let i = 0; i < 12; i++) state = respond(state, i);
  state = appendAskTurn(state, "entry-1", createAskTurn({ id: "failed", message: "실패한 질문", createdAt: at(4) }));
  state = failAskTurn(state, "entry-1", "failed", "실패", at(5));
  const before = serializeAskRecords(state), window = askHistoryWindow(state.entries[0]);
  assert.equal(window.messages.length, 20);
  assert.deepEqual(window.messages[0], { role: "user", content: "Question 2" });
  assert.equal(window.droppedCount, 2);
  assert.equal(state.entries[0].turns.length, 13);
  assert.equal(serializeAskRecords(state), before, "context truncation never prunes stored turns");
});

test("history uses Unicode character and message budgets together, keeping complete chronological pairs", () => {
  let state = completed();
  for (let i = 0; i < 3; i++) state = respond(state, i, "😀".repeat(2000), "답".repeat(6000));
  const window = askHistoryWindow(state.entries[0]);
  assert.equal(window.messages.length, 4);
  assert.equal(window.droppedCount, 1);
  assert.equal(window.messages.reduce((sum, item) => sum + [...item.content].length, 0), 16000);
  assert.deepEqual(window.messages.map(item => item.role), ["user", "assistant", "user", "assistant"]);
  validateAskRecords(state);
  assert.equal(restoreAskRecords(serializeAskRecords(state)).entries[0].turns.length, 3);
});
