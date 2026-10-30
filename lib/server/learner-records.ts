import { type AskRecords } from "../ask-records";
import { ARTIFACT_LESSON_ID } from "../learning-catalog";
import { type WorkspaceState } from "../learning-workspace-state";
import {
  ASK_CONTENT_VERSION,
  ASK_RECORD_SCOPE,
  applyScopeDrafts,
  extractScopeDrafts,
  isLearnerRecordCommand,
  isRecordScope,
  isValidExecutionResponsePayload,
  isValidId,
  resolveCanonicalProblemId,
  type ArchivedRunSummary,
  type CanonicalExportStatus,
  type ExternalExecutionKind,
  type ExternalExecutionRecord,
  type ExternalExecutionStatus,
  type LearnerRecordCommand,
  type ProcessEventInput,
  type PublicMaterialSnapshot,
  type RecordProvenance,
  type RecordScope,
  type ScopeDraftEnvelope,
  type ScopeRecordEnvelope,
  type ScopedRecordState,
  type StoredMaterialSnapshot,
} from "../learner-record-contract";
import { type LessonState } from "../lesson-workspace-state";
import {
  BundleVerificationError,
  canonicalJson,
  computeBundleHash,
  computeDraftSnapshotHash,
  computeEventHash,
  computeLegacyImportHash,
  computeMaterialSnapshotHash,
  isWebProcessAckReceipt,
  sha256Hex,
  type ExportedDraftSnapshot,
  type ServerProcessEvent,
  type StoredLegacyImport,
  type WebProcessAckReceipt,
  type WebProcessBundle,
} from "../process-bundle";
import { AccessAuthError, verifyOwnerRequest, type AccessAuthDependencies, type AccessAuthEnv } from "./access-auth";
import { getPublicLearningCatalog } from "./learning-catalog";
import { getPublicLesson } from "./lesson-catalog";

interface SqlCursor {
  toArray(): Record<string, unknown>[];
}

interface Sql {
  exec(query: string, ...bindings: unknown[]): SqlCursor;
}

interface RecordStorage {
  sql: Sql;
  transactionSync<T>(closure: () => T): T;
}

export interface LearnerRecordState {
  storage: RecordStorage;
}

export interface LearnerRecordNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface LearnerRecordEnv extends AccessAuthEnv {
  LEARNER_RECORDS?: LearnerRecordNamespace;
}

const MAX_COMMAND_BODY_BYTES = 1024 * 1024;

