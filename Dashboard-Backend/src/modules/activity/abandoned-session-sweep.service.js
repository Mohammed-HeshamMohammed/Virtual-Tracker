import { logSafeWarn } from "../../http/sanitize-error.js";
import { fetchAllOpenPgSessions } from "../../lib/postgres/activity-events-postgres.service.js";
import { closeAbandonedSession, isSessionAbandoned } from "./agent-heartbeat.js";

// Roughly one heartbeat TTL (15s) past expiry before a stale session gets
// caught by this pass, on top of whatever the lazy per-request check already
// catches - this only matters for a member who never hits the API again.
const CHECK_INTERVAL_MS = 30_000;

/** @type {ReturnType<typeof setInterval> | null} */
let sweepTimer = null;

async function sweepOnce() {
  const open = await fetchAllOpenPgSessions();
  for (const session of open) {
    if (await isSessionAbandoned(session)) {
      await closeAbandonedSession(session);
    }
  }
}

/** Catches abandoned desktop-agent sessions even if the owning member never hits the activity API again. */
export function scheduleAbandonedSessionSweep() {
  if (sweepTimer) return;

  const run = () => {
    sweepOnce().catch((err) => {
      logSafeWarn("[abandoned-session-sweep] run failed:", err);
    });
  };

  run();
  sweepTimer = setInterval(run, CHECK_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}
