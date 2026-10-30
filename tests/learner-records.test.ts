import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { appendAskEntry, completeAskEntry, createAskEntry, createAskRecords, setAskComposer } from "../lib/ask-records";
import { ARTIFACT_LESSON_ID } from "../lib/learning-catalog";
import { addRevision, beginTurn, createWorkspace, submitInitial, updateArtifact } from "../lib/learning-workspace-state";
import {
  ASK_CONTENT_VERSION,
  ASK_RECORD_SCOPE,
  HAVE_CANONICAL_PROBLEM_IDS,
  resolveCanonicalProblemId,
  type LearnerRecordCommand,
  type ScopeRecordEnvelope,
} from "../lib/learner-record-contract";
import {
  acceptLessonCheck,
  buildLessonCheckRequest,
  createLessonState,
  endReading,
  registerLessonArtifact,
  startReading,
  submitLessonAttempt,
  type LessonDocument,
} from "../lib/lesson-workspace-state";
import { BundleVerificationError, type WebProcessBundle } from "../lib/process-bundle";
import { clearAccessJwksCache } from "../lib/server/access-auth";
import { getPublicLearningCatalog } from "../lib/server/learning-catalog";
import { handleLearningChat } from "../lib/server/learning-chat";
import {
  handleLearnerRecordAck,
  handleLearnerRecordExecutions,
  handleLearnerRecordExport,
  handleLearnerRecords,
  LearnerRecordStore,
  type LearnerRecordEnv,
  type LearnerRecordNamespace,
} from "../lib/server/learner-records";
import { getPublicLesson } from "../lib/server/lesson-catalog";
import { handleLessonCheck } from "../lib/server/lesson-check";
import { DailyQuota } from "../lib/server/quota";
import { importBundleToStudyDirectory, readExistingCanonicalFiles } from "../scripts/sync-study-records";

function encodeBase64Url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function generateTestKeyPair(kid = "test-key-1") {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey & { kid?: string };
  publicJwk.kid = kid;
  return { privateKey: pair.privateKey, publicJwk, kid };
}

async function signAccessJwt(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", typ: "JWT", kid: "test-key-1" },
): Promise<string> {
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(claims));
  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const sigBuffer = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, signingInput);
  return `${encodedHeader}.${encodedPayload}.${encodeBase64Url(new Uint8Array(sigBuffer))}`;
}

class SqliteRecordHarness {
  readonly db = new DatabaseSync(":memory:");
  readonly store: LearnerRecordStore;

  constructor() {
    this.store = new LearnerRecordStore({
      storage: {
        sql: {
          exec: (query: string, ...bindings: unknown[]) => {
            const normalized = query.trim().toUpperCase();
            if (normalized.startsWith("SELECT")) {
              const statement = this.db.prepare(query);
              return { toArray: () => statement.all(...(bindings as never[])) as Record<string, unknown>[] };
            }
            if (!bindings.length) {
              this.db.exec(query);
              return { toArray: () => [] };
            }
            const statement = this.db.prepare(query);
            statement.run(...(bindings as never[]));
            return { toArray: () => [] };
          },
        },
        transactionSync: <T>(closure: () => T): T => {
          this.db.exec("BEGIN IMMEDIATE");
          try {
            const out = closure();
            this.db.exec("COMMIT");
            return out;
          } catch (err) {
            this.db.exec("ROLLBACK");
            throw err;
          }
        },
      },
    });
  }

  close() {
    this.db.close();
  }
}

function createRecordNamespace(): {
  namespace: LearnerRecordNamespace;
  harnesses: Map<string, SqliteRecordHarness>;
  closeAll: () => void;
} {
  const harnesses = new Map<string, SqliteRecordHarness>();
  const namespace: LearnerRecordNamespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => {
      const key = String(id);
      let harness = harnesses.get(key);
      if (!harness) {
        harness = new SqliteRecordHarness();
        harnesses.set(key, harness);
      }
      return { fetch: (req: Request) => harness!.store.fetch(req) };
    },
  };
  return {
    namespace,
    harnesses,
    closeAll: () => {
      for (const h of harnesses.values()) h.close();
      harnesses.clear();
    },
  };
}

