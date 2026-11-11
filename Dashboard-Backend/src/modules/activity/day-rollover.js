import { localDayFor } from "../../lib/time/timezone-utils.js";
import { resolveProjectTimeZone } from "../../lib/time/resolve-time-zone.js";
import {
  recordSessionEventPg,
  sessionRunningTotals,
  updatePgSession,
} from "../../lib/postgres/activity-events-postgres.service.js";

/**
 * A session's time belongs to the day it started - right for a shift that runs past
 * midnight, wrong for a Pause or Break that does: a Pause never ends by itself, so
 * pausing at 6pm and resuming at 9am put the whole next day on the day before.
 *
 * When `open` is paused and `now` falls on a later day in the session's own calendar
 * (its project's zone, else the member's - session-day-sql.js), this closes it as it
 * stands (`day_rollover`) and returns what the caller needs to open the replacement:
 * the task, and the running totals to seed it with so nothing is counted twice
 * (createPgSession). Returns null, touching nothing, in every other case.
 */
export async function closeIfPausedAcrossDays(open, { memberId, now, projectId = null, source, clientVersion = null }) {
  if (!open || open.status === "active") return null;
  const zone = await resolveProjectTimeZone(open.project_id ?? projectId, memberId);
  if (localDayFor(new Date(open.started_at), zone) === localDayFor(now, zone)) return null;

  await updatePgSession(open.id, {
    status: "stopped",
    endedAt: now,
    updatedAt: now,
    stopReason: "day_rollover",
    stoppedBy: memberId,
  });
  void recordSessionEventPg({
    sessionId: open.id,
    action: "stop",
    reason: "day_rollover",
    actorId: memberId,
    source,
    clientVersion,
  });
  return { taskId: open.task_id ?? null, totals: sessionRunningTotals(open) };
}
