import { estimateAssignmentSeconds } from "./task-assignments.js";
import {
  computeEffectiveDailyCap,
  computeTaskDailyHours,
  getMemberLimitHours,
  memberUsesShiftsForLimits,
} from "./task-workload-validation.js";
import { addLocalDays, localDayFor, weekdayIndexForLocalDay } from "../../lib/time/timezone-utils.js";
import { getMemberTimezone } from "../reports/member-timezones.js";
import { resolveProjectTimeZone } from "../../lib/time/resolve-time-zone.js";
import {
  sumDailyMemberActiveSeconds,
  sumDailyMemberTaskActiveSeconds,
  sumDailyMemberTaskActiveSecondsRange,
} from "../../lib/postgres/activity-events-postgres.service.js";
import { getTrackingRowPg, getTaskTrackingRowsPg } from "../../lib/postgres/task-member-progress.service.js";
import {
  getProjectBudgetPg,
  getProjectTrackedSecondsPg,
  getProjectMemberLimitPg,
  resolveMemberHourlyRatePg,
} from "../../lib/postgres/projects-postgres.service.js";

export const TIMER_LIMIT_REACHED_MESSAGE =
  "Maximum allowed work time for this task has been reached.";

function dayKey(ms, timeZone = "UTC") {
  return localDayFor(new Date(ms), timeZone);
}

/**
 * "Today" and the start of today's week, in the member's own timezone.
 *
 * `timeZone` is not optional in spirit - it defaults to UTC only so callers
 * that genuinely have no member context (and therefore no correct answer)
 * keep the previous behaviour rather than crashing. Anything deciding a
 * member's limits should pass their real zone; see `loadMemberCapContext`.
 *
 * The week start is derived from the local day string rather than by
 * subtracting milliseconds, because a week window that spans a DST
 * transition is not 7 * 86400 seconds long.
 */
export function currentDayRange(timeZone = "UTC") {
  const todayDay = localDayFor(new Date(), timeZone);
  return {
    todayDay,
    weekStartDay: addLocalDays(todayDay, -weekdayIndexForLocalDay(todayDay)),
  };
}