const NOW_SECONDS = Math.floor(Date.parse("2026-10-30T02:00:00.000Z") / 1000);
const NOW_DATE = () => new Date(NOW_SECONDS * 1000);

test("canonical problem ID mapping maps all 7 titanic-have questions to study-and-learn IDs and keeps unmapped IDs intact", () => {
  assert.deepEqual(HAVE_CANONICAL_PROBLEM_IDS, {
    "titanic-have-1": "have-1-choose-1",
    "titanic-have-2": "have-1-choose-2",
    "titanic-have-3": "have-1-choose-3",
    "titanic-have-4": "have-1-retrieve-1",
    "titanic-have-5": "have-1-retrieve-2",
    "titanic-have-6": "have-1-produce-1",
    "titanic-have-7": "have-1-produce-2",
  });
  assert.deepEqual(resolveCanonicalProblemId("titanic-have", "titanic-have-4"), {
    canonicalProblemId: "have-1-retrieve-1",
    mapped: true,
  });
  assert.deepEqual(resolveCanonicalProblemId("green-umbrella", "green-umbrella-content-1"), {
    canonicalProblemId: "green-umbrella-content-1",
    mapped: true,
  });
  assert.deepEqual(resolveCanonicalProblemId("titanic-have", "future-unmapped-question"), {
    canonicalProblemId: "future-unmapped-question",
    mapped: false,
  });
});

