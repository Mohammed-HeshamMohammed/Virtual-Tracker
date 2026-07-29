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
} from "../../lib/postgres/activity-events-postgres.service.js";

export const TIMER_LIMIT_REACHED_MESSAGE =
  "Maximum allowed work time for this task has been reached.";

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
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

  if (await memberUsesShiftsForLimits(db, memberId)) {
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

  const [weeklyLimitHours, dailyLimitHours] = await Promise.all([
    getMemberLimitHours(db, memberId, "weekly"),
    getMemberLimitHours(db, memberId, "daily"),
  ]);

  const effectiveDailyCapHours = computeEffectiveDailyCap(taskDailyHours, dailyLimitHours);
  const effectiveDailyCapSeconds =
    effectiveDailyCapHours > 0 ? Math.floor(effectiveDailyCapHours * 3600) : 0;
  const memberDailyLimitSeconds = dailyLimitHours > 0 ? Math.floor(dailyLimitHours * 3600) : 0;
  const memberWeeklyLimitSeconds = weeklyLimitHours > 0 ? Math.floor(weeklyLimitHours * 3600) : 0;

  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const weekDays = getRollingWeekDays();
  const weekStartDay = dayKey(weekDays[0]?.startMs ?? todayStart);
  const todayDay = dayKey(todayStart);
  const taskId = typeof task.id === "string" ? task.id : String(task.id ?? task.task_id ?? "");

  const [workedTodaySeconds, workedTodayOnTaskSeconds, workedWeekSeconds] = await Promise.all([
    sumDailyMemberActiveSeconds(memberId, { fromDay: todayDay, toDay: todayDay }),
    taskId ? sumDailyMemberTaskActiveSeconds(memberId, taskId, todayDay) : Promise.resolve(0),
    sumDailyMemberActiveSeconds(memberId, { fromDay: weekStartDay, toDay: todayDay }),
  ]);

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

  let cappedActive = activeSeconds;
  let capped = false;
  if (
    allowance.maxCumulativeActiveSeconds != null &&
    activeSeconds > allowance.maxCumulativeActiveSeconds
  ) {
    cappedActive = allowance.maxCumulativeActiveSeconds;
    capped = true;
  }

  return { activeSeconds: cappedActive, capped, allowance };
}
