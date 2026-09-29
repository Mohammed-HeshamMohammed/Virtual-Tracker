import { logSafeWarn } from "../../http/sanitize-error.js";
import { fetchAllOpenPgSessions } from "../../lib/postgres/activity-events-postgres.service.js";
import { withTenant } from "../../lib/postgres/client.js";
import { listActiveTenantIds } from "../../lib/postgres/active-tenants.js";
import { closeAbandonedSession, isSessionAbandoned } from "./agent-heartbeat.js";

const CHECK_INTERVAL_MS = 30_000;

let sweepTimer = null;

// §0.1 blocker 5 / §12.2 #6: this used to run one unscoped query across
// every tenant's sessions. Looping per tenant is safe to add today, before
// RLS is even live - assertIsolationReadyForNewTenant blocks a second
// tenant from existing until isolation is proven, so this is a
// single-iteration loop with identical behaviour until that changes.
async function sweepOnce() {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async () => {
      const open = await fetchAllOpenPgSessions();
      for (const session of open) {
        if (await isSessionAbandoned(session)) {
          await closeAbandonedSession(session);
        }
      }
    });
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