async function loadMemberCapContext(db, memberId, timeZone) {
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

  // The member's own calendar decides when their daily/weekly allowance
  // resets - not the server's. Someone in Cairo rolls over to a new day
  // hours before a UTC-clocked server thinks they do.
  const { todayDay, weekStartDay } = currentDayRange(timeZone);
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

export async function computeMemberTimerAllowance(db, memberId, options = {}) {
  const currentCumulativeActiveSeconds = Math.max(
    0,
    Math.floor(Number(options.currentCumulativeActiveSeconds ?? 0)),
  );
  const timeZone = await getMemberTimezone(memberId);
  const [ctx, projectBudgetRemainder, memberLimitRemainder] = await Promise.all([
    loadMemberCapContext(db, memberId, timeZone),
    loadPerPersonProjectBudgetRemainderSeconds(options.projectId ?? null, memberId),
    loadProjectMemberLimitRemainderSeconds(db, options.projectId ?? null, memberId, currentDayRange(timeZone)),
  ]);

  const remainders = [];
  if (ctx.memberDailyLimitSeconds > 0) {
    remainders.push(Math.max(0, ctx.memberDailyLimitSeconds - ctx.workedTodaySeconds));
  }
  if (ctx.memberWeeklyLimitSeconds > 0) {
    remainders.push(Math.max(0, ctx.memberWeeklyLimitSeconds - ctx.workedWeekSeconds));
  }
  if (projectBudgetRemainder != null) {
    remainders.push(projectBudgetRemainder);
  }
  if (memberLimitRemainder != null) {
    remainders.push(memberLimitRemainder);
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

async function resolveWorkedTodayOnTaskSeconds(memberId, taskId, task, todayDay, timeZone = "UTC") {
  if (!taskId) return 0;
  if (task?.rolling_hour_cap) {
    const tracking = await getTrackingRowPg(taskId, memberId);
    const sessionStart = tracking?.rolling_session_started_at;
    if (sessionStart) {
      const sessionStartDay = dayKey(new Date(sessionStart).getTime(), timeZone);
      return sumDailyMemberTaskActiveSecondsRange(memberId, taskId, {
        fromDay: sessionStartDay,
        toDay: todayDay,
      });
    }
  }
  return sumDailyMemberTaskActiveSeconds(memberId, taskId, todayDay);
}

export async function sumOtherAssigneesActiveSeconds(taskId, memberId) {
  if (!taskId) return 0;
  const rows = await getTaskTrackingRowsPg(taskId);
  return rows.reduce((sum, row) => {
    if (row.member_id === memberId) return sum;
    return sum + Math.max(0, Math.floor(Number(row.active_seconds) || 0));
  }, 0);
}

async function loadPerPersonProjectBudgetRemainderSeconds(projectId, memberId) {
  if (!projectId) return null;
  const budget = await getProjectBudgetPg(projectId);
  if (!budget || budget.type !== "Hours based" || budget.scope !== "per_person") return null;
  const capSeconds = Math.floor(Number(budget.cost ?? 0) * 3600);
  if (capSeconds <= 0) return null;
  const spentSeconds = await getProjectTrackedSecondsPg(projectId, {
    memberId,
    includeNonBillable: budget.include_non_billable_time !== false,
  });
  return Math.max(0, capSeconds - spentSeconds);
}

function memberLimitWindow(limit, todayDay, weekStartDay) {
  const startDate = limit.start_date ? toDayKey(limit.start_date) : null;
  if (startDate && startDate > todayDay) return { notStarted: true, fromDay: null };

  const resets = String(limit.resets || "Never").toLowerCase();
  let periodStart = null;
  if (resets === "weekly") {
    periodStart = weekStartDay;
  } else if (resets === "monthly") {
    const now = new Date();
    periodStart = toDayKey(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  if (periodStart && startDate) return { notStarted: false, fromDay: periodStart > startDate ? periodStart : startDate };
  return { notStarted: false, fromDay: periodStart ?? startDate };
}

function toDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dayKey(date.getTime());
}

async function loadProjectMemberLimitRemainderSeconds(db, projectId, memberId, dayRange) {
  if (!projectId || !memberId) return null;
  const limit = await getProjectMemberLimitPg(projectId, memberId);
  if (!limit) return null;
  const cap = Number(limit.cost ?? 0);
  if (!(cap > 0)) return null;

  const { notStarted, fromDay } = memberLimitWindow(limit, dayRange.todayDay, dayRange.weekStartDay);
  if (notStarted) return null;

  let capSeconds;
  if (String(limit.type || "").toLowerCase().includes("hour")) {
    capSeconds = Math.floor(cap * 3600);
  } else {
    const rate = await resolveMemberHourlyRatePg(db, projectId, memberId, limit.based_on ?? limit.basedOn);
    if (!(rate > 0)) return null;
    capSeconds = Math.floor((cap / rate) * 3600);
  }
  if (capSeconds <= 0) return null;

  const spentSeconds = await getProjectTrackedSecondsPg(projectId, {
    memberId,
    ...(fromDay ? { fromDate: fromDay } : {}),
  });
  return Math.max(0, capSeconds - spentSeconds);
}

export async function computeTimerAllowance(db, memberId, task, options = {}) {
  const currentCumulativeActiveSeconds = Math.max(
    0,
    Math.floor(Number(options.currentCumulativeActiveSeconds ?? 0)),
  );

  const taskDailyHours = computeTaskDailyHours(task);
  const taskDailyCapSeconds = taskDailyHours > 0 ? Math.floor(taskDailyHours * 3600) : 0;
  const totalTaskSeconds = estimateAssignmentSeconds(task);
  const taskId = typeof task.id === "string" ? task.id : String(task.id ?? task.task_id ?? "");
  const projectId = task.project_id ?? task.projectId ?? null;
  const timeZone = await getMemberTimezone(memberId);
  const dayRange = currentDayRange(timeZone);
  const { todayDay } = dayRange;

  // Task-scoped totals are bucketed in the project's calendar (see
  // lib/time/resolve-time-zone.js), so they have to be *read* in it too -
  // reading a project-day bucket with a member-day key would miss the row
  // whenever the two zones disagree. Identical unless the project declares
  // its own zone.
  const projectTimeZone = await resolveProjectTimeZone(projectId, memberId);
  const taskTodayDay = currentDayRange(projectTimeZone).todayDay;

  const [ctx, workedTodayOnTaskSeconds, othersActiveSeconds, projectBudgetRemainder, memberLimitRemainder] =
    await Promise.all([
      loadMemberCapContext(db, memberId, timeZone),
      resolveWorkedTodayOnTaskSeconds(memberId, taskId, task, taskTodayDay, projectTimeZone),
      task?.shared_task_budget ? sumOtherAssigneesActiveSeconds(taskId, memberId) : Promise.resolve(0),
      loadPerPersonProjectBudgetRemainderSeconds(projectId, memberId),
      loadProjectMemberLimitRemainderSeconds(db, projectId, memberId, dayRange),
    ]);
  const totalTaskConsumedSeconds = othersActiveSeconds + currentCumulativeActiveSeconds;

  if (ctx.usesShifts) {
    const shiftRemainders = [];
    if (totalTaskSeconds != null && totalTaskSeconds > 0) {
      shiftRemainders.push(Math.max(0, totalTaskSeconds - totalTaskConsumedSeconds));
    }
    if (projectBudgetRemainder != null) {
      shiftRemainders.push(projectBudgetRemainder);
    }
    if (memberLimitRemainder != null) {
      shiftRemainders.push(memberLimitRemainder);
    }
    const totalRemain = shiftRemainders.length > 0 ? Math.min(...shiftRemainders) : null;
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

  if (memberWeeklyLimitSeconds > 0) {
    remainders.push(Math.max(0, memberWeeklyLimitSeconds - workedWeekSeconds));
  }

  if (totalTaskSeconds != null && totalTaskSeconds > 0) {
    remainders.push(Math.max(0, totalTaskSeconds - totalTaskConsumedSeconds));
  }

  if (projectBudgetRemainder != null) {
    remainders.push(projectBudgetRemainder);
  }

  if (memberLimitRemainder != null) {
    remainders.push(memberLimitRemainder);
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