test("owner-access rejects unauthenticated, wrong-owner, expired, wrong-aud, wrong-iss, cross-origin, and disallowed-host requests", async () => {
  clearAccessJwksCache();
  const { privateKey, publicJwk } = await generateTestKeyPair();
  const otherKey = await generateTestKeyPair("other-kid");
  const { namespace, closeAll } = createRecordNamespace();
  try {
    const env: LearnerRecordEnv = {
      LEARNER_RECORDS: namespace,
      CF_ACCESS_TEAM_DOMAIN: "https://kangpd.cloudflareaccess.com",
      CF_ACCESS_AUD: "english-sense-aud-123",
      CF_ACCESS_ALLOWED_EMAILS: "jaeyoung2010@gmail.com",
      CF_ACCESS_OWNER_ID: "learner-jaeyoung",
      CF_ACCESS_ALLOWED_HOSTS: "english.artificialmind.kr",
      CF_ACCESS_PUBLIC_KEY_JWK: JSON.stringify({ keys: [publicJwk] }),
    };
    const deps = { now: NOW_DATE, allowInlineJwk: true };

    // 1. Missing token -> 401 unauthenticated (even if forged email header is sent!)
    const unauthRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/?scope=titanic-have", {
        headers: { "Cf-Access-Authenticated-User-Email": "jaeyoung2010@gmail.com" },
      }),
      env,
      deps,
    );
    assert.equal(unauthRes.status, 401);
    assert.equal((await unauthRes.json() as { code: string }).code, "unauthenticated");

    // 2. Disallowed host (e.g. workers.dev preview) -> 403 host_forbidden
    const validToken = await signAccessJwt(privateKey, {
      iss: "https://kangpd.cloudflareaccess.com",
      aud: "english-sense-aud-123",
      sub: "user-sub-1",
      email: "jaeyoung2010@gmail.com",
      exp: NOW_SECONDS + 3600,
      iat: NOW_SECONDS - 10,
    });
    const badHostRes = await handleLearnerRecords(
      new Request("https://english-sense.preview.workers.dev/api/learner-records/?scope=titanic-have", {
        headers: { "Cf-Access-Jwt-Assertion": validToken },
      }),
      env,
      deps,
    );
    assert.equal(badHostRes.status, 403);
    assert.equal((await badHostRes.json() as { code: string }).code, "host_forbidden");

    // 3. Disallowed Origin -> 403 origin_forbidden
    const badOriginRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/?scope=titanic-have", {
        headers: { "Cf-Access-Jwt-Assertion": validToken, Origin: "https://evil.example" },
      }),
      env,
      deps,
    );
    assert.equal(badOriginRes.status, 403);
    assert.equal((await badOriginRes.json() as { code: string }).code, "origin_forbidden");

    // 4. Wrong user email -> 403 forbidden_user
    const otherUserToken = await signAccessJwt(privateKey, {
      iss: "https://kangpd.cloudflareaccess.com",
      aud: "english-sense-aud-123",
      sub: "user-sub-2",
      email: "intruder@example.com",
      exp: NOW_SECONDS + 3600,
    });
    const wrongUserRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/?scope=titanic-have", {
        headers: { "Cf-Access-Jwt-Assertion": otherUserToken },
      }),
      env,
      deps,
    );
    assert.equal(wrongUserRes.status, 403);
    assert.equal((await wrongUserRes.json() as { code: string }).code, "forbidden_user");

    // 5. Expired token -> 401 invalid_token
    const expiredToken = await signAccessJwt(privateKey, {
      iss: "https://kangpd.cloudflareaccess.com",
      aud: "english-sense-aud-123",
      sub: "user-sub-1",
      email: "jaeyoung2010@gmail.com",
      exp: NOW_SECONDS - 1,
    });
    const expiredRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/?scope=titanic-have", {
        headers: { "Cf-Access-Jwt-Assertion": expiredToken },
      }),
      env,
      deps,
    );
    assert.equal(expiredRes.status, 401);
    assert.equal((await expiredRes.json() as { code: string }).code, "invalid_token");

    // 6. Wrong signature key -> 401 invalid_token
    const wrongSigToken = await signAccessJwt(otherKey.privateKey, {
      iss: "https://kangpd.cloudflareaccess.com",
      aud: "english-sense-aud-123",
      sub: "user-sub-1",
      email: "jaeyoung2010@gmail.com",
      exp: NOW_SECONDS + 3600,
    });
    const wrongSigRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/?scope=titanic-have", {
        headers: { "Cf-Access-Jwt-Assertion": wrongSigToken },
      }),
      env,
      deps,
    );
    assert.equal(wrongSigRes.status, 401);

    // 7. Unconfigured server -> 503 access_unconfigured
    const unconfRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/?scope=titanic-have", {
        headers: { "Cf-Access-Jwt-Assertion": validToken },
      }),
      { LEARNER_RECORDS: namespace, CF_ACCESS_ALLOWED_HOSTS: "english.artificialmind.kr" },
      deps,
    );
    assert.equal(unconfRes.status, 503);
    assert.equal((await unconfRes.json() as { code: string }).code, "access_unconfigured");

    // 8. Valid CF_Authorization cookie -> 200 OK
    const validCookieRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/?scope=titanic-have", {
        headers: { Cookie: `foo=bar; CF_Authorization=${validToken}` },
      }),
      env,
      deps,
    );
    assert.equal(validCookieRes.status, 200);
    const body = (await validCookieRes.json()) as ScopeRecordEnvelope;
    assert.equal(body.ownerId, "learner-jaeyoung");
    assert.equal(body.revision, 0);
  } finally {
    closeAll();
  }
});