function json(value: unknown, status = 200, extra?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readBoundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("body_limit");
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

type ExtractedDomainEvent = {
  eventId: string;
  kind: string;
  contentVersion: string;
  targetId?: string;
  questionId?: string;
  canonicalProblemId?: string;
  canonicalMapped?: boolean;
  clientAt?: string | null;
  payload: Record<string, unknown>;
};

function extractStateDomainEvents(
  scope: RecordScope,
  state: ScopedRecordState,
  fallbackContentVersion: string,
): ExtractedDomainEvent[] {
  if (scope === ARTIFACT_LESSON_ID) {
    const ws = state as WorkspaceState;
    return ws.events.map(ev => {
      const artifact = ws.artifacts.find(a => a.artifactId === ev.artifactId);
      const questionId = artifact?.question.questionId;
      const contentVersion = artifact?.contentVersion ?? fallbackContentVersion;
      const canonical = questionId ? resolveCanonicalProblemId(scope, questionId) : undefined;
      const payload: Record<string, unknown> = { event: ev };
      if (ev.kind === "initial" && artifact?.initialAttempt) {
        payload.initialAttempt = artifact.initialAttempt;
      } else if (ev.kind === "revision" && artifact?.revisions[ev.index]) {
        payload.revision = artifact.revisions[ev.index];
      } else if ((ev.kind === "request" || ev.kind === "retry" || ev.kind === "reply") && artifact) {
        const thread = artifact.threads.find(t => t.id === ev.threadId);
        const turn = thread?.turns.find(t => t.id === ev.turnId);
        if (turn) payload.turn = turn;
      } else if (ev.kind === "legacy" && artifact?.legacyImport) {
        payload.legacyVersion = artifact.legacyImport.version;
      }
      return {
        eventId: ev.id,
        kind: ev.kind,
        contentVersion,
        targetId: ev.artifactId,
        ...(questionId ? { questionId } : {}),
        ...(canonical ? { canonicalProblemId: canonical.canonicalProblemId, canonicalMapped: canonical.mapped } : {}),
        payload,
      };
    });
  }

  if (scope === ASK_RECORD_SCOPE) {
    const ask = state as AskRecords;
    const events: ExtractedDomainEvent[] = [];
    for (const entry of ask.entries) {
      events.push({
        eventId: `ask-entry-${entry.id}-${entry.status}`,
        kind: `ask-entry-${entry.status}`,
        contentVersion: ASK_CONTENT_VERSION,
        targetId: entry.id,
        clientAt: entry.finishedAt ?? entry.createdAt,
        payload: {
          id: entry.id,
          mode: entry.mode,
          text: entry.text,
          createdAt: entry.createdAt,
          ...(entry.finishedAt ? { finishedAt: entry.finishedAt } : {}),
          status: entry.status,
          ...(entry.retryOf ? { retryOf: entry.retryOf } : {}),
          ...(entry.result ? { result: entry.result } : {}),
          ...(entry.error ? { error: entry.error } : {}),
        },
      });
      for (const turn of entry.turns) {
        events.push({
          eventId: `ask-turn-${entry.id}-${turn.id}-${turn.status}`,
          kind: `ask-turn-${turn.status}`,
          contentVersion: ASK_CONTENT_VERSION,
          targetId: entry.id,
          clientAt: turn.finishedAt ?? turn.createdAt,
          payload: {
            entryId: entry.id,
            turnId: turn.id,
            message: turn.message,
            createdAt: turn.createdAt,
            ...(turn.finishedAt ? { finishedAt: turn.finishedAt } : {}),
            status: turn.status,
            ...(turn.retryOf ? { retryOf: turn.retryOf } : {}),
            ...(turn.reply ? { reply: turn.reply } : {}),
            ...(turn.error ? { error: turn.error } : {}),
          },
        });
      }
    }
    return events;
  }

  const lesson = state as LessonState;
  const extracted: ExtractedDomainEvent[] = lesson.events.map(ev => {
    if (ev.kind === "reading-start" || ev.kind === "reading-end") {
      return {
        eventId: ev.id,
        kind: ev.kind,
        contentVersion: fallbackContentVersion,
        clientAt: new Date(ev.kind === "reading-start" ? ev.startedAt : ev.endedAt).toISOString(),
        payload: { event: ev },
      };
    }
    const artifact = lesson.artifacts.find(a => a.artifactId === ev.artifactId);
    const questionId = artifact?.question.questionId;
    const contentVersion = artifact?.contentVersion ?? fallbackContentVersion;
    const canonical = questionId ? resolveCanonicalProblemId(scope, questionId) : undefined;
    const payload: Record<string, unknown> = { event: ev };
    if (ev.kind === "initial" && artifact?.attempts[0]) {
      payload.attempt = artifact.attempts[0].attempt;
    } else if (ev.kind === "revision" && artifact?.attempts[ev.index]) {
      payload.attempt = artifact.attempts[ev.index].attempt;
    } else if (ev.kind === "check" && artifact?.attempts[ev.index]?.check) {
      payload.check = artifact.attempts[ev.index].check;
    } else if (ev.kind === "reveal" && artifact?.reveal) {
      payload.reveal = artifact.reveal;
    } else if ((ev.kind === "request" || ev.kind === "retry" || ev.kind === "reply") && artifact) {
      const thread = artifact.threads.find(t => t.id === ev.threadId);
      const turn = thread?.turns.find(t => t.id === ev.turnId);
      if (turn) payload.turn = turn;
    }
    return {
      eventId: ev.id,
      kind: ev.kind,
      contentVersion,
      targetId: ev.artifactId,
      ...(questionId ? { questionId } : {}),
      ...(canonical ? { canonicalProblemId: canonical.canonicalProblemId, canonicalMapped: canonical.mapped } : {}),
      payload,
    };
  });

  for (const artifact of lesson.artifacts) {
    const questionId = artifact.question.questionId;
    const canonical = resolveCanonicalProblemId(scope, questionId);
    artifact.attempts.forEach((attemptRecord, index) => {
      for (const failedCheck of attemptRecord.failedChecks ?? []) {
        const eventId = `check-failed-${artifact.artifactId}-${index}-${failedCheck.requestId}`;
        if (extracted.some(item => item.eventId === eventId)) continue;
        extracted.push({
          eventId,
          kind: "check-failed",
          contentVersion: artifact.contentVersion,
          targetId: artifact.artifactId,
          questionId,
          canonicalProblemId: canonical.canonicalProblemId,
          canonicalMapped: canonical.mapped,
          payload: {
            event: {
              id: eventId,
              kind: "check-failed",
              artifactId: artifact.artifactId,
              index,
              requestId: failedCheck.requestId,
              error: failedCheck.error,
            },
            attempt: attemptRecord.attempt,
          },
        });
      }
    });
    for (const failedReveal of artifact.failedReveals ?? []) {
      const eventId = `reveal-failed-${artifact.artifactId}-${failedReveal.requestId}`;
      if (extracted.some(item => item.eventId === eventId)) continue;
      extracted.push({
        eventId,
        kind: "reveal-failed",
        contentVersion: artifact.contentVersion,
        targetId: artifact.artifactId,
        questionId,
        canonicalProblemId: canonical.canonicalProblemId,
        canonicalMapped: canonical.mapped,
        payload: {
          event: {
            id: eventId,
            kind: "reveal-failed",
            artifactId: artifact.artifactId,
            afterAttempts: failedReveal.afterAttempts,
            requestId: failedReveal.requestId,
            error: failedReveal.error,
          },
        },
      });
    }
  }
  return extracted;
}

async function buildMaterialSnapshotsForState(
  scope: RecordScope,
  contentVersion: string,
  state: ScopedRecordState | undefined,
  nowIso: string,
): Promise<StoredMaterialSnapshot[]> {
  if (scope === ASK_RECORD_SCOPE) return [];
  const versions = new Set<string>([contentVersion]);
  if (state && "artifacts" in state) {
    for (const art of state.artifacts) {
      if (typeof art.contentVersion === "string") versions.add(art.contentVersion);
    }
  }
  let currentPublic: PublicMaterialSnapshot | null = null;
  try {
    if (scope === ARTIFACT_LESSON_ID) {
      currentPublic = { kind: "scene", ...(await getPublicLearningCatalog()) };
    } else {
      const pub = await getPublicLesson(scope);
      if (pub.kind !== "scene") currentPublic = pub;
    }
  } catch {
    currentPublic = null;
  }

  const results: StoredMaterialSnapshot[] = [];
  for (const ver of versions) {
    if (currentPublic && currentPublic.contentVersion === ver) {
      const snapshotHash = await computeMaterialSnapshotHash({
        scope,
        contentVersion: ver,
        available: true,
        material: currentPublic,
      });
      results.push({
        scope,
        contentVersion: ver,
        available: true,
        capturedAt: nowIso,
        snapshotHash,
        material: currentPublic,
      });
    } else {
      const preservedQuestions: { questionId: string; snapshot: unknown }[] = [];
      if (state && "artifacts" in state) {
        for (const art of state.artifacts) {
          if (art.contentVersion === ver) {
            preservedQuestions.push({ questionId: art.question.questionId, snapshot: art.question });
          }
        }
      }
      results.push({
        scope,
        contentVersion: ver,
        available: false,
        capturedAt: nowIso,
        reason: "historical_version_unavailable",
        preservedQuestions,
      });
    }
  }
  return results;
}

function hasMeaningfulStateWork(scope: RecordScope, state: ScopedRecordState): boolean {
  if (scope === ARTIFACT_LESSON_ID) {
    const ws = state as WorkspaceState;
    return ws.artifacts.some(a => a.initialAttempt !== null || a.choice !== "" || a.answerDraft !== "" || a.reason !== "" || a.messageDraft !== "" || a.threads.some(t => t.turns.length > 0));
  }
  if (scope === ASK_RECORD_SCOPE) {
    const ask = state as AskRecords;
    return ask.entries.length > 0 || ask.composer.text.trim().length > 0;
  }
  const lesson = state as LessonState;
  return lesson.events.length > 0 || lesson.artifacts.some(a => a.attempts.length > 0 || a.choice !== null || a.inputs.some(Boolean) || a.messageDraft !== "" || a.threads.some(t => t.turns.length > 0));
}

/**
 * Dedicated SQLite-backed Durable Object for personal learner records.
 * Unlike `DailyQuota`, this store NEVER sets a destructive deletion alarm.
 */
export class LearnerRecordStore {
  constructor(private readonly state: LearnerRecordState) {
    this.state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
      "CREATE TABLE IF NOT EXISTS scope_runs (scope TEXT NOT NULL, run_id TEXT NOT NULL, is_active INTEGER NOT NULL, revision INTEGER NOT NULL, content_version TEXT NOT NULL, provenance TEXT NOT NULL, state_json TEXT NOT NULL, draft_json TEXT, conflict_drafts_json TEXT NOT NULL, archived_at TEXT, archive_reason TEXT, updated_at TEXT NOT NULL, last_server_seq INTEGER NOT NULL, PRIMARY KEY (scope, run_id));" +
      "CREATE TABLE IF NOT EXISTS command_log (owner_id TEXT NOT NULL, command_id TEXT NOT NULL, payload_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, command_id));" +
      "CREATE TABLE IF NOT EXISTS process_events (server_seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL, owner_id TEXT NOT NULL, scope TEXT NOT NULL, run_id TEXT NOT NULL, received_at TEXT NOT NULL, client_seq INTEGER, client_at TEXT, provenance TEXT NOT NULL, content_version TEXT NOT NULL, target_id TEXT, question_id TEXT, canonical_problem_id TEXT, canonical_mapped INTEGER, kind TEXT NOT NULL, payload_json TEXT NOT NULL, event_hash TEXT NOT NULL, UNIQUE (owner_id, run_id, event_id));" +
      "CREATE TABLE IF NOT EXISTS material_snapshots (scope TEXT NOT NULL, content_version TEXT NOT NULL, available INTEGER NOT NULL, captured_at TEXT NOT NULL, snapshot_hash TEXT, snapshot_json TEXT NOT NULL, PRIMARY KEY (scope, content_version));" +
      "CREATE TABLE IF NOT EXISTS legacy_imports (import_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL, run_id TEXT NOT NULL, storage_key TEXT NOT NULL, legacy_version TEXT, content_version TEXT, imported_at TEXT NOT NULL, raw_json TEXT NOT NULL, content_hash TEXT NOT NULL);" +
      "CREATE TABLE IF NOT EXISTS exported_bundles (bundle_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, storage_generation TEXT NOT NULL, exported_at TEXT NOT NULL, from_server_seq INTEGER NOT NULL, to_server_seq INTEGER NOT NULL, bundle_hash TEXT NOT NULL, bundle_json TEXT NOT NULL, ack_json TEXT);" +
      "CREATE TABLE IF NOT EXISTS external_executions (owner_id TEXT NOT NULL, scope TEXT NOT NULL, request_id TEXT NOT NULL, attempt_id TEXT NOT NULL, target_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, response_json TEXT, error_code TEXT, error_message TEXT, PRIMARY KEY (owner_id, scope, request_id));",
    );
  }

  private getMeta(key: string): string | null {
    const rows = this.state.storage.sql.exec("SELECT value FROM store_meta WHERE key = ?", key).toArray();
    return rows.length ? String(rows[0].value) : null;
  }

  private setMeta(key: string, value: string): void {
    this.state.storage.sql.exec("INSERT OR REPLACE INTO store_meta (key, value) VALUES (?, ?)", key, value);
  }

  private ensureMeta(ownerId: string): { storageGeneration: string; lastServerSeq: number; lastAckedServerSeq: number; lastAckedBundleId: string | null; lastAckedAt: string | null } {
    const existingOwner = this.getMeta("owner_id");
    if (existingOwner && existingOwner !== ownerId) {
      throw new Error("owner_store_mismatch");
    }
    if (!existingOwner) this.setMeta("owner_id", ownerId);
    let generation = this.getMeta("storage_generation");
    if (!generation) {
      generation = `gen-${crypto.randomUUID()}`;
      this.setMeta("storage_generation", generation);
    }
    const lastServerSeq = Number(this.getMeta("last_server_seq") ?? "0");
    const lastAckedServerSeq = Number(this.getMeta("last_acked_server_seq") ?? "0");
    const lastAckedBundleId = this.getMeta("last_acked_bundle_id");
    const lastAckedAt = this.getMeta("last_acked_at");
    return { storageGeneration: generation, lastServerSeq, lastAckedServerSeq, lastAckedBundleId, lastAckedAt };
  }

  private buildCanonicalStatus(ownerId: string): CanonicalExportStatus {
    const meta = this.ensureMeta(ownerId);
    const status = meta.lastServerSeq === 0
      ? "no-records"
      : meta.lastAckedServerSeq >= meta.lastServerSeq
        ? "canonical-acknowledged"
        : "pending-canonical-export";
    return {
      status,
      storageGeneration: meta.storageGeneration,
      lastServerSeq: meta.lastServerSeq,
      lastAckedServerSeq: meta.lastAckedServerSeq,
      lastAckedBundleId: meta.lastAckedBundleId,
      lastAckedAt: meta.lastAckedAt,
    };
  }

  private readScopeEnvelope(ownerId: string, scope: RecordScope, defaultContentVersion: string = ASK_CONTENT_VERSION): ScopeRecordEnvelope {
    const canonicalExport = this.buildCanonicalStatus(ownerId);
    const rows = this.state.storage.sql
      .exec(
        "SELECT run_id, is_active, revision, content_version, provenance, state_json, draft_json, conflict_drafts_json, archived_at, archive_reason, updated_at, last_server_seq FROM scope_runs WHERE scope = ? ORDER BY updated_at DESC",
        scope,
      )
      .toArray();

    const activeRow = rows.find(r => Number(r.is_active) === 1);
    const archivedRows = rows.filter(r => Number(r.is_active) === 0);

    const archivedRuns: ArchivedRunSummary[] = archivedRows.map(row => ({
      runId: String(row.run_id),
      scope,
      contentVersion: String(row.content_version),
      provenance: String(row.provenance) as RecordProvenance,
      archivedAt: String(row.archived_at ?? row.updated_at),
      reason: (row.archive_reason ? String(row.archive_reason) : "manual-archive") as ArchivedRunSummary["reason"],
      revision: Number(row.revision),
      state: JSON.parse(String(row.state_json)) as ScopedRecordState,
    }));

    const materialRows = this.state.storage.sql
      .exec("SELECT content_version, snapshot_json FROM material_snapshots WHERE scope = ?", scope)
      .toArray();
    const materialSnapshots: Record<string, StoredMaterialSnapshot> = {};
    for (const mRow of materialRows) {
      materialSnapshots[String(mRow.content_version)] = JSON.parse(String(mRow.snapshot_json)) as StoredMaterialSnapshot;
    }

    if (!activeRow) {
      return {
        authenticated: true,
        ownerId,
        scope,
        activeRunId: `run-${scope}-initial`,
        revision: 0,
        contentVersion: defaultContentVersion,
        provenance: "authenticated-live",
        updatedAt: null,
        lastServerSeq: 0,
        state: null,
        draftEnvelope: null,
        conflictingDrafts: [],
        archivedRuns,
        materialSnapshots,
        canonicalExport,
      };
    }

    return {
      authenticated: true,
      ownerId,
      scope,
      activeRunId: String(activeRow.run_id),
      revision: Number(activeRow.revision),
      contentVersion: String(activeRow.content_version),
      provenance: String(activeRow.provenance) as RecordProvenance,
      updatedAt: String(activeRow.updated_at),
      lastServerSeq: Number(activeRow.last_server_seq),
      state: JSON.parse(String(activeRow.state_json)) as ScopedRecordState,
      draftEnvelope: activeRow.draft_json ? (JSON.parse(String(activeRow.draft_json)) as ScopeDraftEnvelope) : null,
      conflictingDrafts: JSON.parse(String(activeRow.conflict_drafts_json || "[]")) as ScopeDraftEnvelope[],
      archivedRuns,
      materialSnapshots,
      canonicalExport,
    };
  }

  private upsertMaterialSnapshots(snapshots: StoredMaterialSnapshot[]): void {
    for (const snap of snapshots) {
      if (snap.available) {
        this.state.storage.sql.exec(
          "INSERT OR REPLACE INTO material_snapshots (scope, content_version, available, captured_at, snapshot_hash, snapshot_json) VALUES (?, ?, 1, ?, ?, ?)",
          snap.scope,
          snap.contentVersion,
          snap.capturedAt,
          snap.snapshotHash,
          JSON.stringify(snap),
        );
      } else {
        const existing = this.state.storage.sql
          .exec("SELECT available FROM material_snapshots WHERE scope = ? AND content_version = ?", snap.scope, snap.contentVersion)
          .toArray();
        if (!existing.length || Number(existing[0].available) === 0) {
          this.state.storage.sql.exec(
            "INSERT OR REPLACE INTO material_snapshots (scope, content_version, available, captured_at, snapshot_hash, snapshot_json) VALUES (?, ?, 0, ?, NULL, ?)",
            snap.scope,
            snap.contentVersion,
            snap.capturedAt,
            JSON.stringify(snap),
          );
        }
      }
    }
  }

  private appendProcessEvents(
    ownerId: string,
    scope: RecordScope,
    runId: string,
    receivedAt: string,
    events: (Omit<ServerProcessEvent, "serverSeq" | "receivedAt">)[],
  ): number {
    let seq = Number(this.getMeta("last_server_seq") ?? "0");
    for (const ev of events) {
      const existing = this.state.storage.sql
        .exec("SELECT server_seq FROM process_events WHERE owner_id = ? AND run_id = ? AND event_id = ?", ownerId, runId, ev.eventId)
        .toArray();
      if (existing.length > 0) continue;
      seq += 1;
      this.state.storage.sql.exec(
        "INSERT INTO process_events (server_seq, event_id, owner_id, scope, run_id, received_at, client_seq, client_at, provenance, content_version, target_id, question_id, canonical_problem_id, canonical_mapped, kind, payload_json, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        seq,
        ev.eventId,
        ownerId,
        scope,
        runId,
        receivedAt,
        ev.clientSeq,
        ev.clientAt,
        ev.provenance,
        ev.contentVersion,
        ev.targetId ?? null,
        ev.questionId ?? null,
        ev.canonicalProblemId ?? null,
        ev.canonicalMapped === undefined ? null : ev.canonicalMapped ? 1 : 0,
        ev.kind,
        JSON.stringify(ev.payload),
        ev.eventHash,
      );
    }
    this.setMeta("last_server_seq", String(seq));
    return seq;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/scope") {
      const ownerId = url.searchParams.get("ownerId") ?? "";
      const scope = url.searchParams.get("scope") ?? "";
      const defaultVersion = url.searchParams.get("defaultContentVersion") ?? ASK_CONTENT_VERSION;
      if (!isValidId(ownerId) || !isRecordScope(scope)) return json({ ok: false, detail: "잘못된 조회 요청입니다." }, 400);
      const envelope = this.state.storage.transactionSync(() => this.readScopeEnvelope(ownerId, scope, defaultVersion));
      return json(envelope);
    }

    if (request.method === "POST" && url.pathname === "/command") {
      const body = (await request.json()) as {
        ownerId: string;
        command: LearnerRecordCommand;
        payloadHash: string;
        nowIso: string;
        materialSnapshots: StoredMaterialSnapshot[];
        preparedEvents: (Omit<ServerProcessEvent, "serverSeq" | "receivedAt">)[];
        preparedLegacyImports: StoredLegacyImport[];
      };

      const outcome = this.state.storage.transactionSync(() => {
        this.ensureMeta(body.ownerId);

        const priorCmd = this.state.storage.sql
          .exec("SELECT payload_hash, response_json FROM command_log WHERE owner_id = ? AND command_id = ?", body.ownerId, body.command.commandId)
          .toArray();
        if (priorCmd.length > 0) {
          if (String(priorCmd[0].payload_hash) !== body.payloadHash) {
            return {
              status: 409,
              payload: {
                ok: false,
                code: "command_conflict",
                detail: "같은 명령 ID에 다른 요청 내용이 전달되어 거절했습니다.",
              },
            };
          }
          const savedResponse = JSON.parse(String(priorCmd[0].response_json)) as Record<string, unknown>;
          return {
            status: 200,
            payload: { ...savedResponse, idempotentReplay: true },
          };
        }

        const cmd = body.command;
        const currentEnvelope = this.readScopeEnvelope(
          body.ownerId,
          cmd.scope,
          "contentVersion" in cmd ? cmd.contentVersion : ASK_CONTENT_VERSION,
        );
        const currentRevision = currentEnvelope.revision;

        if (cmd.expectedRevision !== currentRevision) {
          if (cmd.action === "sync_state" || cmd.action === "save_draft") {
            const incomingDraft: ScopeDraftEnvelope = {
              deviceId: cmd.deviceId,
              baseRevision: cmd.expectedRevision,
              ...(cmd.clientAt ? { clientAt: cmd.clientAt } : {}),
              savedAt: body.nowIso,
              drafts: cmd.action === "save_draft" ? cmd.drafts : extractScopeDrafts(cmd.scope, cmd.state),
            };
            const existingConflicts = currentEnvelope.conflictingDrafts.filter(d => d.deviceId !== cmd.deviceId);
            const nextConflicts = [...existingConflicts, incomingDraft];
            if (currentEnvelope.state !== null) {
              this.state.storage.sql.exec(
                "UPDATE scope_runs SET conflict_drafts_json = ?, updated_at = ? WHERE scope = ? AND run_id = ? AND is_active = 1",
                JSON.stringify(nextConflicts),
                body.nowIso,
                cmd.scope,
                currentEnvelope.activeRunId,
              );
            }
          }
          const updatedConflictEnvelope = this.readScopeEnvelope(body.ownerId, cmd.scope, currentEnvelope.contentVersion);
          return {
            status: 409,
            payload: {
              ok: false,
              code: "revision_conflict",
              detail: "다른 기기나 창에서 먼저 저장한 변경이 있습니다. 두 초안을 모두 보존했으니 이어 갈 초안을 선택해 주세요.",
              envelope: updatedConflictEnvelope,
            },
          };
        }

        this.upsertMaterialSnapshots(body.materialSnapshots);

        const nextRevision = currentRevision + 1;
        let activeRunId = currentEnvelope.state !== null ? currentEnvelope.activeRunId : cmd.runId;

        if (cmd.action === "sync_state") {
          const provenance: RecordProvenance = currentEnvelope.state !== null ? currentEnvelope.provenance : "authenticated-live";
          const draftEnvelope: ScopeDraftEnvelope = {
            deviceId: cmd.deviceId,
            baseRevision: nextRevision,
            ...(cmd.clientAt ? { clientAt: cmd.clientAt } : {}),
            savedAt: body.nowIso,
            drafts: extractScopeDrafts(cmd.scope, cmd.state),
          };
          const seq = this.appendProcessEvents(body.ownerId, cmd.scope, activeRunId, body.nowIso, body.preparedEvents);
          this.state.storage.sql.exec(
            "INSERT OR REPLACE INTO scope_runs (scope, run_id, is_active, revision, content_version, provenance, state_json, draft_json, conflict_drafts_json, archived_at, archive_reason, updated_at, last_server_seq) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
            cmd.scope,
            activeRunId,
            nextRevision,
            cmd.contentVersion,
            provenance,
            JSON.stringify(cmd.state),
            JSON.stringify(draftEnvelope),
            JSON.stringify(currentEnvelope.conflictingDrafts),
            body.nowIso,
            seq,
          );
        } else if (cmd.action === "save_draft") {
          if (currentEnvelope.state === null) {
            return {
              status: 400,
              payload: { ok: false, code: "invalid_request", detail: "초안을 적용할 활성 실행 기록이 없습니다." },
            };
          }
          const mergedState = applyScopeDrafts(cmd.scope, currentEnvelope.state, cmd.drafts);
          const draftEnvelope: ScopeDraftEnvelope = {
            deviceId: cmd.deviceId,
            baseRevision: nextRevision,
            ...(cmd.clientAt ? { clientAt: cmd.clientAt } : {}),
            savedAt: body.nowIso,
            drafts: cmd.drafts,
          };
          this.state.storage.sql.exec(
            "UPDATE scope_runs SET revision = ?, state_json = ?, draft_json = ?, updated_at = ? WHERE scope = ? AND run_id = ? AND is_active = 1",
            nextRevision,
            JSON.stringify(mergedState),
            JSON.stringify(draftEnvelope),
            body.nowIso,
            cmd.scope,
            activeRunId,
          );
        } else if (cmd.action === "resolve_conflict") {
          if (currentEnvelope.state === null) {
            return {
              status: 400,
              payload: { ok: false, code: "invalid_request", detail: "충돌을 해결할 활성 실행 기록이 없습니다." },
            };
          }
          const targetConflict = currentEnvelope.conflictingDrafts.find(c => c.deviceId === cmd.conflictDeviceId);
          const nextState = cmd.resolution === "adopt_conflict_draft" && targetConflict
            ? applyScopeDrafts(cmd.scope, currentEnvelope.state, targetConflict.drafts)
            : currentEnvelope.state;
          const remainingConflicts = currentEnvelope.conflictingDrafts.filter(c => c.deviceId !== cmd.conflictDeviceId);
          const nextDraft: ScopeDraftEnvelope = {
            deviceId: cmd.deviceId,
            baseRevision: nextRevision,
            ...(cmd.clientAt ? { clientAt: cmd.clientAt } : {}),
            savedAt: body.nowIso,
            drafts: extractScopeDrafts(cmd.scope, nextState),
          };
          const seq = this.appendProcessEvents(body.ownerId, cmd.scope, activeRunId, body.nowIso, body.preparedEvents);
          this.state.storage.sql.exec(
            "UPDATE scope_runs SET revision = ?, state_json = ?, draft_json = ?, conflict_drafts_json = ?, updated_at = ?, last_server_seq = ? WHERE scope = ? AND run_id = ? AND is_active = 1",
            nextRevision,
            JSON.stringify(nextState),
            JSON.stringify(nextDraft),
            JSON.stringify(remainingConflicts),
            body.nowIso,
            seq,
            cmd.scope,
            activeRunId,
          );
        } else if (cmd.action === "archive_and_start_run") {
          if (currentEnvelope.state !== null) {
            this.state.storage.sql.exec(
              "UPDATE scope_runs SET is_active = 0, archived_at = ?, archive_reason = ?, updated_at = ? WHERE scope = ? AND run_id = ? AND is_active = 1",
              body.nowIso,
              cmd.reason,
              body.nowIso,
              cmd.scope,
              currentEnvelope.activeRunId,
            );
          }
          activeRunId = cmd.newRunId;
          const draftEnvelope: ScopeDraftEnvelope = {
            deviceId: cmd.deviceId,
            baseRevision: nextRevision,
            ...(cmd.clientAt ? { clientAt: cmd.clientAt } : {}),
            savedAt: body.nowIso,
            drafts: extractScopeDrafts(cmd.scope, cmd.initialState),
          };
          const seq = this.appendProcessEvents(body.ownerId, cmd.scope, activeRunId, body.nowIso, body.preparedEvents);
          this.state.storage.sql.exec(
            "INSERT OR REPLACE INTO scope_runs (scope, run_id, is_active, revision, content_version, provenance, state_json, draft_json, conflict_drafts_json, archived_at, archive_reason, updated_at, last_server_seq) VALUES (?, ?, 1, ?, ?, 'authenticated-live', ?, ?, '[]', NULL, NULL, ?, ?)",
            cmd.scope,
            activeRunId,
            nextRevision,
            cmd.contentVersion,
            JSON.stringify(cmd.initialState),
            JSON.stringify(draftEnvelope),
            body.nowIso,
            seq,
          );
        } else if (cmd.action === "restore_archived_run") {
          const targetRows = this.state.storage.sql
            .exec("SELECT run_id, state_json FROM scope_runs WHERE scope = ? AND run_id = ? AND is_active = 0", cmd.scope, cmd.targetRunId)
            .toArray();
          if (!targetRows.length) {
            return {
              status: 404,
              payload: { ok: false, code: "not_found", detail: "복원할 보관함 실행 기록을 찾지 못했습니다." },
            };
          }
          if (currentEnvelope.state !== null && hasMeaningfulStateWork(cmd.scope, currentEnvelope.state)) {
            this.state.storage.sql.exec(
              "UPDATE scope_runs SET is_active = 0, archived_at = ?, archive_reason = 'manual-archive', updated_at = ? WHERE scope = ? AND run_id = ? AND is_active = 1",
              body.nowIso,
              body.nowIso,
              cmd.scope,
              currentEnvelope.activeRunId,
            );
          } else if (currentEnvelope.state !== null) {
            this.state.storage.sql.exec("DELETE FROM scope_runs WHERE scope = ? AND run_id = ? AND is_active = 1", cmd.scope, currentEnvelope.activeRunId);
          }
          activeRunId = cmd.targetRunId;
          const seq = this.appendProcessEvents(body.ownerId, cmd.scope, activeRunId, body.nowIso, body.preparedEvents);
          this.state.storage.sql.exec(
            "UPDATE scope_runs SET is_active = 1, revision = ?, archived_at = NULL, archive_reason = NULL, updated_at = ?, last_server_seq = ? WHERE scope = ? AND run_id = ?",
            nextRevision,
            body.nowIso,
            seq,
            cmd.scope,
            activeRunId,
          );
        } else if (cmd.action === "import_browser_records") {
          if (currentEnvelope.state !== null && hasMeaningfulStateWork(cmd.scope, currentEnvelope.state) && currentEnvelope.activeRunId !== cmd.runId) {
            this.state.storage.sql.exec(
              "UPDATE scope_runs SET is_active = 0, archived_at = ?, archive_reason = 'legacy-import', updated_at = ? WHERE scope = ? AND run_id = ? AND is_active = 1",
              body.nowIso,
              body.nowIso,
              cmd.scope,
              currentEnvelope.activeRunId,
            );
            activeRunId = cmd.runId;
          }
          for (const leg of body.preparedLegacyImports) {
            this.state.storage.sql.exec(
              "INSERT OR IGNORE INTO legacy_imports (import_id, owner_id, scope, run_id, storage_key, legacy_version, content_version, imported_at, raw_json, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              leg.importId,
              leg.ownerId,
              leg.scope,
              activeRunId,
              leg.storageKey,
              leg.legacyVersion === undefined ? null : String(leg.legacyVersion),
              leg.contentVersion ?? null,
              leg.importedAt,
              leg.rawJson,
              leg.contentHash,
            );
          }
          const draftEnvelope: ScopeDraftEnvelope = {
            deviceId: cmd.deviceId,
            baseRevision: nextRevision,
            savedAt: body.nowIso,
            drafts: extractScopeDrafts(cmd.scope, cmd.state),
          };
          const seq = this.appendProcessEvents(body.ownerId, cmd.scope, activeRunId, body.nowIso, body.preparedEvents);
          this.state.storage.sql.exec(
            "INSERT OR REPLACE INTO scope_runs (scope, run_id, is_active, revision, content_version, provenance, state_json, draft_json, conflict_drafts_json, archived_at, archive_reason, updated_at, last_server_seq) VALUES (?, ?, 1, ?, ?, 'browser-import', ?, ?, '[]', NULL, NULL, ?, ?)",
            cmd.scope,
            activeRunId,
            nextRevision,
            cmd.contentVersion,
            JSON.stringify(cmd.state),
            JSON.stringify(draftEnvelope),
            body.nowIso,
            seq,
          );
        }

        const nextEnvelope = this.readScopeEnvelope(body.ownerId, cmd.scope, "contentVersion" in cmd ? cmd.contentVersion : currentEnvelope.contentVersion);
        const responseObj = {
          ok: true as const,
          idempotentReplay: false,
          commandId: cmd.commandId,
          envelope: nextEnvelope,
        };
        this.state.storage.sql.exec(
          "INSERT INTO command_log (owner_id, command_id, payload_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)",
          body.ownerId,
          cmd.commandId,
          body.payloadHash,
          JSON.stringify(responseObj),
          body.nowIso,
        );
        return { status: 200, payload: responseObj };
      });

      return json(outcome.payload, outcome.status);
    }

    if (request.method === "GET" && url.pathname === "/export") {
      const ownerId = url.searchParams.get("ownerId") ?? "";
      const fromSeqParam = Number(url.searchParams.get("fromServerSeq") ?? "1");
      const fromServerSeq = Number.isSafeInteger(fromSeqParam) && fromSeqParam >= 1 ? fromSeqParam : 1;
      const nowIso = url.searchParams.get("nowIso") ?? new Date().toISOString();
      const explicitBundleId = url.searchParams.get("bundleId");

      const rawData = this.state.storage.transactionSync(() => {
        const meta = this.ensureMeta(ownerId);
        if (explicitBundleId) {
          const existing = this.state.storage.sql
            .exec("SELECT bundle_json FROM exported_bundles WHERE bundle_id = ? AND owner_id = ?", explicitBundleId, ownerId)
            .toArray();
          if (existing.length > 0) {
            return { cachedBundle: JSON.parse(String(existing[0].bundle_json)) as WebProcessBundle };
          }
        }
        const eventRows = this.state.storage.sql
          .exec(
            "SELECT server_seq, event_id, owner_id, scope, run_id, received_at, client_seq, client_at, provenance, content_version, target_id, question_id, canonical_problem_id, canonical_mapped, kind, payload_json, event_hash FROM process_events WHERE owner_id = ? AND server_seq >= ? ORDER BY server_seq ASC",
            ownerId,
            fromServerSeq,
          )
          .toArray();
        const events: ServerProcessEvent[] = eventRows.map(r => ({
          serverSeq: Number(r.server_seq),
          eventId: String(r.event_id),
          ownerId: String(r.owner_id),
          scope: String(r.scope),
          runId: String(r.run_id),
          receivedAt: String(r.received_at),
          clientSeq: r.client_seq === null ? null : Number(r.client_seq),
          clientAt: r.client_at === null ? null : String(r.client_at),
          provenance: String(r.provenance) as RecordProvenance,
          contentVersion: String(r.content_version),
          ...(r.target_id !== null ? { targetId: String(r.target_id) } : {}),
          ...(r.question_id !== null ? { questionId: String(r.question_id) } : {}),
          ...(r.canonical_problem_id !== null ? { canonicalProblemId: String(r.canonical_problem_id) } : {}),
          ...(r.canonical_mapped !== null ? { canonicalMapped: Number(r.canonical_mapped) === 1 } : {}),
          kind: String(r.kind),
          payload: JSON.parse(String(r.payload_json)) as Record<string, unknown>,
          eventHash: String(r.event_hash),
        }));

        const matRows = this.state.storage.sql.exec("SELECT snapshot_json FROM material_snapshots ORDER BY scope ASC, content_version ASC").toArray();
        const materialSnapshots = matRows.map(r => JSON.parse(String(r.snapshot_json)) as StoredMaterialSnapshot);

        const legRows = this.state.storage.sql
          .exec("SELECT import_id, owner_id, scope, run_id, storage_key, legacy_version, content_version, imported_at, raw_json, content_hash FROM legacy_imports WHERE owner_id = ? ORDER BY imported_at ASC", ownerId)
          .toArray();
        const legacyImports: StoredLegacyImport[] = legRows.map(r => ({
          importId: String(r.import_id),
          ownerId: String(r.owner_id),
          scope: String(r.scope),
          runId: String(r.run_id),
          storageKey: String(r.storage_key),
          ...(r.legacy_version !== null ? { legacyVersion: (r.legacy_version === "ask" ? "ask" : Number(r.legacy_version)) as StoredLegacyImport["legacyVersion"] } : {}),
          ...(r.content_version !== null ? { contentVersion: String(r.content_version) } : {}),
          importedAt: String(r.imported_at),
          rawJson: String(r.raw_json),
          contentHash: String(r.content_hash),
        }));

        const activeRunRows = this.state.storage.sql
          .exec("SELECT scope, run_id, draft_json FROM scope_runs WHERE is_active = 1 AND draft_json IS NOT NULL ORDER BY scope ASC")
          .toArray();
        return {
          meta,
          events,
          materialSnapshots,
          legacyImports,
          activeRunRows,
        };
      });

      if ("cachedBundle" in rawData && rawData.cachedBundle) {
        return json(rawData.cachedBundle);
      }

      const draftSnapshots: ExportedDraftSnapshot[] = [];
      for (const row of rawData.activeRunRows) {
        const draftEnv = JSON.parse(String(row.draft_json)) as ScopeDraftEnvelope;
        const snapshotId = `draft-${String(row.scope)}-${String(row.run_id)}-${draftEnv.deviceId}-r${draftEnv.baseRevision}`;
        const baseDraft: Omit<ExportedDraftSnapshot, "contentHash" | "savedAt"> = {
          snapshotId,
          ownerId,
          scope: String(row.scope),
          runId: String(row.run_id),
          deviceId: draftEnv.deviceId,
          baseRevision: draftEnv.baseRevision,
          unsubmittedDraft: true,
          drafts: draftEnv.drafts,
        };
        const contentHash = await computeDraftSnapshotHash(baseDraft);
        draftSnapshots.push({
          ...baseDraft,
          savedAt: draftEnv.savedAt,
          contentHash,
        });
      }

      const toServerSeq = rawData.events.length > 0 ? rawData.events.at(-1)!.serverSeq : Math.max(fromServerSeq - 1, rawData.meta.lastServerSeq);
      const effectiveFromSeq = rawData.events.length > 0 ? rawData.events[0].serverSeq : Math.min(fromServerSeq, toServerSeq);
      const bundleId = explicitBundleId && isValidId(explicitBundleId)
        ? explicitBundleId
        : `bundle-${rawData.meta.storageGeneration.slice(0, 16)}-${effectiveFromSeq}-${toServerSeq}`;

      const baseBundle: Omit<WebProcessBundle, "bundleHash"> = {
        schemaVersion: "web-process-v1",
        bundleId,
        ownerId,
        storageGeneration: rawData.meta.storageGeneration,
        exportedAt: nowIso,
        fromServerSeq: effectiveFromSeq,
        toServerSeq,
        events: rawData.events,
        materialSnapshots: rawData.materialSnapshots,
        legacyImports: rawData.legacyImports,
        draftSnapshots,
      };
      const bundleHash = await computeBundleHash(baseBundle);
      const bundle: WebProcessBundle = { ...baseBundle, bundleHash };

      this.state.storage.transactionSync(() => {
        this.state.storage.sql.exec(
          "INSERT OR REPLACE INTO exported_bundles (bundle_id, owner_id, storage_generation, exported_at, from_server_seq, to_server_seq, bundle_hash, bundle_json, ack_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT ack_json FROM exported_bundles WHERE bundle_id = ?), NULL))",
          bundle.bundleId,
          bundle.ownerId,
          bundle.storageGeneration,
          bundle.exportedAt,
          bundle.fromServerSeq,
          bundle.toServerSeq,
          bundle.bundleHash,
          JSON.stringify(bundle),
          bundle.bundleId,
        );
      });

      return json(bundle);
    }

    if (request.method === "POST" && url.pathname === "/ack") {
      const body = (await request.json()) as { ownerId: string; receipt: WebProcessAckReceipt };
      const outcome = this.state.storage.transactionSync(() => {
        const meta = this.ensureMeta(body.ownerId);
        if (body.receipt.ownerId !== body.ownerId) {
          return { status: 403, payload: { ok: false, code: "owner_mismatch", detail: "수신 확인 소유자가 일치하지 않습니다." } };
        }
        if (body.receipt.storageGeneration !== meta.storageGeneration) {
          return {
            status: 409,
            payload: {
              ok: false,
              code: "generation_mismatch",
              detail: "저장소 세대(storageGeneration)가 달라 수신 확인을 바로 반영하지 않았습니다. 사건 ID 기준으로 다시 대조해 주세요.",
            },
          };
        }
        const exported = this.state.storage.sql
          .exec("SELECT bundle_hash, to_server_seq FROM exported_bundles WHERE bundle_id = ? AND owner_id = ?", body.receipt.bundleId, body.ownerId)
          .toArray();
        if (!exported.length) {
          return { status: 404, payload: { ok: false, code: "bundle_not_found", detail: "내보낸 묶음 기록을 찾지 못했습니다." } };
        }
        if (String(exported[0].bundle_hash) !== body.receipt.bundleHash || Number(exported[0].to_server_seq) !== body.receipt.toServerSeq) {
          return { status: 409, payload: { ok: false, code: "hash_mismatch", detail: "내보낸 묶음의 해시나 순번 범위가 수신 확인과 맞지 않습니다." } };
        }
        this.state.storage.sql.exec(
          "UPDATE exported_bundles SET ack_json = ? WHERE bundle_id = ? AND owner_id = ?",
          JSON.stringify(body.receipt),
          body.receipt.bundleId,
          body.ownerId,
        );
        if (body.receipt.toServerSeq >= meta.lastAckedServerSeq) {
          this.setMeta("last_acked_server_seq", String(body.receipt.toServerSeq));
          this.setMeta("last_acked_bundle_id", body.receipt.bundleId);
          this.setMeta("last_acked_at", body.receipt.ackedAt);
        }
        return {
          status: 200,
          payload: {
            ok: true,
            canonicalExport: this.buildCanonicalStatus(body.ownerId),
          },
        };
      });
      return json(outcome.payload, outcome.status);
    }

    if (url.pathname === "/execution") {
      if (request.method === "GET") {
        const ownerId = url.searchParams.get("ownerId") ?? "";
        const scope = url.searchParams.get("scope") ?? "";
        const requestId = url.searchParams.get("requestId") ?? "";
        const rows = this.state.storage.sql
          .exec(
            "SELECT request_id, attempt_id, scope, target_id, kind, status, created_at, updated_at, response_json, error_code, error_message FROM external_executions WHERE owner_id = ? AND scope = ? AND request_id = ?",
            ownerId,
            scope,
            requestId,
          )
          .toArray();
        if (!rows.length) return json({ ok: false, code: "not_found", detail: "해당 실행 기록을 찾지 못했습니다." }, 404);
        const r = rows[0];
        const record: ExternalExecutionRecord = {
          requestId: String(r.request_id),
          attemptId: String(r.attempt_id),
          scope: String(r.scope),
          targetId: String(r.target_id),
          kind: String(r.kind) as ExternalExecutionKind,
          status: String(r.status) as ExternalExecutionStatus,
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
          ...(r.response_json !== null ? { responsePayload: JSON.parse(String(r.response_json)) } : {}),
          ...(r.error_code !== null ? { errorCode: String(r.error_code) } : {}),
          ...(r.error_message !== null ? { errorMessage: String(r.error_message) } : {}),
        };
        return json({ ok: true, execution: record });
      }

      if (request.method === "POST") {
        const body = (await request.json()) as {
          action: "begin" | "complete" | "fail";
          ownerId: string;
          scope: RecordScope;
          requestId: string;
          attemptId: string;
          targetId: string;
          kind: ExternalExecutionKind;
          nowIso: string;
          responsePayload?: unknown;
          status?: "failed" | "unknown";
          errorCode?: string;
          errorMessage?: string;
        };
        const result = this.state.storage.transactionSync(() => {
          this.ensureMeta(body.ownerId);
          if (body.action === "begin") {
            const existing = this.state.storage.sql
              .exec("SELECT status, response_json FROM external_executions WHERE owner_id = ? AND scope = ? AND request_id = ?", body.ownerId, body.scope, body.requestId)
              .toArray();
            if (existing.length > 0 && String(existing[0].status) === "succeeded" && existing[0].response_json !== null) {
              return { cachedResponse: JSON.parse(String(existing[0].response_json)) };
            }
            this.state.storage.sql.exec(
              "INSERT OR REPLACE INTO external_executions (owner_id, scope, request_id, attempt_id, target_id, kind, status, created_at, updated_at, response_json, error_code, error_message) VALUES (?, ?, ?, ?, ?, ?, 'dispatching', COALESCE((SELECT created_at FROM external_executions WHERE owner_id = ? AND scope = ? AND request_id = ?), ?), ?, NULL, NULL, NULL)",
              body.ownerId,
              body.scope,
              body.requestId,
              body.attemptId,
              body.targetId,
              body.kind,
              body.ownerId,
              body.scope,
              body.requestId,
              body.nowIso,
              body.nowIso,
            );
            return { cachedResponse: null };
          }
          if (body.action === "complete") {
            this.state.storage.sql.exec(
              "UPDATE external_executions SET status = 'succeeded', response_json = ?, updated_at = ?, error_code = NULL, error_message = NULL WHERE owner_id = ? AND scope = ? AND request_id = ?",
              JSON.stringify(body.responsePayload),
              body.nowIso,
              body.ownerId,
              body.scope,
              body.requestId,
            );
            return { ok: true };
          }
          this.state.storage.sql.exec(
            "UPDATE external_executions SET status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE owner_id = ? AND scope = ? AND request_id = ?",
            body.status ?? "failed",
            body.errorCode ?? null,
            body.errorMessage ?? null,
            body.nowIso,
            body.ownerId,
            body.scope,
            body.requestId,
          );
          return { ok: true };
        });
        return json(result);
      }
    }

    return json({ ok: false, detail: "지원하지 않는 내부 경로입니다." }, 404);
  }
}

