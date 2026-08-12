import { estimateAssignmentSeconds } from "./task-assignments.js";
import {
  computeEffectiveDailyCap,
  computeTaskDailyHours,
  getMemberLimitHours,
  memberUsesShiftsForLimits,
} from "./task-workload-validation.js";
import { getRollingWeekDays, startOfDay } from "../dashboard/dashboard-utils.js";
import {
  sumDailyMemberActiveSeconds,
  sumDailyMemberTaskActiveSeconds,
  sumDailyMemberTaskActiveSecondsRange,
} from "../../lib/postgres/activity-events-postgres.service.js";
import { getTrackingRowPg } from "../../lib/postgres/task-member-progress.service.js";

export const TIMER_LIMIT_REACHED_MESSAGE =
  "Maximum allowed work time for this task has been reached.";

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's day key, and the first day of the rolling week, in 'YYYY-MM-DD'. */
function currentDayRange() {
  const todayStart = startOfDay(new Date()).getTime();
  return {
    todayDay: dayKey(todayStart),
    weekStartDay: dayKey(getRollingWeekDays()[0]?.startMs ?? todayStart),
  };
}

/**
 * The member's own daily/weekly hour cap - entirely task-independent. Shared
 * by the task-anchored allowance below and by task-less (calling project)
 * timers, so there is one implementation of "personal hour cap", not two that
 * can drift.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
async function loadMemberCapContext(db, memberId) {
  if (await memberUsesShiftsForLimits(db, memberId)) {
    return {
      usesShifts: true,
      dailyLimitHours: 0,
      memberDailyLimitSeconds: 0,
      memberWeeklyLimitSeconds: 0,
      workedTodaySeconds: 0,
      workedWeekSeconds: 0,
    };
  }

  const [weeklyLimitHours, dailyLimitHours] = await Promise.all([
    getMemberLimitHours(db, memberId, "weekly"),
    getMemberLimitHours(db, memberId, "daily"),
  ]);

  const { todayDay, weekStartDay } = currentDayRange();
  const [workedTodaySeconds, workedWeekSeconds] = await Promise.all([
    sumDailyMemberActiveSeconds(memberId, { fromDay: todayDay, toDay: todayDay }),
    sumDailyMemberActiveSeconds(memberId, { fromDay: weekStartDay, toDay: todayDay }),
  ]);

  return {
    usesShifts: false,
    dailyLimitHours,
    memberDailyLimitSeconds: dailyLimitHours > 0 ? Math.floor(dailyLimitHours * 3600) : 0,
    memberWeeklyLimitSeconds: weeklyLimitHours > 0 ? Math.floor(weeklyLimitHours * 3600) : 0,
    workedTodaySeconds,
    workedWeekSeconds,
  };
}

/**
 * Remaining active seconds for a member with no task in play (calling
 * projects). Only the member's own daily/weekly caps apply - there is no task
 * estimate or per-task daily cap to enforce, which is the whole point of the
 * "calling" project type.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {{ currentCumulativeActiveSeconds?: number }} [options]
 */
export async function computeMemberTimerAllowance(db, memberId, options = {}) {
  const currentCumulativeActiveSeconds = Math.max(
    0,
    Math.floor(Number(options.currentCumulativeActiveSeconds ?? 0)),
  );
  const ctx = await loadMemberCapContext(db, memberId);

  const remainders = [];
  if (ctx.memberDailyLimitSeconds > 0) {
    remainders.push(Math.max(0, ctx.memberDailyLimitSeconds - ctx.workedTodaySeconds));
  }
  if (ctx.memberWeeklyLimitSeconds > 0 && ctx.dailyLimitHours <= 0) {
    remainders.push(Math.max(0, ctx.memberWeeklyLimitSeconds - ctx.workedWeekSeconds));
  }

  return buildAllowanceResult({
    allowedRemainingSeconds: remainders.length > 0 ? Math.min(...remainders) : null,
    currentCumulativeActiveSeconds,
    taskDailyCapSeconds: 0,
    memberDailyLimitSeconds: ctx.memberDailyLimitSeconds,
    memberWeeklyLimitSeconds: ctx.memberWeeklyLimitSeconds,
    workedTodaySeconds: ctx.workedTodaySeconds,
    workedTodayOnTaskSeconds: 0,
    workedWeekSeconds: ctx.workedWeekSeconds,
  });
}