test("durable-store & draft-resume: authenticated command write, idempotent replay, command conflict, revision conflict preserving both drafts, and archive/restore", async () => {
  const { privateKey, publicJwk } = await generateTestKeyPair();
  const { namespace, closeAll } = createRecordNamespace();
  try {
    const env: LearnerRecordEnv = {
      LEARNER_RECORDS: namespace,
      CF_ACCESS_TEAM_DOMAIN: "https://kangpd.cloudflareaccess.com",
      CF_ACCESS_AUD: "english-sense-aud-123",
      CF_ACCESS_ALLOWED_EMAILS: "jaeyoung2010@gmail.com",
      CF_ACCESS_OWNER_ID: "learner-jaeyoung",
      CF_ACCESS_ALLOWED_HOSTS: "english.artificialmind.kr",
      CF_ACCESS_PUBLIC_KEY_JWK: JSON.stringify(publicJwk),
    };
    const deps = { now: NOW_DATE, allowInlineJwk: true };
    const token = await signAccessJwt(privateKey, {
      iss: "https://kangpd.cloudflareaccess.com",
      aud: "english-sense-aud-123",
      sub: "user-sub-1",
      email: "jaeyoung2010@gmail.com",
      exp: NOW_SECONDS + 3600,
    });
    const authHeaders = {
      "Content-Type": "application/json",
      Origin: "https://english.artificialmind.kr",
      "Cf-Access-Jwt-Assertion": token,
    };

    const catalog = await getPublicLearningCatalog();
    let wsState = createWorkspace(catalog);
    const firstId = wsState.selectedArtifactId;
    wsState = submitInitial(wsState, firstId, { kind: "choose", choice: 1, reason: "First answer reason" });
    wsState = addRevision(wsState, firstId, "Revised thought");
    wsState = updateArtifact(wsState, firstId, a => ({ ...a, messageDraft: "Device A draft question" }));

    const cmd1: LearnerRecordCommand = {
      commandId: "cmd-device-a-1",
      scope: ARTIFACT_LESSON_ID,
      runId: "run-have-1",
      expectedRevision: 0,
      deviceId: "device-a",
      clientSeq: 1,
      clientAt: "2026-10-30T01:59:00.000Z",
      action: "sync_state",
      contentVersion: catalog.contentVersion,
      state: wsState,
    };

    const write1 = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(cmd1),
      }),
      env,
      deps,
    );
    assert.equal(write1.status, 200);
    const res1 = (await write1.json()) as { ok: true; idempotentReplay: boolean; envelope: ScopeRecordEnvelope };
    assert.equal(res1.idempotentReplay, false);
    assert.equal(res1.envelope.revision, 1);
    assert.equal(res1.envelope.lastServerSeq, 3); // card, initial, revision
    assert.equal(res1.envelope.canonicalExport.status, "pending-canonical-export");

    // Same commandId + same payload -> idempotent replay (revision stays 1, no duplicate events)
    const replay1 = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(cmd1),
      }),
      env,
      deps,
    );
    assert.equal(replay1.status, 200);
    const replayData = (await replay1.json()) as { ok: true; idempotentReplay: boolean; envelope: ScopeRecordEnvelope };
    assert.equal(replayData.idempotentReplay, true);
    assert.equal(replayData.envelope.revision, 1);

    // Same commandId + different payload -> 409 command_conflict
    const badReplay = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ ...cmd1, clientSeq: 99 }),
      }),
      env,
      deps,
    );
    assert.equal(badReplay.status, 409);
    assert.equal((await badReplay.json() as { code: string }).code, "command_conflict");

    // Stale expectedRevision from Device B -> 409 revision_conflict, preserving both Device A's state and Device B's draft!
    const deviceBState = updateArtifact(wsState, firstId, a => ({ ...a, messageDraft: "Device B conflicting draft" }));
    const staleCmd: LearnerRecordCommand = {
      commandId: "cmd-device-b-stale",
      scope: ARTIFACT_LESSON_ID,
      runId: "run-have-1",
      expectedRevision: 0, // stale! server is at revision 1
      deviceId: "device-b",
      clientSeq: 1,
      action: "sync_state",
      contentVersion: catalog.contentVersion,
      state: deviceBState,
    };
    const conflictRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(staleCmd),
      }),
      env,
      deps,
    );
    assert.equal(conflictRes.status, 409);
    const conflictBody = (await conflictRes.json()) as { code: string; envelope: ScopeRecordEnvelope };
    assert.equal(conflictBody.code, "revision_conflict");
    assert.equal((conflictBody.envelope.state as typeof wsState).artifacts[0].messageDraft, "Device A draft question", "server state was not overwritten");
    assert.equal(conflictBody.envelope.conflictingDrafts.length, 1);
    assert.equal(conflictBody.envelope.conflictingDrafts[0].deviceId, "device-b");

    // Resolve conflict by adopting Device B's draft onto the latest server state
    const resolveCmd: LearnerRecordCommand = {
      commandId: "cmd-resolve-1",
      scope: ARTIFACT_LESSON_ID,
      runId: "run-have-1",
      expectedRevision: 1,
      deviceId: "device-b",
      clientSeq: 2,
      action: "resolve_conflict",
      resolution: "adopt_conflict_draft",
      conflictDeviceId: "device-b",
    };
    const resolvedRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(resolveCmd),
      }),
      env,
      deps,
    );
    assert.equal(resolvedRes.status, 200);
    const resolvedBody = (await resolvedRes.json()) as { envelope: ScopeRecordEnvelope };
    assert.equal(resolvedBody.envelope.revision, 2);
    assert.equal(resolvedBody.envelope.conflictingDrafts.length, 0);
    assert.equal((resolvedBody.envelope.state as typeof wsState).artifacts[0].messageDraft, "Device B conflicting draft");
    assert.deepEqual((resolvedBody.envelope.state as typeof wsState).artifacts[0].initialAttempt, {
      kind: "choose",
      choice: 1,
      reason: "First answer reason",
    }, "adopting draft never overwrites committed initialAttempt");

    // Archive and start a new run, then restore the archived run
    const freshWs = createWorkspace(catalog);
    const archiveCmd: LearnerRecordCommand = {
      commandId: "cmd-archive-1",
      scope: ARTIFACT_LESSON_ID,
      runId: "run-have-1",
      expectedRevision: 2,
      deviceId: "device-b",
      clientSeq: 3,
      action: "archive_and_start_run",
      reason: "restart",
      newRunId: "run-have-2",
      contentVersion: catalog.contentVersion,
      initialState: freshWs,
    };
    const archiveRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(archiveCmd),
      }),
      env,
      deps,
    );
    assert.equal(archiveRes.status, 200);
    const archiveBody = (await archiveRes.json()) as { envelope: ScopeRecordEnvelope };
    assert.equal(archiveBody.envelope.activeRunId, "run-have-2");
    assert.equal(archiveBody.envelope.archivedRuns.length, 1);
    assert.equal(archiveBody.envelope.archivedRuns[0].runId, "run-have-1");

    const restoreCmd: LearnerRecordCommand = {
      commandId: "cmd-restore-1",
      scope: ARTIFACT_LESSON_ID,
      runId: "run-have-2",
      expectedRevision: 3,
      deviceId: "device-b",
      clientSeq: 4,
      action: "restore_archived_run",
      targetRunId: "run-have-1",
    };
    const restoreRes = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(restoreCmd),
      }),
      env,
      deps,
    );
    assert.equal(restoreRes.status, 200);
    const restoreBody = (await restoreRes.json()) as { envelope: ScopeRecordEnvelope };
    assert.equal(restoreBody.envelope.activeRunId, "run-have-1");
    assert.equal((restoreBody.envelope.state as typeof wsState).artifacts[0].revisions[0].text, "Revised thought");
  } finally {
    closeAll();
  }
});

