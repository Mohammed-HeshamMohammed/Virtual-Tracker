const UPDATE_STATE_KEY = "vt:update-runtime:v1";
const UPDATE_ROLLOUT_ID_KEY = "vt:update-rollout-id:v1";

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_DEFER_MS = 4 * 60 * 60 * 1000;
export const UPDATE_QUARANTINE_MS = 24 * 60 * 60 * 1000;
export const UPDATE_FAILURES_BEFORE_QUARANTINE = 3;

export type UpdateRuntimeState = {
  schema: 1;
  pendingVersion: string | null;
  deferredUntil: number;
  consecutiveCheckFailures: number;
  nextCheckAt: number;
  installFailures: Record<string, { count: number; lastFailedAt: number; quarantinedUntil: number }>;
};

const EMPTY_STATE: UpdateRuntimeState = {
  schema: 1,
  pendingVersion: null,
  deferredUntil: 0,
  consecutiveCheckFailures: 0,
  nextCheckAt: 0,
  installFailures: {},
};

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function loadUpdateRuntimeState(storage: Storage = window.localStorage): UpdateRuntimeState {
  try {
    const parsed = JSON.parse(storage.getItem(UPDATE_STATE_KEY) ?? "null") as Partial<UpdateRuntimeState> | null;
    if (!parsed || parsed.schema !== 1) return { ...EMPTY_STATE, installFailures: {} };
    const installFailures: UpdateRuntimeState["installFailures"] = {};
    if (parsed.installFailures && typeof parsed.installFailures === "object") {
      for (const [version, entry] of Object.entries(parsed.installFailures)) {
        if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) || !entry || typeof entry !== "object") continue;
        installFailures[version] = {
          count: Math.max(0, Math.floor(safeNumber(entry.count))),
          lastFailedAt: safeNumber(entry.lastFailedAt),
          quarantinedUntil: safeNumber(entry.quarantinedUntil),
        };
      }
    }
    return {
      schema: 1,
      pendingVersion: typeof parsed.pendingVersion === "string" ? parsed.pendingVersion : null,
      deferredUntil: safeNumber(parsed.deferredUntil),
      consecutiveCheckFailures: Math.max(0, Math.floor(safeNumber(parsed.consecutiveCheckFailures))),
      nextCheckAt: safeNumber(parsed.nextCheckAt),
      installFailures,
    };
  } catch {
    return { ...EMPTY_STATE, installFailures: {} };
  }
}

export function saveUpdateRuntimeState(state: UpdateRuntimeState, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(UPDATE_STATE_KEY, JSON.stringify(state));
  } catch {
    // Update persistence is resilience only. A locked-down storage profile must
    // not prevent checking, downloading, or installing a signed update.
  }
}

export function updateRetryDelayMs(failureCount: number, random = Math.random): number {
  const base = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.max(0, failureCount - 1));
  const jitter = 0.8 + Math.max(0, Math.min(1, random())) * 0.4;
  return Math.round(base * jitter);
}

export function recordUpdateCheckSuccess(now = Date.now(), storage: Storage = window.localStorage): void {
  const state = loadUpdateRuntimeState(storage);
  saveUpdateRuntimeState({
    ...state,
    consecutiveCheckFailures: 0,
    nextCheckAt: now + UPDATE_CHECK_INTERVAL_MS,
  }, storage);
}

export function recordUpdateCheckFailure(now = Date.now(), storage: Storage = window.localStorage): void {
  const state = loadUpdateRuntimeState(storage);
  const failures = state.consecutiveCheckFailures + 1;
  saveUpdateRuntimeState({
    ...state,
    consecutiveCheckFailures: failures,
    nextCheckAt: now + updateRetryDelayMs(failures),
  }, storage);
}

export function recordPendingUpdate(version: string, storage: Storage = window.localStorage): void {
  const state = loadUpdateRuntimeState(storage);
  saveUpdateRuntimeState({ ...state, pendingVersion: version }, storage);
}

export function deferUpdate(version: string, now = Date.now(), storage: Storage = window.localStorage): void {
  const state = loadUpdateRuntimeState(storage);
  saveUpdateRuntimeState({
    ...state,
    pendingVersion: version,
    deferredUntil: now + UPDATE_DEFER_MS,
  }, storage);
}

export function clearUpdateDeferral(storage: Storage = window.localStorage): void {
  const state = loadUpdateRuntimeState(storage);
  saveUpdateRuntimeState({ ...state, deferredUntil: 0 }, storage);
}

export function isUpdateDeferred(version: string, now = Date.now(), storage: Storage = window.localStorage): boolean {
  const state = loadUpdateRuntimeState(storage);
  return state.pendingVersion === version && state.deferredUntil > now;
}

export function recordInstallFailure(
  version: string,
  now = Date.now(),
  storage: Storage = window.localStorage,
): { count: number; quarantinedUntil: number } {
  const state = loadUpdateRuntimeState(storage);
  const previous = state.installFailures[version];
  const count = (previous?.count ?? 0) + 1;
  const quarantinedUntil = count >= UPDATE_FAILURES_BEFORE_QUARANTINE ? now + UPDATE_QUARANTINE_MS : 0;
  const result = { count, lastFailedAt: now, quarantinedUntil };
  saveUpdateRuntimeState({
    ...state,
    pendingVersion: version,
    installFailures: { ...state.installFailures, [version]: result },
  }, storage);
  return result;
}

export function isUpdateQuarantined(version: string, now = Date.now(), storage: Storage = window.localStorage): boolean {
  return (loadUpdateRuntimeState(storage).installFailures[version]?.quarantinedUntil ?? 0) > now;
}

export function clearUpdateStateAfterInstall(currentVersion: string, storage: Storage = window.localStorage): void {
  const state = loadUpdateRuntimeState(storage);
  if (state.pendingVersion !== currentVersion && !state.installFailures[currentVersion]) return;
  const installFailures = { ...state.installFailures };
  delete installFailures[currentVersion];
  saveUpdateRuntimeState({
    ...state,
    pendingVersion: state.pendingVersion === currentVersion ? null : state.pendingVersion,
    deferredUntil: 0,
    installFailures,
  }, storage);
}

export function shouldRunAutomaticUpdateCheck(now = Date.now(), storage: Storage = window.localStorage): boolean {
  const state = loadUpdateRuntimeState(storage);
  return Boolean(state.pendingVersion) || state.nextCheckAt <= now;
}

export function millisecondsUntilUpdateCheck(now = Date.now(), storage: Storage = window.localStorage): number {
  const state = loadUpdateRuntimeState(storage);
  if (state.pendingVersion) return 0;
  return Math.max(0, state.nextCheckAt - now);
}

function fallbackRolloutId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.some((value) => value !== 0)) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateUpdateRolloutId(storage: Storage = window.localStorage): string {
  try {
    const existing = storage.getItem(UPDATE_ROLLOUT_ID_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
    const created = globalThis.crypto?.randomUUID?.() ?? fallbackRolloutId();
    storage.setItem(UPDATE_ROLLOUT_ID_KEY, created);
    return created;
  } catch {
    // A transient ID still lets the update check work. Production WebView
    // storage is persistent; this fallback is for private/locked test profiles.
    return fallbackRolloutId();
  }
}
