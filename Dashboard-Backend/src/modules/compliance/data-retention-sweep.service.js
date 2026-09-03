import { logSafeWarn } from "../../http/sanitize-error.js";
import { runRetentionSweep } from "./data-retention.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let sweepTimer = null;

async function sweepOnce() {
  const result = await runRetentionSweep();
  const total = Object.values(result).reduce((sum, n) => sum + n, 0);
  if (total > 0) {
    logSafeWarn("[data-retention-sweep] enforced retention ceilings", result);
  }
}

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