test("material-context & ask scope & canonical web-process export, deduplication, conflict rejection, and ack", async () => {
  const { privateKey, publicJwk } = await generateTestKeyPair();
  const { namespace, closeAll } = createRecordNamespace();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "english-sense-study-sync-"));
  try {
    const env: LearnerRecordEnv = {
      LEARNER_RECORDS: namespace,
      CF_ACCESS_TEAM_DOMAIN: "https://kangpd.cloudflareaccess.com",
      CF_ACCESS_AUD: "english-sense-aud-123",
      CF_ACCESS_ALLOWED_EMAILS: "jaeyoung2010@gmail.com",
      CF_ACCESS_OWNER_ID: "learner-jaeyoung",
      CF_ACCESS_ALLOWED_HOSTS: "english.artificialmind.kr",
      CF_ACCESS_PUBLIC_KEY_JWK: JSON.stringify(publicJwk),
    };
    const deps = { now: NOW_DATE, allowInlineJwk: true };
    const token = await signAccessJwt(privateKey, {
      iss: "https://kangpd.cloudflareaccess.com",
      aud: "english-sense-aud-123",
      sub: "user-sub-1",
      email: "jaeyoung2010@gmail.com",
      exp: NOW_SECONDS + 3600,
    });
    const authHeaders = {
      "Content-Type": "application/json",
      Origin: "https://english.artificialmind.kr",
      "Cf-Access-Jwt-Assertion": token,
    };

    // 1. Save a story lesson record and verify material snapshot preserves story paragraphs/title without answerIndex
    const storyDoc = (await getPublicLesson("green-umbrella")) as LessonDocument;
    let storyState = createLessonState(storyDoc);
    storyState = startReading(storyState, storyDoc, 1_800_000_000_000, "normal");
    storyState = endReading(storyState, 1_800_000_010_000);
    const qId = storyDoc.kind === "story" ? storyDoc.questions[0].questionId : "";
    storyState = registerLessonArtifact(storyState, storyDoc, qId);
    const artId = storyState.artifacts[0].artifactId;
    storyState = submitLessonAttempt(storyState, storyDoc, artId, { kind: "choose", choice: 1 });
    const checkReq = buildLessonCheckRequest(storyState, storyDoc, artId, "chk-story-1");
    const checkRes = await handleLessonCheck(
      new Request("https://english.artificialmind.kr/api/lesson-check/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkReq),
      }),
    );
    storyState = acceptLessonCheck(storyState, checkReq, await checkRes.json());

    const storySave = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          commandId: "cmd-story-1",
          scope: "green-umbrella",
          runId: "run-gu-1",
          expectedRevision: 0,
          deviceId: "device-a",
          clientSeq: 1,
          action: "sync_state",
          contentVersion: storyDoc.contentVersion,
          state: storyState,
        } satisfies LearnerRecordCommand),
      }),
      env,
      deps,
    );
    assert.equal(storySave.status, 200);
    const storyEnv = ((await storySave.json()) as { envelope: ScopeRecordEnvelope }).envelope;
    const matSnap = storyEnv.materialSnapshots[storyDoc.contentVersion];
    assert.ok(matSnap && matSnap.available);
    assert.equal(matSnap.material.kind, "story");
    if (matSnap.material.kind === "story") {
      assert.ok(matSnap.material.paragraphs.length > 0, "story paragraphs are preserved in material snapshot");
      assert.equal("answer" in (matSnap.material.questions[0] as Record<string, unknown>), false, "unopened story answers are never in material snapshot");
    }

    // 2. Save an /ask/ record
    let askState = setAskComposer(createAskRecords(), { mode: "explain", text: "Unsent composer draft" });
    askState = appendAskEntry(askState, createAskEntry({ id: "ask-1", mode: "explain", text: "I get it.", createdAt: "2026-10-30T01:50:00.000Z" }));
    askState = completeAskEntry(
      askState,
      "ask-1",
      {
        english: "I get it.",
        korean: "이해합니다.",
        picture: "뜻을 잡습니다.",
        headwords: [{ word: "get", in_sentence: "get it", image: "잡습니다.", nuance: "이해합니다." }],
        contrasts: [{ kind: "영어식", text: "I get it.", note: "자연스러운 표현입니다." }],
        alternatives: ["I see."],
        note: "",
      },
      "2026-10-30T01:50:05.000Z",
    );
    const askSave = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          commandId: "cmd-ask-1",
          scope: ASK_RECORD_SCOPE,
          runId: "run-ask-1",
          expectedRevision: 0,
          deviceId: "device-a",
          clientSeq: 2,
          action: "sync_state",
          contentVersion: ASK_CONTENT_VERSION,
          state: askState,
        } satisfies LearnerRecordCommand),
      }),
      env,
      deps,
    );
    assert.equal(askSave.status, 200);

    // 3. Export bundle 1 and import into temporary study-and-learn directory
    const export1Res = await handleLearnerRecordExport(
      new Request("https://english.artificialmind.kr/api/learner-records/export/?fromServerSeq=1&bundleId=bundle-test-1", {
        headers: authHeaders,
      }),
      env,
      deps,
    );
    assert.equal(export1Res.status, 200);
    const bundle1 = (await export1Res.json()) as WebProcessBundle;
    assert.equal(bundle1.events.length, 5); // reading-start, reading-end, initial, check, ask-entry-succeeded
    assert.ok(bundle1.draftSnapshots.some(d => d.scope === ASK_RECORD_SCOPE && d.unsubmittedDraft === true));

    const import1 = await importBundleToStudyDirectory(bundle1, {
      studyRootDir: tmpDir,
      expectedOwnerId: "learner-jaeyoung",
      importedAt: "2026-10-30T02:05:00.000Z",
    });
    assert.equal(import1.status, "imported");
    assert.notEqual(import1.canonicalFile.transmissionBundleHash, import1.canonicalFile.canonicalFileHash, "transmission hash and canonical file hash are distinct");

    // 4. Re-importing the exact same bundle is idempotent
    const import1Again = await importBundleToStudyDirectory(bundle1, {
      studyRootDir: tmpDir,
      expectedOwnerId: "learner-jaeyoung",
      importedAt: "2026-10-30T02:06:00.000Z",
    });
    assert.equal(import1Again.status, "already_imported");

    // 5. Export overlapping bundle 2 (fromServerSeq=1 with a new bundleId) -> events are deduplicated via deduplicatedRefs!
    const export2Res = await handleLearnerRecordExport(
      new Request("https://english.artificialmind.kr/api/learner-records/export/?fromServerSeq=1&bundleId=bundle-test-2", {
        headers: authHeaders,
      }),
      env,
      deps,
    );
    const bundle2 = (await export2Res.json()) as WebProcessBundle;
    const import2 = await importBundleToStudyDirectory(bundle2, {
      studyRootDir: tmpDir,
      expectedOwnerId: "learner-jaeyoung",
      importedAt: "2026-10-30T02:07:00.000Z",
    });
    assert.equal(import2.status, "imported");
    assert.equal(import2.canonicalFile.events.length, 0, "overlapping events are not duplicated in raw storage");
    assert.equal(import2.canonicalFile.deduplicatedRefs.filter(r => r.itemType === "event").length, 5);

    // 6. A bundle with a conflicting event content hash for an existing eventId is rejected completely!
    const forgedBundle = structuredClone(bundle2);
    forgedBundle.bundleId = "bundle-forged";
    forgedBundle.events[0].payload = { tampered: true };
    await assert.rejects(
      () =>
        importBundleToStudyDirectory(forgedBundle, {
          studyRootDir: tmpDir,
          expectedOwnerId: "learner-jaeyoung",
        }),
      (err: unknown) => err instanceof BundleVerificationError,
    );
    const filesOnDisk = await readExistingCanonicalFiles(tmpDir);
    assert.equal(filesOnDisk.length, 2, "forged bundle was never written to disk");

    // 7. Send ack receipt to server and verify canonicalExport status becomes canonical-acknowledged
    const ackRes = await handleLearnerRecordAck(
      new Request("https://english.artificialmind.kr/api/learner-records/ack/", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(import1.ack),
      }),
      env,
      deps,
    );
    assert.equal(ackRes.status, 200);
    const ackBody = (await ackRes.json()) as { ok: true; canonicalExport: ScopeRecordEnvelope["canonicalExport"] };
    assert.equal(ackBody.canonicalExport.status, "canonical-acknowledged");
    assert.equal(ackBody.canonicalExport.lastAckedBundleId, "bundle-test-1");
  } finally {
    closeAll();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("request-history & execution lookup: completed AI execution is stored and retrievable without a duplicate paid AI call", async () => {
  const { privateKey, publicJwk } = await generateTestKeyPair();
  const { namespace, closeAll } = createRecordNamespace();
  try {
    let anthropicCalls = 0;
    const env = {
      ANTHROPIC_API_KEY: "test-key",
      QUOTA_LIMITER: {
        idFromName: (n: string) => n,
        get: () => ({ fetch: async () => Response.json({ allowed: true }) }),
      },
      LEARNER_RECORDS: namespace,
      CF_ACCESS_TEAM_DOMAIN: "https://kangpd.cloudflareaccess.com",
      CF_ACCESS_AUD: "english-sense-aud-123",
      CF_ACCESS_ALLOWED_EMAILS: "jaeyoung2010@gmail.com",
      CF_ACCESS_OWNER_ID: "learner-jaeyoung",
      CF_ACCESS_ALLOWED_HOSTS: "english.artificialmind.kr",
      CF_ACCESS_PUBLIC_KEY_JWK: JSON.stringify(publicJwk),
    };
    const token = await signAccessJwt(privateKey, {
      iss: "https://kangpd.cloudflareaccess.com",
      aud: "english-sense-aud-123",
      sub: "user-sub-1",
      email: "jaeyoung2010@gmail.com",
      exp: NOW_SECONDS + 3600,
    });
    const deps = {
      now: NOW_DATE,
      allowInlineJwk: true,
      fetch: (async () => {
        anthropicCalls += 1;
        return Response.json({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "저장된 AI 튜터 답변입니다." }],
        });
      }) as unknown as typeof fetch,
    };

    const catalog = await getPublicLearningCatalog();
    let wsState = createWorkspace(catalog);
    const artId = wsState.selectedArtifactId;
    wsState = submitInitial(wsState, artId, { kind: "choose", choice: 1, reason: "내 생각" });
    wsState = beginTurn(wsState, artId, { id: "t-1", requestId: "req-exec-1", user: "왜 그렇습니까?", origin: "question", status: "pending" });

    const chatRes = await handleLearningChat(
      new Request("https://english.artificialmind.kr/api/learn-chat/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://english.artificialmind.kr",
          "cf-connecting-ip": "203.0.113.10",
          "Cf-Access-Jwt-Assertion": token,
        },
        body: JSON.stringify({
          lessonId: ARTIFACT_LESSON_ID,
          questionId: wsState.artifacts[0].question.questionId,
          contentVersion: catalog.contentVersion,
          artifactId: artId,
          requestId: "req-exec-1",
          initialAttempt: wsState.artifacts[0].initialAttempt,
          revisions: [],
          messages: [],
          message: "왜 그렇습니까?",
        }),
      }),
      env,
      deps,
    );
    assert.equal(chatRes.status, 200);
    assert.equal(anthropicCalls, 1);

    // Query execution status from /api/learner-records/executions/ without calling Anthropic again
    const execLookup = await handleLearnerRecordExecutions(
      new Request("https://english.artificialmind.kr/api/learner-records/executions/?scope=titanic-have&requestId=req-exec-1", {
        headers: {
          Origin: "https://english.artificialmind.kr",
          "Cf-Access-Jwt-Assertion": token,
        },
      }),
      env,
      deps,
    );
    assert.equal(execLookup.status, 200);
    const execBody = (await execLookup.json()) as { ok: true; execution: { status: string; responsePayload: { reply: string } } };
    assert.equal(execBody.execution.status, "succeeded");
    assert.equal(execBody.execution.responsePayload.reply, "저장된 AI 튜터 답변입니다.");
    assert.equal(anthropicCalls, 1, "execution lookup does not invoke the provider");

    // Verify returnTo login callback sets sessionStorage and prevents open redirects
    const loginCallback = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/?returnTo=%2Fprep%2Fwonder%2Funit-1%2F", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }),
      env,
      deps,
    );
    assert.equal(loginCallback.status, 200);
    const loginHtml = await loginCallback.text();
    assert.match(loginHtml, /es:personal-sync-enabled:v1/);
    assert.match(loginHtml, /"\/prep\/wonder\/unit-1\/"/);

    const openRedirectCallback = await handleLearnerRecords(
      new Request("https://english.artificialmind.kr/api/learner-records/?returnTo=%2F%2Fevil.example.com", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }),
      env,
      deps,
    );
    assert.equal(openRedirectCallback.status, 200);
    assert.match(await openRedirectCallback.text(), /window\.location\.replace\("\/"\)/);
  } finally {
    closeAll();
  }
});
