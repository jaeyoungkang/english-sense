import {
  isRecordScope,
  isScopeDraftData,
  isValidId,
  type RecordProvenance,
  type RecordScope,
  type ScopeDraftData,
  type StoredMaterialSnapshot,
} from "./learner-record-contract";

export type ServerProcessEvent = {
  eventId: string;
  ownerId: string;
  scope: RecordScope;
  runId: string;
  serverSeq: number;
  receivedAt: string;
  clientSeq: number | null;
  clientAt: string | null;
  provenance: RecordProvenance;
  contentVersion: string;
  targetId?: string;
  questionId?: string;
  canonicalProblemId?: string;
  canonicalMapped?: boolean;
  kind: string;
  payload: Record<string, unknown>;
  eventHash: string;
};

export type StoredLegacyImport = {
  importId: string;
  ownerId: string;
  scope: RecordScope;
  runId: string;
  storageKey: string;
  legacyVersion?: 1 | 2 | 3 | 4 | "ask";
  contentVersion?: string;
  importedAt: string;
  rawJson: string;
  contentHash: string;
};

export type ExportedDraftSnapshot = {
  snapshotId: string;
  ownerId: string;
  scope: RecordScope;
  runId: string;
  deviceId: string;
  baseRevision: number;
  savedAt: string;
  unsubmittedDraft: true;
  drafts: ScopeDraftData;
  contentHash: string;
};

export type WebProcessBundle = {
  schemaVersion: "web-process-v1";
  bundleId: string;
  ownerId: string;
  storageGeneration: string;
  exportedAt: string;
  fromServerSeq: number;
  toServerSeq: number;
  events: ServerProcessEvent[];
  materialSnapshots: StoredMaterialSnapshot[];
  legacyImports: StoredLegacyImport[];
  draftSnapshots: ExportedDraftSnapshot[];
  bundleHash: string;
};

export type CanonicalDeduplicatedRef = {
  itemType: "event" | "material" | "legacy" | "draft";
  key: string;
  contentHash: string;
  existingBundleId: string;
};

export type CanonicalProcessFile = {
  schemaVersion: "web-process-canonical-v1";
  bundleId: string;
  ownerId: string;
  storageGeneration: string;
  exportedAt: string;
  importedAt: string;
  fromServerSeq: number;
  toServerSeq: number;
  transmissionBundleHash: string;
  events: ServerProcessEvent[];
  materialSnapshots: StoredMaterialSnapshot[];
  legacyImports: StoredLegacyImport[];
  draftSnapshots: ExportedDraftSnapshot[];
  deduplicatedRefs: CanonicalDeduplicatedRef[];
  canonicalFileHash: string;
};

export type WebProcessAckReceipt = {
  schemaVersion: "web-process-ack-v1";
  bundleId: string;
  ownerId: string;
  storageGeneration: string;
  fromServerSeq: number;
  toServerSeq: number;
  bundleHash: string;
  canonicalFileHash: string;
  ackedAt: string;
};

export type BundleErrorCode =
  | "invalid_bundle"
  | "owner_mismatch"
  | "hash_mismatch"
  | "bundle_hash_conflict"
  | "content_conflict";

export class BundleVerificationError extends Error {
  constructor(readonly code: BundleErrorCode, message: string) {
    super(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return item;
  });
}

