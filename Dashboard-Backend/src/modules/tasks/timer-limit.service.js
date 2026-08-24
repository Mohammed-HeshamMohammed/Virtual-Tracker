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
import { getTrackingRowPg, getTaskTrackingRowsPg } from "../../lib/postgres/task-member-progress.service.js";
import {
  getProjectBudgetPg,
  getProjectTrackedSecondsPg,
  getProjectMemberLimitPg,
  resolveMemberHourlyRatePg,
} from "../../lib/postgres/projects-postgres.service.js";

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
 * projects). Only the member's own daily/weekly caps apply, plus - if the
 * project carries an Hours-based budget scoped 'per_person' - that project's
 * own per-member allotment. There is no task estimate or per-task daily cap
 * to enforce, which is the whole point of the "calling" project type.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {{ currentCumulativeActiveSeconds?: number, projectId?: string | null }} [options]
 */
export async function computeMemberTimerAllowance(db, memberId, options = {}) {
  const currentCumulativeActiveSeconds = Math.max(
    0,
    Math.floor(Number(options.currentCumulativeActiveSeconds ?? 0)),
  );
  const [ctx, projectBudgetRemainder, memberLimitRemainder] = await Promise.all([
    loadMemberCapContext(db, memberId),
    loadPerPersonProjectBudgetRemainderSeconds(options.projectId ?? null, memberId),
    loadProjectMemberLimitRemainderSeconds(db, options.projectId ?? null, memberId, currentDayRange()),
  ]);

  const remainders = [];
  if (ctx.memberDailyLimitSeconds > 0) {
    remainders.push(Math.max(0, ctx.memberDailyLimitSeconds - ctx.workedTodaySeconds));
  }
  // Both a daily and a weekly cap can be set together now (validated at
  // save time so daily x working days never exceeds weekly) - push both
  // remainders and let Math.min below apply whichever is tighter, instead
  // of only ever honoring one.
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
 * Sum of every OTHER assignee's currently-persisted active_seconds on a
 * shared_task_budget task - deliberately excludes the calling member's own
 * row so combining it with currentCumulativeActiveSeconds (whichever value a
 * caller passes: their own persisted total, or 0 for the TC-5 ceiling check
 * below) never double-counts, and the ceiling stays independent of the value
 * being checked against it - same TC-5 requirement as every other remainder
 * in this file.
 * @param {string} taskId
 * @param {string} memberId
 */
export async function sumOtherAssigneesActiveSeconds(taskId, memberId) {
  if (!taskId) return 0;
  const rows = await getTaskTrackingRowsPg(taskId);
  return rows.reduce((sum, row) => {
    if (row.member_id === memberId) return sum;
    return sum + Math.max(0, Math.floor(Number(row.active_seconds) || 0));
  }, 0);
}

/**
 * Remaining seconds under a project's *per-person* Hours-based budget for
 * one member - null when nothing applies (no project, no budget row, a
 * Cost-based budget, or scope !== 'per_person'), so callers can tell "not a
 * limit" apart from "limit is 0" the same way every other remainder here
 * does. Shared/`per_project` scope is deliberately NOT handled here - that
 * stays a team-wide-only gate via checkProjectBudgetCap in activity/routes.js,
 * so the same pool is never counted against two different mechanisms at once.
 * @param {string | null | undefined} projectId
 * @param {string} memberId
 */
async function loadPerPersonProjectBudgetRemainderSeconds(projectId, memberId) {
  if (!projectId) return null;
  const budget = await getProjectBudgetPg(projectId);
  if (!budget || budget.type !== "Hours based" || budget.scope !== "per_person") return null;
  // scope='per_person' rows store hours-per-member directly in `cost` (see
  // the identical comment in checkProjectBudgetCap) - no headcount scaling
  // needed here, unlike computeProjectBudgetTargetPg's team-wide use of it.
  const capSeconds = Math.floor(Number(budget.cost ?? 0) * 3600);
  if (capSeconds <= 0) return null;
  const spentSeconds = await getProjectTrackedSecondsPg(projectId, {
    memberId,
    includeNonBillable: budget.include_non_billable_time !== false,
  });
  return Math.max(0, capSeconds - spentSeconds);
}

/**
 * First day of the window a per-member project limit is measured over, as
 * 'YYYY-MM-DD', or null for "count everything ever logged".
 *
 * `resets` picks the period; `start_date` (when set) clips it, so a limit
 * configured mid-month never counts time logged before it existed. A
 * start_date in the future means the limit hasn't begun - signalled with
 * `notStarted` rather than a date, since there is no window to sum yet.
 */
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

  // Whichever is later: a limit that resets weekly but only started on
  // Wednesday must not count Monday and Tuesday.
  if (periodStart && startDate) return { notStarted: false, fromDay: periodStart > startDate ? periodStart : startDate };
  return { notStarted: false, fromDay: periodStart ?? startDate };
}

function toDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dayKey(date.getTime());
}

/**
 * Remaining seconds under this project's per-member limit
 * (project_member_limits - the "Members Limits" tab) for one member. This is
 * a tightening measure layered on top of the member's own daily/weekly cap,
 * never a replacement for it: it joins the same Math.min remainder list as
 * every other limit, so whichever is tighter wins.
 *
 * null when nothing applies - no row, no positive cap, not started yet, or an
 * amount-denominated limit with no rate configured to convert it into time.
 * That last case deliberately does NOT block: failing to configure a rate
 * should not make the project untrackable, and returning 0 would.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 */
async function loadProjectMemberLimitRemainderSeconds(db, projectId, memberId, dayRange) {
  if (!projectId || !memberId) return null;
  const limit = await getProjectMemberLimitPg(projectId, memberId);
  if (!limit) return null;
  const cap = Number(limit.cost ?? 0);
  if (!(cap > 0)) return null;

  const { notStarted, fromDay } = memberLimitWindow(limit, dayRange.todayDay, dayRange.weekStartDay);
  if (notStarted) return null;

  // "Hours limit" is already denominated in time. "Total cost"/"Amount limit"
  // are dollar caps, so they need the member's rate to become a time budget.
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
  const projectId = task.project_id ?? task.projectId ?? null;
  const { todayDay } = currentDayRange();

  const [ctx, workedTodayOnTaskSeconds, othersActiveSeconds, projectBudgetRemainder, memberLimitRemainder] =
    await Promise.all([
      loadMemberCapContext(db, memberId),
      resolveWorkedTodayOnTaskSeconds(memberId, taskId, task, todayDay),
      // Only shared_task_budget tasks pool across assignees - skip the extra
      // query entirely for the (default, common) per-person case.
      task?.shared_task_budget ? sumOtherAssigneesActiveSeconds(taskId, memberId) : Promise.resolve(0),
      loadPerPersonProjectBudgetRemainderSeconds(projectId, memberId),
      loadProjectMemberLimitRemainderSeconds(db, projectId, memberId, currentDayRange()),
    ]);
  // Per-person (default): 0, so this is a no-op and totalRemain/the
  // remainder below reduce to exactly what they were before this feature.
  const totalTaskConsumedSeconds = othersActiveSeconds + currentCumulativeActiveSeconds;

  if (ctx.usesShifts) {
    // Shift-based members skip the daily/weekly personal caps below, but a
    // task total and a project's own per-person budget are distinct limits
    // that still apply - same reasoning as totalTaskSeconds already did here
    // before this feature.
    const shiftRemainders = [];
    if (totalTaskSeconds != null && totalTaskSeconds > 0) {
      shiftRemainders.push(Math.max(0, totalTaskSeconds - totalTaskConsumedSeconds));
    }
    if (projectBudgetRemainder != null) {
      shiftRemainders.push(projectBudgetRemainder);
    }
    // A project-level per-member limit is not a personal daily/weekly cap, so
    // it survives the shift-scheduled exemption the same way the task total
    // and the project budget above do.
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

  // Same relaxation as computeMemberTimerAllowance above - both caps can be
  // active at once, Math.min below picks whichever is tighter.
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
