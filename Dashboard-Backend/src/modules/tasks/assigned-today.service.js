// T5 (PLAN-livesyncandagenttimer.md §11) - "how much work is assigned to me
// today", a different question from computeMemberTimerAllowance's "how much
// am I still allowed to work". Both matter and both are reported alongside
// each other; this module only computes the demand side.
import { query } from "../../lib/postgres/client.js";
import { PROJECT_TYPES, isTaskLessProjectType } from "../projects/project-types.js";
import {
  estimateAssignmentSeconds,
  workingDaysForTask,
  countWorkingDaysBetween,
  computeTaskDailyHours,
} from "./task-schedule-math.js";

/**
 * due(a) for one open assignment row, per the allocation rules decided in
 * §11: a calling project's outstanding amount is fully due today (rule 1);
 * a task with no daily schedule owes its whole remainder; a task with a
 * schedule owes its daily share times the working days elapsed since
 * start, capped at what is actually outstanding. That cap is also the
 * rollover mechanism - fall behind on a scheduled task and tomorrow's term
 * grows on its own because the scheduled side keeps advancing while the
 * worked side does not - so there is no separate carry-forward state to
 * get out of sync. Past the due date the elapsed count saturates at the
 * task's own total working days, so an overdue task's whole remainder
 * falls due rather than staying capped at one day's share.
 * @param {{
 *   expected_seconds?: number | null,
 *   worked_seconds?: number | string | null,
 *   project_type?: string,
 *   start_date?: string | Date | null,
 *   due_date?: string | Date | null,
 *   duration_hours_per_day?: number | string | null,
 *   overtime_hours_per_day?: number | string | null,
 *   working_days?: number | null,
 *   duration_days?: number | null,
 * }} row
 * @param {Date} [today]
 */
export function computeAssignmentDueToday(row, today = new Date()) {
  const worked = Number(row.worked_seconds ?? 0) || 0;
  const expected = row.expected_seconds ?? estimateAssignmentSeconds(row) ?? 0;
  const outstanding = Math.max(0, expected - worked);
  if (outstanding <= 0) return { due: 0, rollover: 0 };

  // Rule 1: on a task-less project type (calling, support) the whole
  // outstanding amount is due today, not a per-day slice - there is no daily
  // schedule concept for work that isn't organized into tasks.
  if (isTaskLessProjectType(row.project_type)) return { due: outstanding, rollover: 0 };

  const dailyHours = computeTaskDailyHours(row);
  if (dailyHours <= 0) return { due: outstanding, rollover: 0 };

  const dailyShareSeconds = Math.floor(dailyHours * 3600);
  const totalWorkingDays = workingDaysForTask(row);
  const elapsed = row.start_date
    ? Math.min(totalWorkingDays, Math.max(0, countWorkingDaysBetween(row.start_date, today) ?? 0))
    : totalWorkingDays;
  const scheduledToDate = dailyShareSeconds * elapsed;
  const due = Math.min(outstanding, Math.max(0, scheduledToDate - worked));
  const rollover = Math.max(0, due - Math.min(due, dailyShareSeconds));
  return { due, rollover };
}

/** One query over task_assignments joined to tasks/projects/task_member_progress
 * for every open (not done) assignment of the member on a non-archived project. */
async function fetchOpenAssignmentRowsForMember(memberId) {
  return query(
    `SELECT
       ta.expected_seconds AS expected_seconds,
       t.start_date, t.due_date, t.duration_hours_per_day, t.overtime_hours_per_day,
       t.working_days, t.duration_days,
       p.type AS project_type,
       COALESCE(tmp.active_seconds, 0) AS worked_seconds
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN projects p ON p.id = ta.project_id
     LEFT JOIN task_member_progress tmp ON tmp.task_id = ta.task_id AND tmp.member_id = ta.member_id
     WHERE ta.member_id = $1 AND ta.status <> 'done' AND p.status <> 'archived'`,
    [memberId],
  );
}

/** Σ due(a) across every open assignment - the cap-independent demand half
 * of "assigned today". The caller folds in the member's own daily/weekly
 * allowance (already computed alongside this for the same endpoint) to get
 * plannedSeconds/deferredSeconds, so this stays a plain aggregate with no
 * cap dependency of its own and no risk of computing the cap twice. */
export async function computeAssignedTodayDemand(memberId) {
  const rows = await fetchOpenAssignmentRowsForMember(memberId);
  const today = new Date();
  let demandSeconds = 0;
  let rolloverSeconds = 0;
  let taskCount = 0;
  // One bucket per known type. Previously only normal/calling existed and
  // everything else fell into "normal", which would have silently folded the
  // newer types into the wrong total.
  const byProjectType = Object.fromEntries(PROJECT_TYPES.map((t) => [t, 0]));

  for (const row of rows) {
    const { due, rollover } = computeAssignmentDueToday(row, today);
    if (due <= 0) continue;
    demandSeconds += due;
    rolloverSeconds += rollover;
    taskCount += 1;
    const bucket = PROJECT_TYPES.includes(row.project_type) ? row.project_type : "normal";
    byProjectType[bucket] += due;
  }

  return { demandSeconds, rolloverSeconds, taskCount, byProjectType };
}

/** Applies the member's cap (null = uncapped, e.g. shift-based members) to
 * a demand aggregate. Kept separate from computeAssignedTodayDemand so the
 * route can resolve both the demand query and the member's allowance
 * concurrently and combine them once, instead of the cap forcing the query
 * to wait on the allowance call first. */
export function applyCapToAssignedTodayDemand(demand, capLeftTodaySeconds) {
  const plannedSeconds =
    capLeftTodaySeconds == null ? demand.demandSeconds : Math.min(demand.demandSeconds, capLeftTodaySeconds);
  return {
    demandSeconds: demand.demandSeconds,
    plannedSeconds,
    deferredSeconds: Math.max(0, demand.demandSeconds - plannedSeconds),
    rolloverSeconds: demand.rolloverSeconds,
    taskCount: demand.taskCount,
    byProjectType: demand.byProjectType,
  };
}