/**
 * "Today"'s worked-on-task seconds for daily-cap enforcement - or, for a
 * rolling_hour_cap task with a currently-open session (rolling_session_started_at
 * set - see its doc comment in ensure-lookup-schema.js), the sum across every
 * calendar day that session has spanned so far. That's what lets an 8h/day
 * task's cap survive a midnight rollover as one continuous budget instead of
 * granting a fresh allowance the moment the day-bucket flips. Falls back to
 * the plain single-day sum if the task isn't rolling, or has no open session
 * (e.g. already stopped) - identical to the pre-existing behavior.
 * @param {string} memberId
 * @param {string} taskId
 * @param {Record<string, unknown>} task
 * @param {string} todayDay
 */
async function resolveWorkedTodayOnTaskSeconds(memberId, taskId, task, todayDay) {
  if (!taskId) return 0;
  if (task?.rolling_hour_cap) {
    const tracking = await getTrackingRowPg(taskId, memberId);
    const sessionStart = tracking?.rolling_session_started_at;
    if (sessionStart) {
      const sessionStartDay = dayKey(new Date(sessionStart).getTime());
      return sumDailyMemberTaskActiveSecondsRange(memberId, taskId, {
        fromDay: sessionStartDay,
        toDay: todayDay,
      });
    }
  }
  return sumDailyMemberTaskActiveSeconds(memberId, taskId, todayDay);
}

/**
 * Remaining active seconds for a member on a task (daily caps, limits, time already logged).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {Record<string, unknown>} task
 * @param {{ currentCumulativeActiveSeconds?: number }} [options]
 */
export async function computeTimerAllowance(db, memberId, task, options = {}) {
  const currentCumulativeActiveSeconds = Math.max(
    0,
    Math.floor(Number(options.currentCumulativeActiveSeconds ?? 0)),
  );

  const taskDailyHours = computeTaskDailyHours(task);
  const taskDailyCapSeconds = taskDailyHours > 0 ? Math.floor(taskDailyHours * 3600) : 0;
  const totalTaskSeconds = estimateAssignmentSeconds(task);
  const taskId = typeof task.id === "string" ? task.id : String(task.id ?? task.task_id ?? "");
  const { todayDay } = currentDayRange();

  const [ctx, workedTodayOnTaskSeconds] = await Promise.all([
    loadMemberCapContext(db, memberId),
    resolveWorkedTodayOnTaskSeconds(memberId, taskId, task, todayDay),
  ]);

  if (ctx.usesShifts) {
    const totalRemain =
      totalTaskSeconds != null && totalTaskSeconds > 0
        ? Math.max(0, totalTaskSeconds - currentCumulativeActiveSeconds)
        : null;
    return buildAllowanceResult({
      allowedRemainingSeconds: totalRemain,
      currentCumulativeActiveSeconds,
      taskDailyCapSeconds,
      memberDailyLimitSeconds: 0,
      memberWeeklyLimitSeconds: 0,
      workedTodaySeconds: 0,
      workedTodayOnTaskSeconds: 0,
      workedWeekSeconds: 0,
    });
  }

  const { dailyLimitHours, memberDailyLimitSeconds, memberWeeklyLimitSeconds } = ctx;
  const { workedTodaySeconds, workedWeekSeconds } = ctx;

  const effectiveDailyCapHours = computeEffectiveDailyCap(taskDailyHours, dailyLimitHours);
  const effectiveDailyCapSeconds =
    effectiveDailyCapHours > 0 ? Math.floor(effectiveDailyCapHours * 3600) : 0;

  const remainders = [];

  if (effectiveDailyCapSeconds > 0) {
    remainders.push(Math.max(0, effectiveDailyCapSeconds - workedTodayOnTaskSeconds));
  } else if (taskDailyCapSeconds > 0) {
    remainders.push(Math.max(0, taskDailyCapSeconds - workedTodayOnTaskSeconds));
  }

  if (memberDailyLimitSeconds > 0) {
    remainders.push(Math.max(0, memberDailyLimitSeconds - workedTodaySeconds));
  }

  if (memberWeeklyLimitSeconds > 0 && dailyLimitHours <= 0) {
    remainders.push(Math.max(0, memberWeeklyLimitSeconds - workedWeekSeconds));
  }

  if (totalTaskSeconds != null && totalTaskSeconds > 0) {
    remainders.push(Math.max(0, totalTaskSeconds - currentCumulativeActiveSeconds));
  }

  const allowedRemainingSeconds =
    remainders.length > 0 ? Math.min(...remainders) : null;

  return buildAllowanceResult({
    allowedRemainingSeconds,
    currentCumulativeActiveSeconds,
    taskDailyCapSeconds: effectiveDailyCapSeconds || taskDailyCapSeconds,
    memberDailyLimitSeconds,
    memberWeeklyLimitSeconds,
    workedTodaySeconds,
    workedTodayOnTaskSeconds,
    workedWeekSeconds,
  });
}

