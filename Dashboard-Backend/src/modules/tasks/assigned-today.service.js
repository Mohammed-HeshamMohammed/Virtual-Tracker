import { query } from "../../lib/postgres/client.js";
import { PROJECT_TYPES, isTaskLessProjectType } from "../projects/project-types.js";
import {
  estimateAssignmentSeconds,
  workingDaysForTask,
  countWorkingDaysBetween,
  computeTaskDailyHours,
} from "./task-schedule-math.js";

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

  return { demandSeconds, rolloverSeconds, taskCount, byProjectType };
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
  };
}
