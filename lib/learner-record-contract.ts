import { isAskFollowupResponse, isExplanation } from "./ask-contract";
import { restoreAskRecords, serializeAskRecords, validateAskRecords, type AskRecords } from "./ask-records";
import { ARTIFACT_LESSON_ID, LEARNING_QUESTION_IDS, type LearningQuestionId, type PublicLearningCatalog, type PublicLearningQuestion } from "./learning-catalog";
import { isArtifactLearningChatResponse, isLearningChatResponse } from "./learning-chat-contract";
import { isWorkspaceState, type WorkspaceState } from "./learning-workspace-state";
import { isLessonChatResponse } from "./lesson-chat-contract";
import { isLessonState, type LessonState } from "./lesson-workspace-state";
import { getLessonEntry, LESSONS, LESSON_ID_PATTERN, type PublicCardsLesson, type PublicStoryLesson } from "./lesson-registry";

export const LEARNER_RECORDS_ENDPOINT = "/api/learner-records/";
export const LEARNER_RECORDS_EXPORT_ENDPOINT = "/api/learner-records/export/";
export const LEARNER_RECORDS_ACK_ENDPOINT = "/api/learner-records/ack/";
export const LEARNER_RECORDS_EXECUTIONS_ENDPOINT = "/api/learner-records/executions/";

export const ASK_RECORD_SCOPE = "ask" as const;
export const ASK_CONTENT_VERSION = "ask-v1" as const;

/**
 * Explicit mapping from web `titanic-have` question IDs to canonical `study-and-learn` problem IDs
 * verified against `study-and-learn/content/scene-sense/problems.jsonl` (chapter, speaker, scene, options/target).
 */
export const HAVE_CANONICAL_PROBLEM_IDS: Readonly<Record<LearningQuestionId, string>> = {
  "titanic-have-1": "have-1-choose-1",
  "titanic-have-2": "have-1-choose-2",
  "titanic-have-3": "have-1-choose-3",
  "titanic-have-4": "have-1-retrieve-1",
  "titanic-have-5": "have-1-retrieve-2",
  "titanic-have-6": "have-1-produce-1",
  "titanic-have-7": "have-1-produce-2",
};

export function resolveCanonicalProblemId(scope: string, questionId: string): { canonicalProblemId: string; mapped: boolean } {
  if (scope === ARTIFACT_LESSON_ID) {
    const mappedId = (HAVE_CANONICAL_PROBLEM_IDS as Readonly<Record<string, string>>)[questionId];
    return mappedId ? { canonicalProblemId: mappedId, mapped: true } : { canonicalProblemId: questionId, mapped: false };
  }
  const entry = getLessonEntry(scope);
  if (entry && entry.kind !== "scene" && entry.questionIds.includes(questionId)) {
    return { canonicalProblemId: questionId, mapped: true };
  }
  return { canonicalProblemId: questionId, mapped: false };
}

export type RecordScope = string;
export type RecordProvenance = "authenticated-live" | "browser-import";
export type ArchiveReason = "new-version" | "restart" | "manual-archive" | "legacy-import";
export type ScopedRecordState = WorkspaceState | LessonState | AskRecords;

export type PublicMaterialSnapshot =
  | ({ kind: "scene" } & PublicLearningCatalog)
  | PublicStoryLesson
  | PublicCardsLesson;

export type StoredMaterialSnapshot =
  | {
      scope: RecordScope;
      contentVersion: string;
      available: true;
      capturedAt: string;
      snapshotHash: string;
      material: PublicMaterialSnapshot;
    }
  | {
      scope: RecordScope;
      contentVersion: string;
      available: false;
      capturedAt: string;
      reason: "historical_version_unavailable";
      preservedQuestions: (PublicLearningQuestion | { questionId: string; snapshot: unknown })[];
    };

