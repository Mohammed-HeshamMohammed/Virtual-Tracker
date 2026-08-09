import { logSafeWarn } from "../../http/sanitize-error.js";
import { recordSecurityEvent } from "../../core/metrics.js";
import {
  findDriftedMembers,
  DAILY_DRIFT_THRESHOLD_SECONDS,
  LIFETIME_DRIFT_THRESHOLD_SECONDS,
} from "./counter-reconciliation.js";
import {
  fetchSessionActiveSecondsByMemberForDayPg,
  fetchDailyRollupByMemberForDayPg,
  fetchLifetimeTaskProgressByMemberPg,
  fetchLifetimeDailyRollupByMemberPg,
} from "../../lib/postgres/counter-reconciliation-postgres.service.js";

// OBS-1: a daily job, not a tick - the three stores it compares only fully
// settle once a day is over (activity_sessions.active_seconds keeps growing
// while a session is still open), so checking more often would just report
// normal in-flight lag as false "drift".
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let timer = null;

/** Idempotent - a second call while already scheduled is a no-op, same as the other sweep jobs. */
export function scheduleCounterReconciliationSweep() {
  if (timer) return;
  const run = () => reconcileCounters().catch((err) => logSafeWarn("[counter reconciliation]", err));
  run();
  timer = setInterval(run, CHECK_INTERVAL_MS);
  timer.unref?.();
}

export async function reconcileCounters() {
  await Promise.all([reconcileYesterdaysSessions(), reconcileLifetimeTaskProgress()]);
}

async function reconcileYesterdaysSessions() {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const day = yesterday.toISOString().slice(0, 10);

  const [sessionTotals, rollupTotals] = await Promise.all([
    fetchSessionActiveSecondsByMemberForDayPg(day),
    fetchDailyRollupByMemberForDayPg(day),
  ]);
  const drifted = findDriftedMembers(sessionTotals, rollupTotals, DAILY_DRIFT_THRESHOLD_SECONDS);
  for (const { memberId, a, b, diffSeconds } of drifted) {
    recordSecurityEvent({
      event: "daily_counter_drift",
      detail: `member=${memberId} day=${day} activity_sessions=${a}s daily_rollup=${b}s diff=${diffSeconds}s`,
    });
  }
}

/**
 * task_member_progress carries no day column - it's a lifetime total per
 * (task, member), not per day - so this can only compare lifetime sums, not
 * pinpoint which day drifted. Ceiling: a real drift on an otherwise-quiet
 * account could take a while to clear the threshold here. Upgrade path if
 * that ever matters: daily_member_task_active_seconds already carries a day
 * column per (member, task) and could reconcile day-by-day the same way the
 * session check does - not built now since nothing today needs day-level
 * precision on the task-progress side specifically.
 */
async function reconcileLifetimeTaskProgress() {
  const [taskProgressTotals, rollupTotals] = await Promise.all([
    fetchLifetimeTaskProgressByMemberPg(),
    fetchLifetimeDailyRollupByMemberPg(),
  ]);
  const drifted = findDriftedMembers(taskProgressTotals, rollupTotals, LIFETIME_DRIFT_THRESHOLD_SECONDS);
  for (const { memberId, a, b, diffSeconds } of drifted) {
    recordSecurityEvent({
      event: "lifetime_counter_drift",
      detail: `member=${memberId} task_member_progress=${a}s daily_rollup_lifetime=${b}s diff=${diffSeconds}s`,
    });
  }
}
