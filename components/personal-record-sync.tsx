"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LEARNER_RECORDS_ENDPOINT,
  LEARNER_RECORDS_EXECUTIONS_ENDPOINT,
  type ArchiveReason,
  type BrowserImportItem,
  type ExternalExecutionRecord,
  type LearnerRecordCommand,
  type RecordScope,
  type ScopeRecordEnvelope,
  type ScopedRecordState,
} from "@/lib/learner-record-contract";

export type PersonalSyncStatus =
  | "browser-temp"
  | "checking"
  | "sync-pending"
  | "server-saved"
  | "sync-failed"
  | "revision-conflict"
  | "auth-required";

const SYNC_SESSION_KEY = "english-sense-personal-sync";
const DEVICE_ID_SESSION_KEY = "english-sense-device-id";

let fallbackDeviceId: string | null = null;
let fallbackClientSeq = 0;

function getDeviceId(): string {
  try {
    const existing = sessionStorage.getItem(DEVICE_ID_SESSION_KEY);
    if (existing && /^[a-zA-Z0-9_-]{1,80}$/.test(existing)) return existing;
    const created = `dev-${crypto.randomUUID().slice(0, 16)}`;
    sessionStorage.setItem(DEVICE_ID_SESSION_KEY, created);
    return created;
  } catch {
    if (!fallbackDeviceId) fallbackDeviceId = `dev-${crypto.randomUUID().slice(0, 16)}`;
    return fallbackDeviceId;
  }
}

function nextClientSeq(): number {
  fallbackClientSeq += 1;
  return fallbackClientSeq;
}

export function hasAccessCookie(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)CF_Authorization=/.test(document.cookie);
}