export type ArtifactDraftField = {
  artifactId: string;
  questionId: string;
  choice?: string | number | null;
  answerDraft?: string;
  reason?: string;
  inputs?: string[];
  revisionDraft?: string;
  messageDraft?: string;
  threadDrafts?: Record<string, string>;
};

export type ScopeDraftData =
  | { kind: "workspace"; artifacts: ArtifactDraftField[] }
  | { kind: "lesson"; selectedQuestionId: string | null; artifacts: ArtifactDraftField[] }
  | { kind: "ask"; selectedId: string | null; composer: AskRecords["composer"]; followupDrafts: Record<string, string> };

export type ScopeDraftEnvelope = {
  deviceId: string;
  baseRevision: number;
  clientAt?: string;
  savedAt: string;
  drafts: ScopeDraftData;
};

export type ArchivedRunSummary = {
  runId: string;
  scope: RecordScope;
  contentVersion: string;
  provenance: RecordProvenance;
  archivedAt: string;
  reason: ArchiveReason;
  revision: number;
  state: ScopedRecordState;
};

export type CanonicalExportStatus = {
  status: "no-records" | "pending-canonical-export" | "canonical-acknowledged";
  storageGeneration: string;
  lastServerSeq: number;
  lastAckedServerSeq: number;
  lastAckedBundleId: string | null;
  lastAckedAt: string | null;
};

export type ScopeRecordEnvelope = {
  authenticated: true;
  ownerId: string;
  scope: RecordScope;
  activeRunId: string;
  revision: number;
  contentVersion: string;
  provenance: RecordProvenance;
  updatedAt: string | null;
  lastServerSeq: number;
  state: ScopedRecordState | null;
  draftEnvelope: ScopeDraftEnvelope | null;
  conflictingDrafts: ScopeDraftEnvelope[];
  archivedRuns: ArchivedRunSummary[];
  materialSnapshots: Record<string, StoredMaterialSnapshot>;
  canonicalExport: CanonicalExportStatus;
};

export type ProcessEventInput = {
  eventId?: string;
  kind: string;
  targetId?: string;
  questionId?: string;
  payload?: Record<string, unknown>;
};

export type BrowserImportItem = {
  scope: RecordScope;
  storageKey: string;
  rawJson: string;
  legacyVersion?: 1 | 2 | 3 | 4 | "ask";
  contentVersion?: string;
};

export type LearnerRecordCommand = {
  commandId: string;
  scope: RecordScope;
  runId: string;
  expectedRevision: number;
  deviceId: string;
  clientSeq: number;
  clientAt?: string;
} & (
  | {
      action: "sync_state";
      contentVersion: string;
      state: ScopedRecordState;
      event?: ProcessEventInput;
    }
  | {
      action: "save_draft";
      contentVersion: string;
      drafts: ScopeDraftData;
    }
  | {
      action: "resolve_conflict";
      resolution: "keep_server" | "adopt_conflict_draft";
      conflictDeviceId: string;
    }
  | {
      action: "archive_and_start_run";
      reason: ArchiveReason;
      newRunId: string;
      contentVersion: string;
      initialState: ScopedRecordState;
    }
  | {
      action: "restore_archived_run";
      targetRunId: string;
    }
  | {
      action: "import_browser_records";
      contentVersion: string;
      state: ScopedRecordState;
      rawItems: BrowserImportItem[];
    }
);

export type LearnerRecordCommandResponse = {
  ok: true;
  idempotentReplay: boolean;
  commandId: string;
  envelope: ScopeRecordEnvelope;
};

export type LearnerRecordConflictResponse = {
  ok: false;
  code: "revision_conflict" | "command_conflict";
  detail: string;
  envelope?: ScopeRecordEnvelope;
};

export type ExternalExecutionStatus = "queued" | "dispatching" | "succeeded" | "failed" | "unknown";
export type ExternalExecutionKind = "learn-chat" | "explain" | "translate" | "ask-followup";

