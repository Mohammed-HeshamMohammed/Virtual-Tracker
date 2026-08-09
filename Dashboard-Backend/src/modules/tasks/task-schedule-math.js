// Pure task-scheduling arithmetic, split out of task-assignments.js and
// task-workload-validation.js so it can be imported without dragging in
// either file's much larger transitive dependency graph (Postgres services,
// notifications, member-relationships, ...) - those two files still own the
// read/write assignment lifecycle and re-export these names for their
// existing callers. Deliberately dependency-free: no Postgres, no
// Firestore, just date/number math.

export function toIso(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

function parseDate(value) {
  const iso = toIso(value);
  if (!iso) return null;
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Count Mon–Fri between start and due (inclusive). */
export function countWorkingDaysBetween(startValue, endValue) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end) return null;
  if (end.getTime() < start.getTime()) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/** Exported so callers (e.g. getTaskTimeTracking) can show "7 days x 8h/day"
 * as a distinct breakdown instead of only ever seeing it pre-multiplied. */
export function workingDaysForTask(taskData) {
  let workingDays = countWorkingDaysBetween(
    taskData.start_date ?? taskData.startDate,
    taskData.due_date ?? taskData.dueDate,
  );
  if (workingDays == null || workingDays <= 0) {
    workingDays = Number(taskData.working_days ?? taskData.workingDays ?? taskData.duration_days ?? taskData.durationDays ?? 0);
  }
  if (workingDays <= 0) workingDays = 1;
  return workingDays;
}

export function estimateAssignmentSeconds(taskData) {
  if (!taskData) return null;
  const hoursPerDay = Number(taskData.duration_hours_per_day ?? taskData.durationHoursPerDay ?? 0);
  const overtimePerDay = Number(taskData.overtime_hours_per_day ?? taskData.overtimeHoursPerDay ?? 0);
  const hoursTotal = hoursPerDay + overtimePerDay;
  if (hoursTotal <= 0) return null;

  return Math.floor(workingDaysForTask(taskData) * hoursTotal * 3600);
}

/** Overtime-only portion of estimateAssignmentSeconds, so callers can show it distinctly
 * instead of it only ever appearing silently folded into the combined total. */
export function estimateAssignmentOvertimeSeconds(taskData) {
  if (!taskData) return null;
  const overtimePerDay = Number(taskData.overtime_hours_per_day ?? taskData.overtimeHoursPerDay ?? 0);
  if (overtimePerDay <= 0) return null;

  return Math.floor(workingDaysForTask(taskData) * overtimePerDay * 3600);
}

/** @deprecated Use estimateAssignmentSeconds */
export function estimateTaskDurationSeconds(taskData) {
  return estimateAssignmentSeconds(taskData);
}

/** hours/day + overtime/day */
export function computeTaskDailyHours(task) {
  const hoursPerDay = Number(task.duration_hours_per_day ?? task.durationHoursPerDay ?? 0);
  const overtimePerDay = Number(task.overtime_hours_per_day ?? task.overtimeHoursPerDay ?? 0);
  const total = hoursPerDay + overtimePerDay;
  return Number.isFinite(total) && total > 0 ? total : 0;
}