/**
 * @param {object} input
 */
function buildAllowanceResult(input) {
  const {
    allowedRemainingSeconds,
    currentCumulativeActiveSeconds,
    taskDailyCapSeconds,
    memberDailyLimitSeconds,
    memberWeeklyLimitSeconds,
    workedTodaySeconds,
    workedTodayOnTaskSeconds,
    workedWeekSeconds,
  } = input;

  const limitReached = allowedRemainingSeconds !== null && allowedRemainingSeconds <= 0;
  const maxCumulativeActiveSeconds =
    allowedRemainingSeconds !== null
      ? currentCumulativeActiveSeconds + allowedRemainingSeconds
      : null;

  return {
    allowedRemainingSeconds,
    maxCumulativeActiveSeconds,
    limitReached,
    message: limitReached ? TIMER_LIMIT_REACHED_MESSAGE : "",
    taskDailyCapSeconds,
    memberDailyLimitSeconds,
    memberWeeklyLimitSeconds,
    workedTodaySeconds,
    workedTodayOnTaskSeconds,
    workedWeekSeconds,
  };
}

/**
 * TC-5: the ceiling this checks `activeSeconds` against must be independent
 * of `activeSeconds` itself. The `allowance` computed above passes the
 * incoming value in as `currentCumulativeActiveSeconds`, which makes
 * `buildAllowanceResult`'s `maxCumulativeActiveSeconds` derive from that same
 * value (`currentCumulativeActiveSeconds + allowedRemainingSeconds`, and
 * every remainder is `Math.max(0, ...)`) - so `activeSeconds >
 * maxCumulativeActiveSeconds` reduces to `0 > allowedRemainingSeconds`,
 * which is never true. `capped` was always false; a session that started
 * under a cap could run past it indefinitely.
 *
 * Ask for the absolute ceiling instead, by computing the allowance as if
 * nothing had been worked yet (`currentCumulativeActiveSeconds: 0`) - none of
 * the other remainders in computeTimerAllowance depend on that value, so this
 * yields the true cap, not one derived from the number being checked against it.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {Record<string, unknown>} task
 * @param {number} activeSeconds
 * @param {string} action
 */
export async function enforceTimerAllowanceOnSync(db, memberId, task, activeSeconds, action) {
  const allowance = await computeTimerAllowance(db, memberId, task, {
    currentCumulativeActiveSeconds: activeSeconds,
  });

  if ((action === "start" || action === "resume") && allowance.limitReached) {
    const err = new Error(allowance.message || TIMER_LIMIT_REACHED_MESSAGE);
    err.code = "TIMER_LIMIT_REACHED";
    throw err;
  }

  const ceilingAllowance = await computeTimerAllowance(db, memberId, task, {
    currentCumulativeActiveSeconds: 0,
  });
  const ceiling = ceilingAllowance.maxCumulativeActiveSeconds;

  let cappedActive = activeSeconds;
  let capped = false;
  if (ceiling != null && activeSeconds > ceiling) {
    cappedActive = ceiling;
    capped = true;
  }

  return { activeSeconds: cappedActive, capped, allowance };
}