export type ExternalExecutionRecord = {
  requestId: string;
  attemptId: string;
  scope: RecordScope;
  targetId: string;
  kind: ExternalExecutionKind;
  status: ExternalExecutionStatus;
  createdAt: string;
  updatedAt: string;
  responsePayload?: unknown;
  errorCode?: string;
  errorMessage?: string;
};

const ID_PATTERN = /^[a-zA-Z0-9_:-]{1,120}$/;
const VERSION_PATTERN = /^([a-f0-9]{64}|ask-v1)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isRecordScope(value: unknown): value is RecordScope {
  if (typeof value !== "string") return false;
  if (value === ASK_RECORD_SCOPE) return true;
  return getLessonEntry(value) !== undefined;
}

export function isValidAskRecords(value: unknown): value is AskRecords {
  try {
    validateAskRecords(value);
    const roundtrip = restoreAskRecords(serializeAskRecords(value));
    return isRecord(roundtrip) && roundtrip.schema === 1;
  } catch {
    return false;
  }
}

export function isScopedRecordState(scope: RecordScope, value: unknown): value is ScopedRecordState {
  if (!isRecordScope(scope)) return false;
  if (scope === ARTIFACT_LESSON_ID) return isWorkspaceState(value);
  if (scope === ASK_RECORD_SCOPE) return isValidAskRecords(value);
  return isLessonState(value) && value.lessonId === scope;
}

export function extractScopeDrafts(scope: RecordScope, state: ScopedRecordState): ScopeDraftData {
  if (scope === ARTIFACT_LESSON_ID) {
    const ws = state as WorkspaceState;
    return {
      kind: "workspace",
      artifacts: ws.artifacts.map(artifact => ({
        artifactId: artifact.artifactId,
        questionId: artifact.question.questionId,
        choice: artifact.choice,
        answerDraft: artifact.answerDraft,
        reason: artifact.reason,
        revisionDraft: artifact.revisionDraft,
        messageDraft: artifact.messageDraft,
        threadDrafts: Object.fromEntries(
          artifact.threads.filter(t => typeof t.draft === "string" && t.draft.length > 0).map(t => [t.id, t.draft!]),
        ),
      })),
    };
  }
  if (scope === ASK_RECORD_SCOPE) {
    const ask = state as AskRecords;
    return {
      kind: "ask",
      selectedId: ask.selectedId,
      composer: { mode: ask.composer.mode, text: ask.composer.text },
      followupDrafts: Object.fromEntries(
        ask.entries.filter(entry => typeof entry.followupDraft === "string" && entry.followupDraft.length > 0).map(entry => [entry.id, entry.followupDraft!]),
      ),
    };
  }
  const lesson = state as LessonState;
  return {
    kind: "lesson",
    selectedQuestionId: lesson.selectedQuestionId,
    artifacts: lesson.artifacts.map(artifact => ({
      artifactId: artifact.artifactId,
      questionId: artifact.question.questionId,
      choice: artifact.choice,
      inputs: [...artifact.inputs],
      messageDraft: artifact.messageDraft,
      threadDrafts: Object.fromEntries(
        artifact.threads.filter(t => typeof t.draft === "string" && t.draft.length > 0).map(t => [t.id, t.draft!]),
      ),
    })),
  };
}

