import { query } from "../../lib/postgres/client.js";
import { PROJECT_TYPES, isTaskLessProjectType } from "../projects/project-types.js";
import {
  estimateAssignmentSeconds,
  workingDaysForTask,
  countWorkingDaysBetween,
  computeTaskDailyHours,
} from "./task-schedule-math.js";
import { loadPerPersonProjectBudgetTotals } from "./timer-limit.service.js";

export function computeAssignmentDueToday(row, today = new Date()) {
  const worked = Number(row.worked_seconds ?? 0) || 0;
  const expected = row.expected_seconds ?? estimateAssignmentSeconds(row) ?? 0;
  const outstanding = Math.max(0, expected - worked);
  if (outstanding <= 0) return { due: 0, rollover: 0 };

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

async function fetchOpenAssignmentRowsForMember(memberId) {
  return query(
    `SELECT
       ta.project_id,
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

/**
 * Projects this member belongs to that never have tasks at all - calling,
 * support: the project itself is what gets clocked against, via
 * project_members, not task_assignments. computeAssignedTodayDemand's main
 * query is task_assignments-rooted, so a member who only clocks into
 * projects like these produced zero rows there and vanished from "assigned
 * to me" entirely, even while actively tracking time against a real budget.
 */
async function fetchTaskLessProjectMembershipsForMember(memberId) {
  const rows = await query(
    `SELECT pm.project_id, p.type AS project_type
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     WHERE pm.member_id = $1 AND p.status <> 'archived'`,
    [memberId],
  );
  return rows.filter((row) => isTaskLessProjectType(row.project_type));
}

/**
 * Rolls those task-less memberships into the same shape accumulateTaskRowTotals
 * produces. Every project the member belongs to counts toward
 * `projectIds` (that's the membership fact this exists to surface) but
 * only contributes hours when it declares a per-person Hours-based budget
 * - loadPerPersonProjectBudgetTotals, the exact rule that already gates
 * this member's timer on the same project. A membership with no such
 * budget has no numeric target to report; it still shows up in the
 * project count, just with nothing added to assigned/worked/remaining.
 */
async function accumulateTaskLessProjectTotals(memberId, projectIds) {
  const memberships = await fetchTaskLessProjectMembershipsForMember(memberId);
  const budgets = await Promise.all(
    memberships.map((row) => loadPerPersonProjectBudgetTotals(row.project_id, memberId)),
  );

  let assignedSeconds = 0;
  let workedSeconds = 0;
  let remainingSeconds = 0;
  memberships.forEach((row, i) => {
    projectIds.add(row.project_id);
    const budget = budgets[i];
    if (!budget) return;
    assignedSeconds += budget.capSeconds;
    workedSeconds += budget.spentSeconds;
    remainingSeconds += Math.max(0, budget.capSeconds - budget.spentSeconds);
  });

  return { assignedSeconds, workedSeconds, remainingSeconds };
}

/**
 * Everything still on this person's plate, ignoring the calendar entirely.
 *
 * "Assigned today" answers "what does my schedule owe today"; this answers
 * "how much work am I holding, full stop" - every open assignment in every
 * unarchived project, whether it is scheduled for today, overdue, or not
 * started yet. Same rows, same pass: it is the un-scheduled total the daily
 * figure is carved out of.
 *
 * `workedSeconds` is what has actually been tracked against those
 * assignments and is not clamped to the estimate - someone can and does
 * overrun, and hiding that would make `assigned - worked` disagree with
 * `remaining`, which is computed per assignment so one overrun task cannot
 * eat another task's outstanding hours.
 */
function accumulateTaskRowTotals(rows, projectIds) {
  let assignedSeconds = 0;
  let workedSeconds = 0;
  let remainingSeconds = 0;

  for (const row of rows) {
    const expected = Number(row.expected_seconds ?? estimateAssignmentSeconds(row) ?? 0) || 0;
    const worked = Number(row.worked_seconds ?? 0) || 0;
    assignedSeconds += expected;
    workedSeconds += worked;
    remainingSeconds += Math.max(0, expected - worked);
    if (row.project_id) projectIds.add(row.project_id);
  }

  return { assignedSeconds, workedSeconds, remainingSeconds };
}

export async function computeAssignedTodayDemand(memberId) {
  const rows = await fetchOpenAssignmentRowsForMember(memberId);
  const today = new Date();
  let demandSeconds = 0;
  let rolloverSeconds = 0;
  let taskCount = 0;
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

  // "Assigned today" stays task_assignments-only above - task-less projects
  // have no daily schedule to be due against. The un-scheduled total below
  // is where they belong: every project this person can clock into, task
  // or no task.
  const projectIds = new Set();
  const taskTotals = accumulateTaskRowTotals(rows, projectIds);
  const taskLessTotals = await accumulateTaskLessProjectTotals(memberId, projectIds);

  const total = {
    assignedSeconds: taskTotals.assignedSeconds + taskLessTotals.assignedSeconds,
    workedSeconds: taskTotals.workedSeconds + taskLessTotals.workedSeconds,
    remainingSeconds: taskTotals.remainingSeconds + taskLessTotals.remainingSeconds,
    taskCount: rows.length,
    projectCount: projectIds.size,
  };

  return { demandSeconds, rolloverSeconds, taskCount, byProjectType, total };
}

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
    total: demand.total,
  };
}