function isSessionSyncEnabled(): boolean {
  if (hasAccessCookie()) return true;
  try {
    return sessionStorage.getItem(SYNC_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function setSessionSyncEnabled(enabled: boolean): void {
  try {
    if (enabled) sessionStorage.setItem(SYNC_SESSION_KEY, "1");
    else sessionStorage.removeItem(SYNC_SESSION_KEY);
  } catch {
    // Ignore storage failures
  }
}

export interface UsePersonalRecordSyncOptions<S extends ScopedRecordState> {
  scope: RecordScope;
  contentVersion: string;
  localState: S | null;
  localReady: boolean;
  hasMeaningfulLocalWork: boolean;
  collectBrowserImportItems: () => BrowserImportItem[];
  createFreshState: () => S;
  applyServerState: (nextState: S) => void;
}

export function usePersonalRecordSync<S extends ScopedRecordState>({
  scope,
  contentVersion,
  localState,
  localReady,
  hasMeaningfulLocalWork,
  collectBrowserImportItems,
  createFreshState,
  applyServerState,
}: UsePersonalRecordSyncOptions<S>) {
  const [syncStatus, setSyncStatus] = useState<PersonalSyncStatus>("browser-temp");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<ScopeRecordEnvelope | null>(null);
  const [needsExplicitImport, setNeedsExplicitImport] = useState(false);

  const liveSyncActiveRef = useRef(false);
  const revisionRef = useRef(0);
  const runIdRef = useRef(`run-${scope}-initial`);
  const lastSyncedJsonRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const queuedStateRef = useRef<S | null>(null);
  const initialConnectDoneRef = useRef(false);
  const localStateRef = useRef<S | null>(localState);
  localStateRef.current = localState;

  const updateFromEnvelope = useCallback((nextEnv: ScopeRecordEnvelope) => {
    setEnvelope(nextEnv);
    revisionRef.current = nextEnv.revision;
    runIdRef.current = nextEnv.activeRunId;
  }, []);

  const sendCommand = useCallback(
    async (command: LearnerRecordCommand): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> => {
      try {
        const response = await fetch(LEARNER_RECORDS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
          redirect: "manual",
        });
        if (response.type === "opaqueredirect" || response.status === 302) {
          return {
            ok: false,
            status: 401,
            data: { code: "unauthenticated", detail: "개인 서버 보관을 쓰려면 Cloudflare Access 로그인이 필요합니다." },
          };
        }
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        return { ok: response.ok, status: response.status, data };
      } catch {
        return { ok: false, status: 0, data: {} };
      }
    },
    [],
  );

  const flushSyncState = useCallback(
    async (targetState: S) => {
      if (inFlightRef.current) {
        queuedStateRef.current = targetState;
        return;
      }
      inFlightRef.current = true;
      setSyncStatus("sync-pending");
      setSyncMessage(null);

      try {
        const command: LearnerRecordCommand = {
          commandId: `cmd-${crypto.randomUUID()}`,
          scope,
          runId: runIdRef.current,
          expectedRevision: revisionRef.current,
          deviceId: getDeviceId(),
          clientSeq: nextClientSeq(),
          clientAt: new Date().toISOString(),
          action: "sync_state",
          contentVersion,
          state: targetState,
        };
        const result = await sendCommand(command);
        if (result.ok && result.data.envelope) {
          const nextEnv = result.data.envelope as ScopeRecordEnvelope;
          updateFromEnvelope(nextEnv);
          lastSyncedJsonRef.current = JSON.stringify(targetState);
          setSyncStatus("server-saved");
          setSyncMessage(null);
        } else if (result.status === 409 && result.data.code === "revision_conflict") {
          liveSyncActiveRef.current = false;
          if (result.data.envelope) {
            updateFromEnvelope(result.data.envelope as ScopeRecordEnvelope);
          }
          setSyncStatus("revision-conflict");
          setSyncMessage(
            typeof result.data.detail === "string"
              ? result.data.detail
              : "다른 기기에서 먼저 저장한 변경이 있습니다. 두 초안을 모두 보존했으니 이어 갈 초안을 골라 주세요.",
          );
        } else if (result.status === 401 || result.status === 403 || result.status === 503) {
          liveSyncActiveRef.current = false;
          setSyncStatus("auth-required");
          setSyncMessage(
            typeof result.data.detail === "string"
              ? result.data.detail
              : "개인 서버 보관을 쓰려면 Cloudflare Access 로그인이 필요합니다.",
          );
        } else {
          setSyncStatus("sync-failed");
          setSyncMessage(
            typeof result.data.detail === "string"
              ? result.data.detail
              : "개인 서버에 저장하지 못했습니다. 현재 화면과 이 브라우저에는 남아 있습니다.",
          );
        }
      } finally {
        inFlightRef.current = false;
        const nextQueued = queuedStateRef.current;
        queuedStateRef.current = null;
        if (nextQueued && liveSyncActiveRef.current && JSON.stringify(nextQueued) !== lastSyncedJsonRef.current) {
          void flushSyncState(nextQueued);
        }
      }
    },
    [contentVersion, scope, sendCommand, updateFromEnvelope],
  );

  const connectServer = useCallback(async () => {
    setSyncStatus("checking");
    setSyncMessage(null);
    try {
      const response = await fetch(`${LEARNER_RECORDS_ENDPOINT}?scope=${encodeURIComponent(scope)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
      });
      if (response.type === "opaqueredirect" || response.status === 302) {
        liveSyncActiveRef.current = false;
        setSyncStatus("auth-required");
        setSyncMessage("개인 서버 보관을 쓰려면 Cloudflare Access 로그인이 필요합니다.");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        liveSyncActiveRef.current = false;
        setSyncStatus("auth-required");
        setSyncMessage(
          typeof body.detail === "string"
            ? body.detail
            : "개인 기록을 열거나 저장하려면 로그인이 필요합니다.",
        );
        return;
      }
      setSessionSyncEnabled(true);
      const envData = body as unknown as ScopeRecordEnvelope;
      updateFromEnvelope(envData);

      const currentLocal = localStateRef.current;
      const currentLocalJson = currentLocal ? JSON.stringify(currentLocal) : null;

      if (envData.state !== null) {
        const serverJson = JSON.stringify(envData.state);
        if (!hasMeaningfulLocalWork || currentLocalJson === serverJson) {
          lastSyncedJsonRef.current = serverJson;
          liveSyncActiveRef.current = true;
          setNeedsExplicitImport(false);
          applyServerState(envData.state as S);
          setSyncStatus("server-saved");
        } else {
          liveSyncActiveRef.current = false;
          setNeedsExplicitImport(true);
          setSyncStatus("server-saved");
          setSyncMessage("이 브라우저의 임시 기록과 개인 서버 기록이 모두 있습니다. 불러올 기록을 골라 주세요.");
        }
      } else {
        if (hasMeaningfulLocalWork) {
          liveSyncActiveRef.current = false;
          setNeedsExplicitImport(true);
          setSyncStatus("server-saved");
          setSyncMessage("로그인 전 이 브라우저에 작성한 임시 기록이 있습니다. 명시적으로 가져오기를 선택해야 개인 서버에 연결됩니다.");
        } else {
          lastSyncedJsonRef.current = currentLocalJson;
          liveSyncActiveRef.current = true;
          setNeedsExplicitImport(false);
          setSyncStatus("server-saved");
        }
      }
    } catch {
      setSyncStatus("sync-failed");
      setSyncMessage("개인 서버 보관 상태를 확인하지 못했습니다. 이 브라우저 임시 보관으로 계속합니다.");
    }
  }, [applyServerState, hasMeaningfulLocalWork, scope, updateFromEnvelope]);

  useEffect(() => {
    if (!localReady || initialConnectDoneRef.current) return;
    if (!isSessionSyncEnabled()) return;
    initialConnectDoneRef.current = true;
    void connectServer();
  }, [connectServer, localReady]);

  useEffect(() => {
    if (!localReady || !localState || !liveSyncActiveRef.current) return;
    const serialized = JSON.stringify(localState);
    if (serialized === lastSyncedJsonRef.current) return;
    const timer = setTimeout(() => {
      if (liveSyncActiveRef.current && localStateRef.current) {
        void flushSyncState(localStateRef.current);
      }
    }, 40);
    return () => clearTimeout(timer);
  }, [flushSyncState, localReady, localState]);

  const adoptServerRecord = useCallback(() => {
    if (!envelope?.state) return;
    const serverJson = JSON.stringify(envelope.state);
    lastSyncedJsonRef.current = serverJson;
    liveSyncActiveRef.current = true;
    setNeedsExplicitImport(false);
    setSyncMessage(null);
    setSyncStatus("server-saved");
    applyServerState(envelope.state as S);
  }, [applyServerState, envelope]);

  const importBrowserRecords = useCallback(async () => {
    if (!localStateRef.current) return;
    setSyncStatus("sync-pending");
    setSyncMessage(null);
    const items = collectBrowserImportItems();
    const rawItems: BrowserImportItem[] = items.length > 0
      ? items
      : [{ scope, storageKey: `browser:${scope}`, rawJson: JSON.stringify(localStateRef.current), contentVersion }];

    const command: LearnerRecordCommand = {
      commandId: `cmd-import-${crypto.randomUUID()}`,
      scope,
      runId: runIdRef.current,
      expectedRevision: revisionRef.current,
      deviceId: getDeviceId(),
      clientSeq: nextClientSeq(),
      action: "import_browser_records",
      contentVersion,
      state: localStateRef.current,
      rawItems,
    };
    const result = await sendCommand(command);
    if (result.ok && result.data.envelope) {
      const nextEnv = result.data.envelope as ScopeRecordEnvelope;
      updateFromEnvelope(nextEnv);
      lastSyncedJsonRef.current = JSON.stringify(localStateRef.current);
      liveSyncActiveRef.current = true;
      setNeedsExplicitImport(false);
      setSyncStatus("server-saved");
      setSyncMessage("이 브라우저 기록을 개인 서버 보관으로 가져왔습니다.");
    } else {
      setSyncStatus("sync-failed");
      setSyncMessage(typeof result.data.detail === "string" ? result.data.detail : "브라우저 기록 가져오기에 실패했습니다.");
    }
  }, [collectBrowserImportItems, contentVersion, scope, sendCommand, updateFromEnvelope]);

  const archiveAndStartNewRun = useCallback(
    async (reason: ArchiveReason = "restart") => {
      const fresh = createFreshState();
      if (!envelope) {
        applyServerState(fresh);
        return;
      }
      setSyncStatus("sync-pending");
      setSyncMessage(null);
      const newRunId = `run-${scope}-${crypto.randomUUID().slice(0, 12)}`;
      const command: LearnerRecordCommand = {
        commandId: `cmd-archive-${crypto.randomUUID()}`,
        scope,
        runId: runIdRef.current,
        expectedRevision: revisionRef.current,
        deviceId: getDeviceId(),
        clientSeq: nextClientSeq(),
        clientAt: new Date().toISOString(),
        action: "archive_and_start_run",
        reason,
        newRunId,
        contentVersion,
        initialState: fresh,
      };
      const result = await sendCommand(command);
      if (result.ok && result.data.envelope) {
        const nextEnv = result.data.envelope as ScopeRecordEnvelope;
        updateFromEnvelope(nextEnv);
        lastSyncedJsonRef.current = JSON.stringify(fresh);
        liveSyncActiveRef.current = true;
        applyServerState(fresh);
        setSyncStatus("server-saved");
        setSyncMessage("이전 실행을 보관함에 남기고 새 실행을 시작했습니다.");
      } else {
        setSyncStatus("sync-failed");
        setSyncMessage(typeof result.data.detail === "string" ? result.data.detail : "새 실행을 시작하지 못했습니다.");
      }
    },
    [applyServerState, contentVersion, createFreshState, envelope, scope, sendCommand, updateFromEnvelope],
  );

  const restoreArchivedRun = useCallback(
    async (targetRunId: string) => {
      setSyncStatus("sync-pending");
      setSyncMessage(null);
      const command: LearnerRecordCommand = {
        commandId: `cmd-restore-${crypto.randomUUID()}`,
        scope,
        runId: runIdRef.current,
        expectedRevision: revisionRef.current,
        deviceId: getDeviceId(),
        clientSeq: nextClientSeq(),
        clientAt: new Date().toISOString(),
        action: "restore_archived_run",
        targetRunId,
      };
      const result = await sendCommand(command);
      if (result.ok && result.data.envelope) {
        const nextEnv = result.data.envelope as ScopeRecordEnvelope;
        updateFromEnvelope(nextEnv);
        if (nextEnv.state) {
          lastSyncedJsonRef.current = JSON.stringify(nextEnv.state);
          liveSyncActiveRef.current = true;
          applyServerState(nextEnv.state as S);
        }
        setSyncStatus("server-saved");
        setSyncMessage("보관함의 이전 실행을 복원했습니다.");
      } else {
        setSyncStatus("sync-failed");
        setSyncMessage(typeof result.data.detail === "string" ? result.data.detail : "보관함 실행을 복원하지 못했습니다.");
      }
    },
    [applyServerState, scope, sendCommand, updateFromEnvelope],
  );

  const resolveConflict = useCallback(
    async (resolution: "keep_server" | "adopt_conflict_draft", conflictDeviceId?: string) => {
      const targetDevice = conflictDeviceId ?? envelope?.conflictingDrafts[0]?.deviceId ?? getDeviceId();
      setSyncStatus("sync-pending");
      setSyncMessage(null);
      const command: LearnerRecordCommand = {
        commandId: `cmd-resolve-${crypto.randomUUID()}`,
        scope,
        runId: runIdRef.current,
        expectedRevision: revisionRef.current,
        deviceId: getDeviceId(),
        clientSeq: nextClientSeq(),
        clientAt: new Date().toISOString(),
        action: "resolve_conflict",
        resolution,
        conflictDeviceId: targetDevice,
      };
      const result = await sendCommand(command);
      if (result.ok && result.data.envelope) {
        const nextEnv = result.data.envelope as ScopeRecordEnvelope;
        updateFromEnvelope(nextEnv);
        if (resolution === "adopt_conflict_draft" && localStateRef.current) {
          const currentLocal = localStateRef.current;
          liveSyncActiveRef.current = true;
          if (JSON.stringify(currentLocal) !== JSON.stringify(nextEnv.state)) {
            await flushSyncState(currentLocal);
          } else {
            lastSyncedJsonRef.current = JSON.stringify(currentLocal);
            applyServerState(currentLocal);
          }
        } else if (nextEnv.state) {
          lastSyncedJsonRef.current = JSON.stringify(nextEnv.state);
          liveSyncActiveRef.current = true;
          applyServerState(nextEnv.state as S);
        }
        setSyncStatus("server-saved");
        setSyncMessage(
          resolution === "adopt_conflict_draft"
            ? "충돌한 초안을 서버 최신 기록 위에 반영했습니다."
            : "서버 최신 기록을 유지했습니다.",
        );
      } else {
        setSyncStatus("sync-failed");
        setSyncMessage(typeof result.data.detail === "string" ? result.data.detail : "초안 충돌을 처리하지 못했습니다.");
      }
    },
    [applyServerState, envelope, scope, sendCommand, updateFromEnvelope],
  );

  const retrySync = useCallback(async () => {
    if (!localStateRef.current) return;
    liveSyncActiveRef.current = true;
    await flushSyncState(localStateRef.current);
  }, [flushSyncState]);

  const lookupExecutionResult = useCallback(
    async (requestId: string): Promise<ExternalExecutionRecord | null> => {
      try {
        const res = await fetch(
          `${LEARNER_RECORDS_EXECUTIONS_ENDPOINT}?scope=${encodeURIComponent(scope)}&requestId=${encodeURIComponent(requestId)}`,
          { method: "GET", headers: { Accept: "application/json" } },
        );
        if (!res.ok) return null;
        const body = (await res.json()) as { ok?: boolean; execution?: ExternalExecutionRecord };
        return body.ok && body.execution ? body.execution : null;
      } catch {
        return null;
      }
    },
    [scope],
  );

  return {
    syncStatus,
    syncMessage,
    envelope,
    needsExplicitImport,
    isServerConnected: envelope !== null && syncStatus !== "browser-temp" && syncStatus !== "auth-required",
    connectServer,
    adoptServerRecord,
    importBrowserRecords,
    archiveAndStartNewRun,
    restoreArchivedRun,
    resolveConflict,
    retrySync,
    lookupExecutionResult,
  };
}

export function PersonalRecordSyncBar({
  sync,
  hideConnectWhenBrowserTemp = false,
}: {
  sync: ReturnType<typeof usePersonalRecordSync<any>>;
  hideConnectWhenBrowserTemp?: boolean;
}) {
  const {
    syncStatus,
    syncMessage,
    envelope,
    needsExplicitImport,
    connectServer,
    adoptServerRecord,
    importBrowserRecords,
    archiveAndStartNewRun,
    restoreArchivedRun,
    resolveConflict,
    retrySync,
  } = sync;

  if (hideConnectWhenBrowserTemp && syncStatus === "browser-temp") {
    return null;
  }

  const unavailableMaterials = envelope
    ? Object.values(envelope.materialSnapshots).filter(snap => !snap.available)
    : [];

  return (
    <div className="lw-personal-sync" data-sync-status={syncStatus} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem", marginTop: "0.35rem" }}>
      {syncStatus === "browser-temp" ? (
        <button type="button" className="workspace-ghost-button workspace-inline-button" onClick={() => void connectServer()}>
          개인 서버 보관 연결
        </button>
      ) : null}

      {syncStatus === "checking" || syncStatus === "sync-pending" ? (
        <span className="lw-sync-badge">동기화 대기</span>
      ) : null}

      {syncStatus === "server-saved" && envelope ? (
        <span className="lw-sync-badge">
          개인 서버에 보관됨
          {envelope.canonicalExport.status === "canonical-acknowledged" ? " · 정본 보관 확인됨" : " · 정본 반영 대기"}
          {envelope.provenance === "browser-import" ? " · 브라우저 기록 가져옴" : ""}
        </span>
      ) : null}

      {syncStatus === "sync-failed" ? (
        <span className="lw-sync-badge" role="status">
          {syncMessage || "개인 서버 저장 실패 — 이 브라우저에 임시 보관됨"}{" "}
          <button type="button" className="workspace-ghost-button workspace-inline-button" onClick={() => void retrySync()}>
            서버에 다시 저장
          </button>
        </span>
      ) : null}

      {syncStatus === "auth-required" ? (
        <span className="lw-sync-badge" role="status">
          {syncMessage || "개인 서버 보관을 쓰려면 로그인이 필요합니다."}{" "}
          <button
            type="button"
            className="workspace-ghost-button workspace-inline-button"
            onClick={() => {
              const returnTo = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/";
              window.location.assign(`${LEARNER_RECORDS_ENDPOINT}?returnTo=${encodeURIComponent(returnTo)}`);
            }}
          >
            Cloudflare Access 로그인
          </button>{" "}
          <button type="button" className="workspace-ghost-button workspace-inline-button" onClick={() => void connectServer()}>
            다시 확인
          </button>
        </span>
      ) : null}

      {syncStatus === "revision-conflict" ? (
        <div className="lw-sync-conflict" role="status" style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
          <span>{syncMessage || "다른 기기 변경과 충돌해 두 초안을 모두 보존했습니다."}</span>
          <button type="button" className="workspace-ghost-button workspace-inline-button" onClick={() => void resolveConflict("keep_server")}>
            서버 최신 상태 유지
          </button>
          <button type="button" className="workspace-ghost-button workspace-inline-button" onClick={() => void resolveConflict("adopt_conflict_draft")}>
            이 기기 초안 반영
          </button>
        </div>
      ) : null}

      {needsExplicitImport ? (
        <div className="lw-sync-import" style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
          {syncMessage ? <span>{syncMessage}</span> : null}
          <button type="button" className="workspace-ghost-button workspace-inline-button" onClick={() => void importBrowserRecords()}>
            이 브라우저 기록을 개인 서버로 가져오기
          </button>
          {envelope?.state ? (
            <button type="button" className="workspace-ghost-button workspace-inline-button" onClick={adoptServerRecord}>
              서버 기록 불러오기
            </button>
          ) : null}
        </div>
      ) : null}

      {!needsExplicitImport && syncMessage && syncStatus === "server-saved" ? (
        <span role="status">{syncMessage}</span>
      ) : null}

      {envelope && syncStatus === "server-saved" ? (
        <button type="button" className="workspace-ghost-button workspace-inline-button" onClick={() => void archiveAndStartNewRun("restart")}>
          보관함으로 옮기고 새 실행 시작
        </button>
      ) : null}

      {envelope && envelope.archivedRuns.length > 0 ? (
        <details className="lw-archive-runs" style={{ width: "100%" }}>
          <summary style={{ cursor: "pointer" }}>이전 실행 보관함 ({envelope.archivedRuns.length}건)</summary>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1rem", display: "grid", gap: "0.35rem" }}>
            {envelope.archivedRuns.map(run => (
              <li key={run.runId} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                <span>
                  실행 {run.runId} · 자료 판 {run.contentVersion.slice(0, 8)} ·{" "}
                  {run.provenance === "browser-import" ? "브라우저 가져옴" : "로그인 실행"}
                </span>
                <button
                  type="button"
                  className="workspace-ghost-button workspace-inline-button"
                  onClick={() => void restoreArchivedRun(run.runId)}
                >
                  이 실행 복원
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {unavailableMaterials.length > 0 ? (
        <p className="lw-material-unavailable-note" style={{ width: "100%", margin: 0 }}>
          당시 이야기 전체 본문은 서버에 남아 있지 않아 문항에 보존된 당시 스냅샷만 표시합니다 ({unavailableMaterials.map(m => m.contentVersion.slice(0, 8)).join(", ")}).
        </p>
      ) : null}
    </div>
  );
}