export function applyScopeDrafts(scope: RecordScope, state: ScopedRecordState, drafts: ScopeDraftData): ScopedRecordState {
  if (scope === ARTIFACT_LESSON_ID && drafts.kind === "workspace") {
    const ws = structuredClone(state as WorkspaceState);
    for (const draft of drafts.artifacts) {
      const target = ws.artifacts.find(a => a.artifactId === draft.artifactId || a.question.questionId === draft.questionId);
      if (!target) continue;
      if (!target.initialAttempt) {
        if (typeof draft.choice === "string" && ["", "0", "1", "2"].includes(draft.choice)) target.choice = draft.choice;
        if (typeof draft.answerDraft === "string") target.answerDraft = draft.answerDraft.slice(0, 2000);
        if (typeof draft.reason === "string") target.reason = draft.reason.slice(0, 2000);
      }
      if (typeof draft.revisionDraft === "string") {
        target.revisionDraft = draft.revisionDraft.slice(0, 2000);
        if (target.revisionDraft && target.initialAttempt) target.revisionOpen = true;
      }
      if (typeof draft.messageDraft === "string") target.messageDraft = draft.messageDraft.slice(0, 2000);
    }
    return isWorkspaceState(ws) ? ws : state;
  }
  if (scope === ASK_RECORD_SCOPE && drafts.kind === "ask") {
    const ask = structuredClone(state as AskRecords);
    if (drafts.composer && (drafts.composer.mode === "explain" || drafts.composer.mode === "translate") && typeof drafts.composer.text === "string" && [...drafts.composer.text].length <= 300) {
      ask.composer = { mode: drafts.composer.mode, text: drafts.composer.text };
    }
    if (drafts.selectedId === null || ask.entries.some(e => e.id === drafts.selectedId)) {
      ask.selectedId = drafts.selectedId;
    }
    for (const entry of ask.entries) {
      if (entry.status !== "succeeded") continue;
      const followup = drafts.followupDrafts[entry.id];
      if (typeof followup === "string" && [...followup].length <= 2000) {
        entry.followupDraft = followup;
      }
    }
    return isValidAskRecords(ask) ? ask : state;
  }
  if (scope !== ARTIFACT_LESSON_ID && scope !== ASK_RECORD_SCOPE && drafts.kind === "lesson") {
    const lesson = structuredClone(state as LessonState);
    const entry = getLessonEntry(scope);
    if (drafts.selectedQuestionId === null || (typeof drafts.selectedQuestionId === "string" && entry?.questionIds.includes(drafts.selectedQuestionId))) {
      lesson.selectedQuestionId = drafts.selectedQuestionId;
    }
    for (const draft of drafts.artifacts) {
      const target = lesson.artifacts.find(a => a.artifactId === draft.artifactId || a.question.questionId === draft.questionId);
      if (!target) continue;
      if ("options" in target.question) {
        if (target.attempts.length === 0 && (draft.choice === null || (typeof draft.choice === "number" && Number.isInteger(draft.choice) && draft.choice >= 0 && draft.choice < target.question.options.length))) {
          target.choice = draft.choice;
        }
      } else if (Array.isArray(draft.inputs) && draft.inputs.length === target.question.drill.blanks && draft.inputs.every(item => typeof item === "string" && [...item].length <= 100)) {
        target.inputs = [...draft.inputs];
      }
      if (typeof draft.messageDraft === "string" && [...draft.messageDraft].length <= 2000) {
        target.messageDraft = draft.messageDraft;
      }
    }
    return isLessonState(lesson) ? lesson : state;
  }
  return state;
}

export function isScopeDraftData(scope: RecordScope, value: unknown): value is ScopeDraftData {
  if (!isRecord(value)) return false;
  if (scope === ARTIFACT_LESSON_ID) {
    return value.kind === "workspace" && Array.isArray(value.artifacts) && value.artifacts.length <= LEARNING_QUESTION_IDS.length && value.artifacts.every(item => isRecord(item) && isValidId(item.artifactId) && isValidId(item.questionId));
  }
  if (scope === ASK_RECORD_SCOPE) {
    return value.kind === "ask" && (value.selectedId === null || isValidId(value.selectedId)) && isRecord(value.composer) && (value.composer.mode === "explain" || value.composer.mode === "translate") && typeof value.composer.text === "string" && [...value.composer.text].length <= 300 && isRecord(value.followupDrafts) && Object.entries(value.followupDrafts).every(([k, v]) => isValidId(k) && typeof v === "string" && [...v].length <= 2000);
  }
  const entry = getLessonEntry(scope);
  if (!entry || entry.kind === "scene") return false;
  return value.kind === "lesson" && (value.selectedQuestionId === null || (typeof value.selectedQuestionId === "string" && entry.questionIds.includes(value.selectedQuestionId))) && Array.isArray(value.artifacts) && value.artifacts.length <= entry.questionIds.length && value.artifacts.every(item => isRecord(item) && isValidId(item.artifactId) && isValidId(item.questionId));
}

