import { logSafeWarn } from "../../http/sanitize-error.js";
import { fetchAllOpenPgSessions } from "../../lib/postgres/activity-events-postgres.service.js";
import { closeAbandonedSession, isSessionAbandoned } from "./agent-heartbeat.js";

const CHECK_INTERVAL_MS = 30_000;

let sweepTimer = null;

async function sweepOnce() {
  const open = await fetchAllOpenPgSessions();
  for (const session of open) {
    if (await isSessionAbandoned(session)) {
      await closeAbandonedSession(session);
    }
  }
}

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
