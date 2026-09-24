import { logSafeWarn } from "../../http/sanitize-error.js";
import { recordSecurityEvent } from "../../core/metrics.js";
import { recordNotice } from "./record-notices.js";
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

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let timer = null;

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
    // A security event is for whoever reads the metrics; the day that does not
    // add up belongs to the person whose hours it is. Only a rollup that fell
    // short is worth telling them about - the other direction is not time
    // they are owed.
    if (a > b) {
      await recordNotice({
        memberId,
        kind: "totals_mismatch",
        secondsAffected: diffSeconds,
        detail: `sessions ${a}s vs rollup ${b}s`,
        day,
      }).catch((err) => logSafeWarn("[counter reconciliation] could not record the drift notice", err));
    }
  }
}

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
