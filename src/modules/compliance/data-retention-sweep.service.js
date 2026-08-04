import { logSafeWarn } from "../../http/sanitize-error.js";
import { runRetentionSweep } from "./data-retention.js";

// CF-0.5: once a day is plenty for a retention ceiling measured in days -
// unlike abandoned-session-sweep.service.js (30s, catching a crashed agent
// quickly matters), there's no correctness reason to run this more often.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** @type {ReturnType<typeof setInterval> | null} */
let sweepTimer = null;

async function sweepOnce() {
  const result = await runRetentionSweep();
  const total = Object.values(result).reduce((sum, n) => sum + n, 0);
  if (total > 0) {
    logSafeWarn("[data-retention-sweep] enforced retention ceilings", result);
  }
}

/** Enforces every data type's retention ceiling automatically - CF-0.5's "configurable, enforced max-retention... with automatic deletion." */
export function scheduleDataRetentionSweep() {
  if (sweepTimer) return;

  const run = () => {
    sweepOnce().catch((err) => {
      logSafeWarn("[data-retention-sweep] run failed:", err);
    });
  };

  run();
  sweepTimer = setInterval(run, CHECK_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}