function getLearnerStub(env: LearnerRecordEnv, ownerId: string): { fetch(request: Request): Promise<Response> } {
  if (!env.LEARNER_RECORDS || typeof env.LEARNER_RECORDS.idFromName !== "function" || typeof env.LEARNER_RECORDS.get !== "function") {
    throw new AccessAuthError(503, "access_unconfigured", "개인 기록 보관소가 아직 연결되지 않았습니다.");
  }
  return env.LEARNER_RECORDS.get(env.LEARNER_RECORDS.idFromName(ownerId));
}

async function prepareCommandData(
  ownerId: string,
  command: LearnerRecordCommand,
  nowIso: string,
): Promise<{
  payloadHash: string;
  materialSnapshots: StoredMaterialSnapshot[];
  preparedEvents: (Omit<ServerProcessEvent, "serverSeq" | "receivedAt">)[];
  preparedLegacyImports: StoredLegacyImport[];
}> {
  const payloadHash = await sha256Hex(command);
  const contentVersion = "contentVersion" in command ? command.contentVersion : ASK_CONTENT_VERSION;
  const stateForMaterials =
    command.action === "sync_state" || command.action === "import_browser_records"
      ? command.state
      : command.action === "archive_and_start_run"
        ? command.initialState
        : undefined;
  const materialSnapshots = await buildMaterialSnapshotsForState(command.scope, contentVersion, stateForMaterials, nowIso);

  const rawEvents: ExtractedDomainEvent[] = [];
  const provenance: RecordProvenance = command.action === "import_browser_records" ? "browser-import" : "authenticated-live";
  const clientSeq = command.action === "import_browser_records" ? null : command.clientSeq;
  const defaultClientAt = command.action === "import_browser_records" ? null : (command.clientAt ?? null);

  if (command.action === "sync_state" || command.action === "import_browser_records") {
    rawEvents.push(...extractStateDomainEvents(command.scope, command.state, command.contentVersion));
    if (command.action === "sync_state" && command.event) {
      const ev: ProcessEventInput = command.event;
      const canonical = ev.questionId ? resolveCanonicalProblemId(command.scope, ev.questionId) : undefined;
      rawEvents.push({
        eventId: ev.eventId ?? `cmd-${command.commandId}`,
        kind: ev.kind,
        contentVersion: command.contentVersion,
        ...(ev.targetId ? { targetId: ev.targetId } : {}),
        ...(ev.questionId ? { questionId: ev.questionId } : {}),
        ...(canonical ? { canonicalProblemId: canonical.canonicalProblemId, canonicalMapped: canonical.mapped } : {}),
        clientAt: defaultClientAt,
        payload: ev.payload ?? {},
      });
    }
  } else if (command.action === "archive_and_start_run") {
    rawEvents.push({
      eventId: `run-start-${command.newRunId}`,
      kind: "run-started",
      contentVersion: command.contentVersion,
      clientAt: defaultClientAt,
      payload: { reason: command.reason, previousRunId: command.runId, newRunId: command.newRunId },
    });
  } else if (command.action === "restore_archived_run") {
    rawEvents.push({
      eventId: `run-restore-${command.commandId}`,
      kind: "run-restored",
      contentVersion: ASK_CONTENT_VERSION,
      clientAt: defaultClientAt,
      payload: { previousRunId: command.runId, restoredRunId: command.targetRunId },
    });
  } else if (command.action === "resolve_conflict") {
    rawEvents.push({
      eventId: `conflict-resolve-${command.commandId}`,
      kind: "conflict-resolved",
      contentVersion: ASK_CONTENT_VERSION,
      clientAt: defaultClientAt,
      payload: { resolution: command.resolution, conflictDeviceId: command.conflictDeviceId },
    });
  }

  const preparedEvents: (Omit<ServerProcessEvent, "serverSeq" | "receivedAt">)[] = [];
  for (const item of rawEvents) {
    const baseEvent: Omit<ServerProcessEvent, "eventHash" | "serverSeq" | "receivedAt"> = {
      eventId: item.eventId,
      ownerId,
      scope: command.scope,
      runId: command.action === "archive_and_start_run" ? command.newRunId : command.action === "restore_archived_run" ? command.targetRunId : command.runId,
      clientSeq,
      clientAt: item.clientAt !== undefined ? item.clientAt : defaultClientAt,
      provenance,
      contentVersion: item.contentVersion,
      ...(item.targetId ? { targetId: item.targetId } : {}),
      ...(item.questionId ? { questionId: item.questionId } : {}),
      ...(item.canonicalProblemId ? { canonicalProblemId: item.canonicalProblemId, canonicalMapped: item.canonicalMapped } : {}),
      kind: item.kind,
      payload: item.payload,
    };
    const eventHash = await computeEventHash(baseEvent);
    preparedEvents.push({ ...baseEvent, eventHash });
  }

  const preparedLegacyImports: StoredLegacyImport[] = [];
  if (command.action === "import_browser_records") {
    for (const rawItem of command.rawItems) {
      const importHash = await sha256Hex({ scope: rawItem.scope, storageKey: rawItem.storageKey, rawJson: rawItem.rawJson });
      const importId = `import-${rawItem.scope}-${importHash.slice(0, 16)}`;
      const baseImport: Omit<StoredLegacyImport, "contentHash" | "importedAt"> = {
        importId,
        ownerId,
        scope: rawItem.scope,
        runId: command.runId,
        storageKey: rawItem.storageKey,
        ...(rawItem.legacyVersion !== undefined ? { legacyVersion: rawItem.legacyVersion } : {}),
        ...(rawItem.contentVersion !== undefined ? { contentVersion: rawItem.contentVersion } : {}),
        rawJson: rawItem.rawJson,
      };
      const contentHash = await computeLegacyImportHash(baseImport);
      preparedLegacyImports.push({
        ...baseImport,
        importedAt: nowIso,
        contentHash,
      });
    }
  }

  return { payloadHash, materialSnapshots, preparedEvents, preparedLegacyImports };
}

