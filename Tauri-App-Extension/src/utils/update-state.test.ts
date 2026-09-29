import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_DEFER_MS,
  UPDATE_FAILURES_BEFORE_QUARANTINE,
  UPDATE_QUARANTINE_MS,
  clearUpdateStateAfterInstall,
  deferUpdate,
  getOrCreateUpdateRolloutId,
  isUpdateDeferred,
  isUpdateQuarantined,
  loadUpdateRuntimeState,
  recordInstallFailure,
  recordPendingUpdate,
  recordUpdateCheckFailure,
  recordUpdateCheckSuccess,
  shouldRunAutomaticUpdateCheck,
  updateRetryDelayMs,
} from "./update-state";

describe("persistent updater state", () => {
  let storage: Storage;

  beforeEach(() => {
    const values = new Map<string, string>();
    storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, String(value)); },
    };
  });

  it("backs off failed checks with bounded jitter and resets after success", () => {
    expect(updateRetryDelayMs(1, () => 0.5)).toBe(5 * 60 * 1000);
    expect(updateRetryDelayMs(2, () => 0.5)).toBe(10 * 60 * 1000);
    recordUpdateCheckFailure(1_000, storage);
    expect(loadUpdateRuntimeState(storage).consecutiveCheckFailures).toBe(1);
    recordUpdateCheckSuccess(2_000, storage);
    const state = loadUpdateRuntimeState(storage);
    expect(state.consecutiveCheckFailures).toBe(0);
    expect(state.nextCheckAt).toBe(2_000 + UPDATE_CHECK_INTERVAL_MS);
  });

  it("remembers a staged update and a Not now choice across a restart", () => {
    recordPendingUpdate("1.2.0", storage);
    expect(shouldRunAutomaticUpdateCheck(10_000, storage)).toBe(true);
    deferUpdate("1.2.0", 10_000, storage);
    expect(isUpdateDeferred("1.2.0", 10_000 + UPDATE_DEFER_MS - 1, storage)).toBe(true);
    expect(isUpdateDeferred("1.2.0", 10_000 + UPDATE_DEFER_MS, storage)).toBe(false);
  });

  it("quarantines only a repeatedly failing version and clears it after install", () => {
    for (let attempt = 1; attempt <= UPDATE_FAILURES_BEFORE_QUARANTINE; attempt += 1) {
      recordInstallFailure("1.2.0", 20_000 + attempt, storage);
    }
    expect(isUpdateQuarantined("1.2.0", 20_000 + UPDATE_QUARANTINE_MS - 1, storage)).toBe(true);
    expect(isUpdateQuarantined("1.2.1", 20_000, storage)).toBe(false);
    clearUpdateStateAfterInstall("1.2.0", storage);
    expect(loadUpdateRuntimeState(storage).pendingVersion).toBeNull();
    expect(isUpdateQuarantined("1.2.0", 20_000, storage)).toBe(false);
  });

  it("creates one opaque rollout id without using member or machine identity", () => {
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-2222-4333-8444-555555555555");
    expect(getOrCreateUpdateRolloutId(storage)).toBe("11111111-2222-4333-8444-555555555555");
    expect(getOrCreateUpdateRolloutId(storage)).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});