export function isLearnerRecordCommand(value: unknown): value is LearnerRecordCommand {
  if (!isRecord(value)) return false;
  if (!isValidId(value.commandId) || !isRecordScope(value.scope) || !isValidId(value.runId) || !isValidId(value.deviceId)) return false;
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) return false;
  if (!Number.isSafeInteger(value.clientSeq) || (value.clientSeq as number) < 0) return false;
  if (value.clientAt !== undefined && (typeof value.clientAt !== "string" || Number.isNaN(Date.parse(value.clientAt)))) return false;

  const scope = value.scope;
  if (value.action === "sync_state") {
    if (typeof value.contentVersion !== "string" || !VERSION_PATTERN.test(value.contentVersion)) return false;
    if (!isScopedRecordState(scope, value.state)) return false;
    if (value.event !== undefined) {
      if (!isRecord(value.event) || typeof value.event.kind !== "string" || !/^[a-zA-Z0-9_-]{1,60}$/.test(value.event.kind)) return false;
      if (value.event.eventId !== undefined && !isValidId(value.event.eventId)) return false;
      if (value.event.targetId !== undefined && !isValidId(value.event.targetId)) return false;
      if (value.event.questionId !== undefined && !isValidId(value.event.questionId)) return false;
      if (value.event.payload !== undefined && !isRecord(value.event.payload)) return false;
    }
    return true;
  }
  if (value.action === "save_draft") {
    return typeof value.contentVersion === "string" && VERSION_PATTERN.test(value.contentVersion) && isScopeDraftData(scope, value.drafts);
  }
  if (value.action === "resolve_conflict") {
    return (value.resolution === "keep_server" || value.resolution === "adopt_conflict_draft") && isValidId(value.conflictDeviceId);
  }
  if (value.action === "archive_and_start_run") {
    return ["new-version", "restart", "manual-archive", "legacy-import"].includes(value.reason as string)
      && isValidId(value.newRunId)
      && typeof value.contentVersion === "string"
      && VERSION_PATTERN.test(value.contentVersion)
      && isScopedRecordState(scope, value.initialState);
  }
  if (value.action === "restore_archived_run") {
    return isValidId(value.targetRunId);
  }
  if (value.action === "import_browser_records") {
    if (typeof value.contentVersion !== "string" || !VERSION_PATTERN.test(value.contentVersion)) return false;
    if (!isScopedRecordState(scope, value.state)) return false;
    if (!Array.isArray(value.rawItems) || value.rawItems.length < 1 || value.rawItems.length > 10) return false;
    return value.rawItems.every(item =>
      isRecord(item) && isRecordScope(item.scope) && typeof item.storageKey === "string" && item.storageKey.length > 0 && item.storageKey.length <= 120
      && typeof item.rawJson === "string" && item.rawJson.length > 0 && item.rawJson.length <= 512 * 1024,
    );
  }
  return false;
}

export function isValidExecutionResponsePayload(kind: ExternalExecutionKind, payload: unknown): boolean {
  if (kind === "explain" || kind === "translate") return isExplanation(payload);
  if (kind === "ask-followup") return isAskFollowupResponse(payload);
  if (kind === "learn-chat") return isLearningChatResponse(payload) || isArtifactLearningChatResponse(payload) || isLessonChatResponse(payload);
  return false;
}

export const ALL_RECORD_SCOPES: readonly RecordScope[] = [
  ...LESSONS.map(lesson => lesson.lessonId),
  ASK_RECORD_SCOPE,
];
export { LESSON_ID_PATTERN };