function errorResponse(error: unknown): Response {
  if (error instanceof AccessAuthError) {
    return json(
      { ok: false, authenticated: false, code: error.code, detail: error.message },
      error.status,
    );
  }
  if (error instanceof BundleVerificationError) {
    return json(
      { ok: false, code: error.code, detail: error.message },
      400,
    );
  }
  return json(
    { ok: false, code: "unavailable", detail: "개인 기록 보관 서버가 응답하지 못했습니다. 잠시 뒤 다시 시도해 주세요." },
    503,
  );
}

export async function handleLearnerRecords(
  request: Request,
  env: LearnerRecordEnv,
  dependencies: AccessAuthDependencies = {},
): Promise<Response> {
  try {
    if (request.method !== "GET" && request.method !== "POST") {
      return json({ ok: false, code: "invalid_request", detail: "GET 또는 POST 요청만 지원합니다." }, 405, { Allow: "GET, POST" });
    }
    const owner = await verifyOwnerRequest(request, env, dependencies);
    const stub = getLearnerStub(env, owner.ownerId);

    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.searchParams.has("returnTo")) {
        const rawReturnTo = url.searchParams.get("returnTo") ?? "/";
        const safeReturnTo = rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//") ? rawReturnTo : "/";
        const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>개인 서버 보관 연결</title></head><body><script>try{window.sessionStorage.setItem("es:personal-sync-enabled:v1","1");}catch{}window.location.replace(${JSON.stringify(safeReturnTo)});</script><p>개인 서버 보관 인증이 확인되었습니다. 학습 화면으로 돌아갑니다…</p></body></html>`;
        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      }
      const scope = url.searchParams.get("scope") ?? ARTIFACT_LESSON_ID;
      if (!isRecordScope(scope)) {
        return json({ ok: false, code: "invalid_request", detail: "유효한 기록 범위(scope)를 지정해 주세요." }, 400);
      }
      let defaultVersion: string = ASK_CONTENT_VERSION;
      if (scope === ARTIFACT_LESSON_ID) {
        defaultVersion = (await getPublicLearningCatalog()).contentVersion;
      } else if (scope !== ASK_RECORD_SCOPE) {
        defaultVersion = (await getPublicLesson(scope)).contentVersion;
      }
      return await stub.fetch(
        new Request(`https://records.internal/scope?ownerId=${encodeURIComponent(owner.ownerId)}&scope=${encodeURIComponent(scope)}&defaultContentVersion=${encodeURIComponent(defaultVersion)}`),
      );
    }

    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return json({ ok: false, code: "invalid_request", detail: "JSON 형식으로 저장 명령을 보내 주세요." }, 415);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBoundedText(request.body, MAX_COMMAND_BODY_BYTES));
    } catch (err) {
      if (err instanceof Error && err.message === "body_limit") {
        return json({ ok: false, code: "invalid_request", detail: "저장할 기록 크기가 한도를 넘었습니다." }, 413);
      }
      return json({ ok: false, code: "invalid_request", detail: "저장 명령 JSON을 읽지 못했습니다." }, 400);
    }
    if (isObject(parsed) && ("ownerId" in parsed || "userId" in parsed || "email" in parsed)) {
      return json({ ok: false, code: "invalid_request", detail: "소유자 식별자는 요청 본문으로 지정할 수 없습니다." }, 400);
    }
    if (!isLearnerRecordCommand(parsed)) {
      return json({ ok: false, code: "invalid_request", detail: "저장 명령의 형식이나 상태 계약이 올바르지 않습니다." }, 400);
    }

    const nowIso = (dependencies.now?.() ?? new Date()).toISOString();
    const prepared = await prepareCommandData(owner.ownerId, parsed, nowIso);
    return await stub.fetch(
      new Request("https://records.internal/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId: owner.ownerId,
          command: parsed,
          nowIso,
          ...prepared,
        }),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLearnerRecordExport(
  request: Request,
  env: LearnerRecordEnv,
  dependencies: AccessAuthDependencies = {},
): Promise<Response> {
  try {
    if (request.method !== "GET") {
      return json({ ok: false, code: "invalid_request", detail: "GET 요청으로 내보내기를 호출해 주세요." }, 405, { Allow: "GET" });
    }
    const owner = await verifyOwnerRequest(request, env, dependencies);
    const stub = getLearnerStub(env, owner.ownerId);
    const url = new URL(request.url);
    const fromServerSeq = url.searchParams.get("fromServerSeq") ?? "1";
    const bundleId = url.searchParams.get("bundleId");
    const nowIso = (dependencies.now?.() ?? new Date()).toISOString();
    const internalUrl = new URL("https://records.internal/export");
    internalUrl.searchParams.set("ownerId", owner.ownerId);
    internalUrl.searchParams.set("fromServerSeq", fromServerSeq);
    internalUrl.searchParams.set("nowIso", nowIso);
    if (bundleId) internalUrl.searchParams.set("bundleId", bundleId);
    return await stub.fetch(new Request(internalUrl.toString()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLearnerRecordAck(
  request: Request,
  env: LearnerRecordEnv,
  dependencies: AccessAuthDependencies = {},
): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return json({ ok: false, code: "invalid_request", detail: "POST 요청으로 수신 확인을 보내 주세요." }, 405, { Allow: "POST" });
    }
    const owner = await verifyOwnerRequest(request, env, dependencies);
    const stub = getLearnerStub(env, owner.ownerId);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return json({ ok: false, code: "invalid_request", detail: "JSON 형식으로 수신 확인을 보내 주세요." }, 415);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBoundedText(request.body, 64 * 1024));
    } catch {
      return json({ ok: false, code: "invalid_request", detail: "수신 확인 본문을 읽지 못했습니다." }, 400);
    }
    if (!isWebProcessAckReceipt(parsed)) {
      return json({ ok: false, code: "invalid_request", detail: "수신 확인 형식이 올바르지 않습니다." }, 400);
    }
    return await stub.fetch(
      new Request("https://records.internal/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: owner.ownerId, receipt: parsed }),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLearnerRecordExecutions(
  request: Request,
  env: LearnerRecordEnv,
  dependencies: AccessAuthDependencies = {},
): Promise<Response> {
  try {
    if (request.method !== "GET") {
      return json({ ok: false, code: "invalid_request", detail: "GET 요청으로 실행 결과를 조회해 주세요." }, 405, { Allow: "GET" });
    }
    const owner = await verifyOwnerRequest(request, env, dependencies);
    const stub = getLearnerStub(env, owner.ownerId);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "";
    const requestId = url.searchParams.get("requestId") ?? "";
    if (!isRecordScope(scope) || !isValidId(requestId)) {
      return json({ ok: false, code: "invalid_request", detail: "유효한 scope와 requestId를 지정해 주세요." }, 400);
    }
    const internalUrl = new URL("https://records.internal/execution");
    internalUrl.searchParams.set("ownerId", owner.ownerId);
    internalUrl.searchParams.set("scope", scope);
    internalUrl.searchParams.set("requestId", requestId);
    return await stub.fetch(new Request(internalUrl.toString()));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Optional server-side execution tracker used by paid AI endpoints (`/api/learn-chat/`, `/api/explain/`, `/api/translate/`, `/api/ask-followup/`).
 * Only activates when the request has a verified owner Access token and `LEARNER_RECORDS` is bound.
 * Never blocks public unauthenticated AI calls.
 */
export async function trackOwnerAiExecution<T>(
  request: Request,
  env: LearnerRecordEnv,
  dependencies: AccessAuthDependencies,
  meta: { scope: RecordScope; requestId: string; targetId: string; kind: ExternalExecutionKind },
  execute: () => Promise<T>,
): Promise<T> {
  let ownerId: string | null = null;
  let stub: { fetch(request: Request): Promise<Response> } | null = null;
  try {
    const owner = await verifyOwnerRequest(request, env, dependencies);
    stub = getLearnerStub(env, owner.ownerId);
    ownerId = owner.ownerId;
  } catch {
    ownerId = null;
    stub = null;
  }

  if (!ownerId || !stub) {
    return await execute();
  }

  const nowIso = () => (dependencies.now?.() ?? new Date()).toISOString();
  const attemptId = `exec-${meta.requestId}`;

  try {
    const beginRes = await stub.fetch(
      new Request("https://records.internal/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "begin",
          ownerId,
          scope: meta.scope,
          requestId: meta.requestId,
          attemptId,
          targetId: meta.targetId,
          kind: meta.kind,
          nowIso: nowIso(),
        }),
      }),
    );
    if (beginRes.ok) {
      const beginData = (await beginRes.json()) as { cachedResponse?: unknown };
      if (beginData.cachedResponse && isValidExecutionResponsePayload(meta.kind, beginData.cachedResponse)) {
        return beginData.cachedResponse as T;
      }
    }
  } catch {
    // Do not fail the AI call if tracking begin fails
  }

  try {
    const result = await execute();
    try {
      await stub.fetch(
        new Request("https://records.internal/execution", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "complete",
            ownerId,
            scope: meta.scope,
            requestId: meta.requestId,
            attemptId,
            targetId: meta.targetId,
            kind: meta.kind,
            nowIso: nowIso(),
            responsePayload: result,
          }),
        }),
      );
    } catch {
      // Result was produced; return it even if secondary persistence failed
    }
    return result;
  } catch (error) {
    const aborted = request.signal.aborted;
    try {
      await stub.fetch(
        new Request("https://records.internal/execution", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "fail",
            ownerId,
            scope: meta.scope,
            requestId: meta.requestId,
            attemptId,
            targetId: meta.targetId,
            kind: meta.kind,
            nowIso: nowIso(),
            status: aborted ? "unknown" : "failed",
            errorCode: aborted ? "cancelled" : "provider_error",
            errorMessage: error instanceof Error ? error.message.slice(0, 200) : "실행 실패",
          }),
        }),
      );
    } catch {
      // Ignore tracking failure
    }
    throw error;
  }
}

export { canonicalJson };