export async function sha256Hex(value: unknown): Promise<string> {
  const text = typeof value === "string" ? value : canonicalJson(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function computeEventHash(event: Omit<ServerProcessEvent, "eventHash" | "serverSeq" | "receivedAt">): Promise<string> {
  return sha256Hex({
    ownerId: event.ownerId,
    scope: event.scope,
    runId: event.runId,
    eventId: event.eventId,
    clientSeq: event.clientSeq,
    clientAt: event.clientAt,
    provenance: event.provenance,
    contentVersion: event.contentVersion,
    targetId: event.targetId ?? null,
    questionId: event.questionId ?? null,
    canonicalProblemId: event.canonicalProblemId ?? null,
    canonicalMapped: event.canonicalMapped ?? null,
    kind: event.kind,
    payload: event.payload,
  });
}

export async function computeLegacyImportHash(item: Omit<StoredLegacyImport, "contentHash" | "importedAt">): Promise<string> {
  return sha256Hex({
    importId: item.importId,
    ownerId: item.ownerId,
    scope: item.scope,
    runId: item.runId,
    storageKey: item.storageKey,
    legacyVersion: item.legacyVersion ?? null,
    contentVersion: item.contentVersion ?? null,
    rawJson: item.rawJson,
  });
}

export async function computeDraftSnapshotHash(item: Omit<ExportedDraftSnapshot, "contentHash" | "savedAt">): Promise<string> {
  return sha256Hex({
    snapshotId: item.snapshotId,
    ownerId: item.ownerId,
    scope: item.scope,
    runId: item.runId,
    deviceId: item.deviceId,
    baseRevision: item.baseRevision,
    unsubmittedDraft: item.unsubmittedDraft,
    drafts: item.drafts,
  });
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export async function computeMaterialSnapshotHash(snapshot: DistributiveOmit<StoredMaterialSnapshot, "snapshotHash" | "capturedAt">): Promise<string> {
  return sha256Hex(snapshot);
}

export async function computeBundleHash(bundle: Omit<WebProcessBundle, "bundleHash">): Promise<string> {
  const {
    schemaVersion,
    bundleId,
    ownerId,
    storageGeneration,
    exportedAt,
    fromServerSeq,
    toServerSeq,
    events,
    materialSnapshots,
    legacyImports,
    draftSnapshots,
  } = bundle;
  return sha256Hex({
    schemaVersion,
    bundleId,
    ownerId,
    storageGeneration,
    exportedAt,
    fromServerSeq,
    toServerSeq,
    events,
    materialSnapshots,
    legacyImports,
    draftSnapshots,
  });
}

export async function computeCanonicalFileHash(file: Omit<CanonicalProcessFile, "canonicalFileHash">): Promise<string> {
  const {
    schemaVersion,
    bundleId,
    ownerId,
    storageGeneration,
    exportedAt,
    importedAt,
    fromServerSeq,
    toServerSeq,
    transmissionBundleHash,
    events,
    materialSnapshots,
    legacyImports,
    draftSnapshots,
    deduplicatedRefs,
  } = file;
  return sha256Hex({
    schemaVersion,
    bundleId,
    ownerId,
    storageGeneration,
    exportedAt,
    importedAt,
    fromServerSeq,
    toServerSeq,
    transmissionBundleHash,
    events,
    materialSnapshots,
    legacyImports,
    draftSnapshots,
    deduplicatedRefs,
  });
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function isWebProcessAckReceipt(value: unknown): value is WebProcessAckReceipt {
  if (!isObject(value)) return false;
  return value.schemaVersion === "web-process-ack-v1"
    && isValidId(value.bundleId)
    && isValidId(value.ownerId)
    && isValidId(value.storageGeneration)
    && Number.isSafeInteger(value.fromServerSeq) && (value.fromServerSeq as number) >= 0
    && Number.isSafeInteger(value.toServerSeq) && (value.toServerSeq as number) >= (value.fromServerSeq as number)
    && typeof value.bundleHash === "string" && HASH_PATTERN.test(value.bundleHash)
    && typeof value.canonicalFileHash === "string" && HASH_PATTERN.test(value.canonicalFileHash)
    && value.bundleHash !== value.canonicalFileHash
    && typeof value.ackedAt === "string" && !Number.isNaN(Date.parse(value.ackedAt));
}

export async function verifyWebProcessBundle(bundle: unknown, expectedOwnerId?: string): Promise<WebProcessBundle> {
  if (!isObject(bundle) || bundle.schemaVersion !== "web-process-v1") {
    throw new BundleVerificationError("invalid_bundle", "과정 묶음의 스키마 형식이 맞지 않습니다.");
  }
  if (!isValidId(bundle.bundleId) || !isValidId(bundle.ownerId) || !isValidId(bundle.storageGeneration)) {
    throw new BundleVerificationError("invalid_bundle", "과정 묶음의 식별자가 올바르지 않습니다.");
  }
  if (expectedOwnerId && bundle.ownerId !== expectedOwnerId) {
    throw new BundleVerificationError("owner_mismatch", "과정 묶음의 소유자가 기대한 학습자와 다릅니다.");
  }
  if (typeof bundle.exportedAt !== "string" || Number.isNaN(Date.parse(bundle.exportedAt))) {
    throw new BundleVerificationError("invalid_bundle", "내보낸 시각 형식이 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(bundle.fromServerSeq) || !Number.isSafeInteger(bundle.toServerSeq) || (bundle.fromServerSeq as number) < 0 || (bundle.toServerSeq as number) < (bundle.fromServerSeq as number)) {
    throw new BundleVerificationError("invalid_bundle", "수신 순번 범위가 올바르지 않습니다.");
  }
  if (!Array.isArray(bundle.events) || !Array.isArray(bundle.materialSnapshots) || !Array.isArray(bundle.legacyImports) || !Array.isArray(bundle.draftSnapshots)) {
    throw new BundleVerificationError("invalid_bundle", "과정 묶음의 목록 필드가 올바르지 않습니다.");
  }
  if (typeof bundle.bundleHash !== "string" || !HASH_PATTERN.test(bundle.bundleHash)) {
    throw new BundleVerificationError("invalid_bundle", "전송 해시 형식이 올바르지 않습니다.");
  }

  for (const rawEvent of bundle.events) {
    if (!isObject(rawEvent) || !isValidId(rawEvent.eventId) || rawEvent.ownerId !== bundle.ownerId || !isRecordScope(rawEvent.scope) || !isValidId(rawEvent.runId)) {
      throw new BundleVerificationError("invalid_bundle", "과정 사건의 필수 식별자가 없거나 소유자와 다릅니다.");
    }
    if (!Number.isSafeInteger(rawEvent.serverSeq) || (rawEvent.serverSeq as number) < 1 || typeof rawEvent.receivedAt !== "string" || Number.isNaN(Date.parse(rawEvent.receivedAt))) {
      throw new BundleVerificationError("invalid_bundle", "과정 사건의 서버 순번이나 수신 시각이 올바르지 않습니다.");
    }
    if (rawEvent.clientSeq !== null && (!Number.isSafeInteger(rawEvent.clientSeq) || (rawEvent.clientSeq as number) < 0)) {
      throw new BundleVerificationError("invalid_bundle", "과정 사건의 기기 순번이 올바르지 않습니다.");
    }
    if (rawEvent.clientAt !== null && (typeof rawEvent.clientAt !== "string" || Number.isNaN(Date.parse(rawEvent.clientAt)))) {
      throw new BundleVerificationError("invalid_bundle", "과정 사건의 기기 시각이 올바르지 않습니다.");
    }
    if (!["authenticated-live", "browser-import"].includes(rawEvent.provenance as string) || typeof rawEvent.contentVersion !== "string" || typeof rawEvent.kind !== "string" || !isObject(rawEvent.payload)) {
      throw new BundleVerificationError("invalid_bundle", "과정 사건의 출처·자료 판·내용이 올바르지 않습니다.");
    }
    const event = rawEvent as ServerProcessEvent;
    const expectedEventHash = await computeEventHash(event);
    if (event.eventHash !== expectedEventHash) {
      throw new BundleVerificationError("hash_mismatch", `사건(${event.eventId})의 해시가 원문과 맞지 않습니다.`);
    }
  }

  for (const rawMaterial of bundle.materialSnapshots) {
    if (!isObject(rawMaterial) || !isRecordScope(rawMaterial.scope) || typeof rawMaterial.contentVersion !== "string" || typeof rawMaterial.capturedAt !== "string" || typeof rawMaterial.available !== "boolean") {
      throw new BundleVerificationError("invalid_bundle", "자료 판 스냅샷 형식이 올바르지 않습니다.");
    }
    if (rawMaterial.available === true) {
      const material = rawMaterial as Extract<StoredMaterialSnapshot, { available: true }>;
      const expectedMaterialHash = await computeMaterialSnapshotHash({
        scope: material.scope,
        contentVersion: material.contentVersion,
        available: true,
        material: material.material,
      });
      if (material.snapshotHash !== expectedMaterialHash) {
        throw new BundleVerificationError("hash_mismatch", `자료 판(${material.scope}:${material.contentVersion})의 해시가 맞지 않습니다.`);
      }
    }
  }

  for (const rawLegacy of bundle.legacyImports) {
    if (!isObject(rawLegacy) || !isValidId(rawLegacy.importId) || rawLegacy.ownerId !== bundle.ownerId || !isRecordScope(rawLegacy.scope) || !isValidId(rawLegacy.runId) || typeof rawLegacy.storageKey !== "string" || typeof rawLegacy.rawJson !== "string") {
      throw new BundleVerificationError("invalid_bundle", "과거 가져오기 기록의 형식이 올바르지 않습니다.");
    }
    const legacy = rawLegacy as StoredLegacyImport;
    const expectedHash = await computeLegacyImportHash(legacy);
    if (legacy.contentHash !== expectedHash) {
      throw new BundleVerificationError("hash_mismatch", `과거 가져오기(${legacy.importId})의 해시가 원문과 맞지 않습니다.`);
    }
  }

  for (const rawDraft of bundle.draftSnapshots) {
    if (!isObject(rawDraft) || !isValidId(rawDraft.snapshotId) || rawDraft.ownerId !== bundle.ownerId || !isRecordScope(rawDraft.scope) || !isValidId(rawDraft.runId) || !isValidId(rawDraft.deviceId) || !Number.isSafeInteger(rawDraft.baseRevision) || rawDraft.unsubmittedDraft !== true || !isScopeDraftData(rawDraft.scope, rawDraft.drafts)) {
      throw new BundleVerificationError("invalid_bundle", "초안 스냅샷의 형식이 올바르지 않습니다.");
    }
    const draft = rawDraft as ExportedDraftSnapshot;
    const expectedHash = await computeDraftSnapshotHash(draft);
    if (draft.contentHash !== expectedHash) {
      throw new BundleVerificationError("hash_mismatch", `초안 스냅샷(${draft.snapshotId})의 해시가 원문과 맞지 않습니다.`);
    }
  }

  const typed = bundle as WebProcessBundle;
  const expectedBundleHash = await computeBundleHash(typed);
  if (typed.bundleHash !== expectedBundleHash) {
    throw new BundleVerificationError("hash_mismatch", "과정 묶음의 전송 해시가 내용과 맞지 않습니다.");
  }
  return typed;
}

export async function verifyCanonicalProcessFile(file: unknown): Promise<CanonicalProcessFile> {
  if (!isObject(file) || file.schemaVersion !== "web-process-canonical-v1" || !isValidId(file.bundleId) || !isValidId(file.ownerId) || !isValidId(file.storageGeneration)) {
    throw new BundleVerificationError("invalid_bundle", "정본 과정 파일의 형식이 올바르지 않습니다.");
  }
  if (typeof file.transmissionBundleHash !== "string" || !HASH_PATTERN.test(file.transmissionBundleHash) || typeof file.canonicalFileHash !== "string" || !HASH_PATTERN.test(file.canonicalFileHash)) {
    throw new BundleVerificationError("invalid_bundle", "정본 과정 파일의 해시 형식이 올바르지 않습니다.");
  }
  if (file.transmissionBundleHash === file.canonicalFileHash) {
    throw new BundleVerificationError("invalid_bundle", "전송 해시와 정본 파일 해시는 서로 구분되어야 합니다.");
  }
  const typed = file as CanonicalProcessFile;
  const expectedFileHash = await computeCanonicalFileHash(typed);
  if (typed.canonicalFileHash !== expectedFileHash) {
    throw new BundleVerificationError("hash_mismatch", `정본 과정 파일(${typed.bundleId})의 해시가 내용과 맞지 않습니다.`);
  }
  return typed;
}

function eventKey(event: Pick<ServerProcessEvent, "ownerId" | "runId" | "eventId">): string {
  return `${event.ownerId}:${event.runId}:${event.eventId}`;
}

function materialKey(item: Pick<StoredMaterialSnapshot, "scope" | "contentVersion">): string {
  return `${item.scope}:${item.contentVersion}`;
}

function materialContentHash(item: StoredMaterialSnapshot): Promise<string> {
  return item.available ? Promise.resolve(item.snapshotHash) : computeMaterialSnapshotHash({
    scope: item.scope,
    contentVersion: item.contentVersion,
    available: false,
    reason: item.reason,
    preservedQuestions: item.preservedQuestions,
  });
}

function legacyKey(item: Pick<StoredLegacyImport, "ownerId" | "importId">): string {
  return `${item.ownerId}:${item.importId}`;
}

function draftKey(item: Pick<ExportedDraftSnapshot, "ownerId" | "snapshotId">): string {
  return `${item.ownerId}:${item.snapshotId}`;
}

/**
 * Verifies a `WebProcessBundle` and reconciles it against existing `CanonicalProcessFile` records.
 * - Rejects the entire bundle if any event, material snapshot, legacy import, or draft snapshot shares an ID
 *   with an existing item (or another item in the same bundle) that has a different content hash.
 * - Deduplicates repeated bundle exports and overlapping items across different bundles, keeping raw payloads once
 *   and recording references in `deduplicatedRefs`.
 */
export async function reconcileBundleIntoCanonical(
  rawBundle: unknown,
  existingFiles: readonly CanonicalProcessFile[],
  options: { expectedOwnerId: string; importedAt?: string },
): Promise<{
  status: "imported" | "already_imported";
  canonicalFile: CanonicalProcessFile;
  ack: WebProcessAckReceipt;
}> {
  const bundle = await verifyWebProcessBundle(rawBundle, options.expectedOwnerId);
  const importedAt = options.importedAt ?? new Date().toISOString();

  for (const existing of existingFiles) {
    await verifyCanonicalProcessFile(existing);
    if (existing.ownerId !== options.expectedOwnerId) {
      throw new BundleVerificationError("owner_mismatch", "기존 정본 파일의 소유자가 일치하지 않습니다.");
    }
  }

  const sameBundle = existingFiles.find(item => item.bundleId === bundle.bundleId);
  if (sameBundle) {
    if (sameBundle.transmissionBundleHash !== bundle.bundleHash) {
      throw new BundleVerificationError("bundle_hash_conflict", `같은 묶음 ID(${bundle.bundleId})에 다른 전송 해시가 들어왔습니다.`);
    }
    return {
      status: "already_imported",
      canonicalFile: sameBundle,
      ack: {
        schemaVersion: "web-process-ack-v1",
        bundleId: sameBundle.bundleId,
        ownerId: sameBundle.ownerId,
        storageGeneration: sameBundle.storageGeneration,
        fromServerSeq: sameBundle.fromServerSeq,
        toServerSeq: sameBundle.toServerSeq,
        bundleHash: sameBundle.transmissionBundleHash,
        canonicalFileHash: sameBundle.canonicalFileHash,
        ackedAt: importedAt,
      },
    };
  }

  const knownEvents = new Map<string, { hash: string; bundleId: string }>();
  const knownMaterials = new Map<string, { hash: string; bundleId: string }>();
  const knownLegacies = new Map<string, { hash: string; bundleId: string }>();
  const knownDrafts = new Map<string, { hash: string; bundleId: string }>();

  for (const existing of existingFiles) {
    for (const ev of existing.events) {
      knownEvents.set(eventKey(ev), { hash: ev.eventHash, bundleId: existing.bundleId });
    }
    for (const mat of existing.materialSnapshots) {
      knownMaterials.set(materialKey(mat), { hash: await materialContentHash(mat), bundleId: existing.bundleId });
    }
    for (const leg of existing.legacyImports) {
      knownLegacies.set(legacyKey(leg), { hash: leg.contentHash, bundleId: existing.bundleId });
    }
    for (const dr of existing.draftSnapshots) {
      knownDrafts.set(draftKey(dr), { hash: dr.contentHash, bundleId: existing.bundleId });
    }
  }

  const newEvents: ServerProcessEvent[] = [];
  const newMaterials: StoredMaterialSnapshot[] = [];
  const newLegacies: StoredLegacyImport[] = [];
  const newDrafts: ExportedDraftSnapshot[] = [];
  const deduplicatedRefs: CanonicalDeduplicatedRef[] = [];

  for (const ev of bundle.events) {
    const key = eventKey(ev);
    const prior = knownEvents.get(key);
    if (prior) {
      if (prior.hash !== ev.eventHash) {
        throw new BundleVerificationError("content_conflict", `사건(${key})의 내용이 기존 보관본(${prior.bundleId})과 충돌합니다.`);
      }
      deduplicatedRefs.push({ itemType: "event", key, contentHash: ev.eventHash, existingBundleId: prior.bundleId });
    } else {
      knownEvents.set(key, { hash: ev.eventHash, bundleId: bundle.bundleId });
      newEvents.push(ev);
    }
  }

  for (const mat of bundle.materialSnapshots) {
    const key = materialKey(mat);
    const hash = await materialContentHash(mat);
    const prior = knownMaterials.get(key);
    if (prior) {
      if (prior.hash !== hash) {
        throw new BundleVerificationError("content_conflict", `자료 판(${key})의 내용이 기존 보관본(${prior.bundleId})과 충돌합니다.`);
      }
      deduplicatedRefs.push({ itemType: "material", key, contentHash: hash, existingBundleId: prior.bundleId });
    } else {
      knownMaterials.set(key, { hash, bundleId: bundle.bundleId });
      newMaterials.push(mat);
    }
  }

  for (const leg of bundle.legacyImports) {
    const key = legacyKey(leg);
    const prior = knownLegacies.get(key);
    if (prior) {
      if (prior.hash !== leg.contentHash) {
        throw new BundleVerificationError("content_conflict", `과거 기록(${key})의 내용이 기존 보관본(${prior.bundleId})과 충돌합니다.`);
      }
      deduplicatedRefs.push({ itemType: "legacy", key, contentHash: leg.contentHash, existingBundleId: prior.bundleId });
    } else {
      knownLegacies.set(key, { hash: leg.contentHash, bundleId: bundle.bundleId });
      newLegacies.push(leg);
    }
  }

  for (const dr of bundle.draftSnapshots) {
    const key = draftKey(dr);
    const prior = knownDrafts.get(key);
    if (prior) {
      if (prior.hash !== dr.contentHash) {
        throw new BundleVerificationError("content_conflict", `초안 스냅샷(${key})의 내용이 기존 보관본(${prior.bundleId})과 충돌합니다.`);
      }
      deduplicatedRefs.push({ itemType: "draft", key, contentHash: dr.contentHash, existingBundleId: prior.bundleId });
    } else {
      knownDrafts.set(key, { hash: dr.contentHash, bundleId: bundle.bundleId });
      newDrafts.push(dr);
    }
  }

  const baseFile: Omit<CanonicalProcessFile, "canonicalFileHash"> = {
    schemaVersion: "web-process-canonical-v1",
    bundleId: bundle.bundleId,
    ownerId: bundle.ownerId,
    storageGeneration: bundle.storageGeneration,
    exportedAt: bundle.exportedAt,
    importedAt,
    fromServerSeq: bundle.fromServerSeq,
    toServerSeq: bundle.toServerSeq,
    transmissionBundleHash: bundle.bundleHash,
    events: newEvents,
    materialSnapshots: newMaterials,
    legacyImports: newLegacies,
    draftSnapshots: newDrafts,
    deduplicatedRefs,
  };
  const canonicalFileHash = await computeCanonicalFileHash(baseFile);
  const canonicalFile: CanonicalProcessFile = { ...baseFile, canonicalFileHash };

  return {
    status: "imported",
    canonicalFile,
    ack: {
      schemaVersion: "web-process-ack-v1",
      bundleId: canonicalFile.bundleId,
      ownerId: canonicalFile.ownerId,
      storageGeneration: canonicalFile.storageGeneration,
      fromServerSeq: canonicalFile.fromServerSeq,
      toServerSeq: canonicalFile.toServerSeq,
      bundleHash: canonicalFile.transmissionBundleHash,
      canonicalFileHash: canonicalFile.canonicalFileHash,
      ackedAt: importedAt,
    },
  };
}
