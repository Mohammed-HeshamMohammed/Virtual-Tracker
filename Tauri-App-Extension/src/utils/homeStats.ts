import type { DashboardSummary, MemberLimits, ProjectBudgetStatus, TaskTimeTracking } from "../types";
import { fmtHours, fmtLimitHours } from "./formatters";

// Ring geometry: r=26 in a 60x60 box, so the arc length is 2*pi*26. Shared by
// both rings the app draws (today's Activity tile, the sidebar's Weekly
// activity ring) so they stay one family instead of two different shapes.
export const ACTIVITY_RING_CIRCUMFERENCE = 2 * Math.PI * 26;

export type HomeStatsInput = {
  memberLimits: MemberLimits | null;
  dashboardSummary: DashboardSummary | null;
  projectBudget: ProjectBudgetStatus | null;
  taskTracking: TaskTimeTracking | null;
  liveWorkedTodaySeconds: number;
  tracking: boolean;
};

/**
 * Every label/percent/dash-array the Today panel, the three stat tiles, the
 * sidebar's Weekly activity ring, and the This-task panel display - pulled
 * out of App.tsx's render body verbatim (same logic, same comments) so it's
 * one pure, unit-tested function instead of ~150 lines of inline `const`s
 * that only ever ran as a side effect of rendering.
 */
export function computeHomeStats({
  memberLimits,
  dashboardSummary,
  projectBudget,
  taskTracking,
  liveWorkedTodaySeconds,
  tracking,
}: HomeStatsInput) {
  // The member's own daily cap, as a ceiling the day panel measures against
  // rather than a tile of its own - a static config value was being given the
  // same weight as "can I keep working".
  const dailyCapSeconds =
    memberLimits && !memberLimits.usesShifts && memberLimits.dailyHours > 0
      ? Math.floor(memberLimits.dailyHours * 3600)
      : 0;
  const dailyCapLabel = !memberLimits
    ? "—"
    : memberLimits.usesShifts
      ? "By shifts"
      : memberLimits.dailyHours > 0
        ? fmtLimitHours(memberLimits.dailyHours)
        : memberLimits.weeklyHours > 0
          ? `${fmtLimitHours(memberLimits.weeklyHours)}/wk`
          : "No hour limit";
  // What the day panel says opposite the headline when there is no wall-clock
  // projection to show (not tracking, no cap, or the cap already spent).
  const dailyCapLeftLabel = !memberLimits
    ? "—"
    : memberLimits.usesShifts || memberLimits.allowedRemainingSeconds == null
      ? "No cap"
      : memberLimits.limitReached
        ? "Limit reached"
        : fmtHours(memberLimits.allowedRemainingSeconds);
  const workedTodayLabel = memberLimits ? fmtHours(liveWorkedTodaySeconds) : "—";
  const dayUsedPercent =
    dailyCapSeconds > 0 ? Math.min(100, (liveWorkedTodaySeconds / dailyCapSeconds) * 100) : 0;
  const dayOverPercent =
    dailyCapSeconds > 0
      ? Math.min(100 - dayUsedPercent, (Math.max(0, liveWorkedTodaySeconds - dailyCapSeconds) / dailyCapSeconds) * 100)
      : 0;
  // Not a working day, or one only worked because of a flagged makeup day -
  // both already arrive on every poll and were never shown anywhere.
  const dayHint = !memberLimits
    ? ""
    : memberLimits.isMakeupDay
      ? "makeup day"
      : memberLimits.workingToday
        ? ""
        : "not a working day";

  // The measure the dashboard actually grades on (active / active+idle), which
  // the agent never showed - so the number someone is judged by was only
  // visible by opening the web app. Idle time is what the 5/10/15-minute
  // banners below warn about while it accrues; this is the running total.
  const activityToday = memberLimits?.todayActivity;
  const activityTrackedSeconds = activityToday
    ? activityToday.activeSeconds + activityToday.idleSeconds
    : 0;
  const activityPercent =
    activityTrackedSeconds > 0
      ? Math.round((activityToday!.activeSeconds / activityTrackedSeconds) * 100)
      : null;
  const activityLabel = activityPercent == null ? "—" : `${activityPercent}%`;
  const activityDash =
    activityPercent == null ? 0 : (activityPercent / 100) * ACTIVITY_RING_CIRCUMFERENCE;

  // The week's activity ring - same percentage as the web dashboard's own
  // "Weekly trends" widget, drawn with the exact ring math above so the
  // sidebar's two rings read as one family instead of two different charts.
  const weekActivityDash = dashboardSummary
    ? (dashboardSummary.activityWeekPercent / 100) * ACTIVITY_RING_CIRCUMFERENCE
    : 0;
  const weekActiveSeconds = (dashboardSummary?.weeklyActivity ?? []).reduce(
    (sum, day) => sum + day.activeHours * 3600,
    0,
  );
  const weekIdleSeconds = (dashboardSummary?.weeklyActivity ?? []).reduce(
    (sum, day) => sum + day.idleHours * 3600,
    0,
  );

  // Weekly cap holders were flying blind: weeklyHours only ever appeared as a
  // fallback label on the Daily cap card when no daily cap existed, so there
  // was no way to see where the week stood until it ran out.
  const weeklyCapSeconds =
    memberLimits && !memberLimits.usesShifts && memberLimits.weeklyHours > 0
      ? Math.floor(memberLimits.weeklyHours * 3600)
      : 0;
  const weekWorkedLabel = memberLimits ? fmtHours(memberLimits.workedWeekSeconds) : "—";
  const weekUsedPercent =
    weeklyCapSeconds > 0 && memberLimits
      ? Math.min(100, (memberLimits.workedWeekSeconds / weeklyCapSeconds) * 100)
      : 0;
  const weekOfLabel = weeklyCapSeconds > 0 && memberLimits ? `of ${fmtLimitHours(memberLimits.weeklyHours)}` : "";
  const weekFootLabel = !memberLimits
    ? ""
    : memberLimits.usesShifts
      ? "shift-based — no weekly cap"
      : weeklyCapSeconds > 0
        ? `${fmtHours(Math.max(0, weeklyCapSeconds - memberLimits.workedWeekSeconds))} left`
        : "no weekly cap";

  // "2h 15m left" makes you do the arithmetic; a wall-clock time doesn't.
  // Only meaningful while the timer is actually running toward the cap.
  const projectedCapTimeLabel = (() => {
    if (!memberLimits || memberLimits.usesShifts) return "";
    const remaining = memberLimits.allowedRemainingSeconds;
    if (remaining == null || remaining <= 0 || !tracking) return "";
    const at = new Date(Date.now() + remaining * 1000);
    return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  })();

  // T5 - "how much work is assigned to me today" (demandSeconds, including
  // rollover from earlier days), a different question from the cap above
  // ("how much am I still allowed to work"). Both matter; this is the one
  // that answers "1h task + 3h calling project = 4h before I select
  // anything."
  const assignedTodayLabel = !memberLimits
    ? "—"
    : fmtHours(memberLimits.assignedToday.demandSeconds);
  const assignedDemandSeconds = Math.max(1, memberLimits?.assignedToday.demandSeconds ?? 1);
  const assignedPlannedPercent = memberLimits
    ? Math.min(100, (memberLimits.assignedToday.plannedSeconds / assignedDemandSeconds) * 100)
    : 0;
  const assignedDeferredPercent = memberLimits
    ? Math.min(100 - assignedPlannedPercent, (memberLimits.assignedToday.deferredSeconds / assignedDemandSeconds) * 100)
    : 0;
  const assignedCarriedLabel =
    memberLimits && memberLimits.assignedToday.rolloverSeconds > 0
      ? `incl. ${fmtHours(memberLimits.assignedToday.rolloverSeconds)} carried`
      : "";
  const assignedTaskCountLabel = !memberLimits
    ? ""
    : memberLimits.assignedToday.taskCount === 1
      ? "1 task"
      : `${memberLimits.assignedToday.taskCount} tasks`;
  // byProjectType arrives on every poll and had no home in the old grid.
  const assignedSplitLabel = (() => {
    if (!memberLimits) return "";
    const { normal, calling } = memberLimits.assignedToday.byProjectType;
    if (normal > 0 && calling > 0) return `${fmtHours(normal)} on tasks · ${fmtHours(calling)} on calls`;
    return "";
  })();

  // Only rendered when the project actually has an Hours-based budget - no
  // dash-filled card cluttering the common case of no budget configured.
  const projectBudgetReached = projectBudget != null && projectBudget.remainingSeconds <= 0;
  const projectBudgetPercent =
    projectBudget && projectBudget.capSeconds > 0
      ? Math.min(100, (projectBudget.spentSeconds / projectBudget.capSeconds) * 100)
      : 0;

  // Whole-task budget remaining, independent of whichever daily/weekly cap
  // "Remaining" above is currently bound by. activeSeconds here is the
  // cumulative total worked on this task across every day, so this decreases
  // by real time worked whether it came out of regular or overtime hours.
  const taskBudgetRemainingLabel = !taskTracking?.estimatedSeconds
    ? "—"
    : fmtHours(Math.max(0, taskTracking.estimatedSeconds - taskTracking.activeSeconds));

  // The estimate's own shape. overtimeSeconds is part of estimatedSeconds, so
  // a flat "16h" hid that 4h of it was overtime; drawing the two zones behind
  // the worked bar makes crossing into overtime visible as it happens.
  const taskEstimateSeconds = taskTracking?.estimatedSeconds ?? 0;
  const taskOvertimeSeconds = Math.max(0, taskTracking?.overtimeSeconds ?? 0);
  const taskRegularSeconds = Math.max(0, taskEstimateSeconds - taskOvertimeSeconds);
  const taskRegularPercent = taskEstimateSeconds > 0 ? (taskRegularSeconds / taskEstimateSeconds) * 100 : 0;
  const taskOvertimePercent = taskEstimateSeconds > 0 ? (taskOvertimeSeconds / taskEstimateSeconds) * 100 : 0;
  const taskWorkedPercent =
    taskEstimateSeconds > 0
      ? Math.min(100, ((taskTracking?.activeSeconds ?? 0) / taskEstimateSeconds) * 100)
      : 0;
  const taskIntoOvertime =
    taskEstimateSeconds > 0 && (taskTracking?.activeSeconds ?? 0) > taskRegularSeconds;
  const taskScheduleLabel = (() => {
    if (!taskTracking?.workingDays || !taskTracking?.hoursPerDay) return "";
    const base = `${taskTracking.workingDays}d × ${taskTracking.hoursPerDay}h`;
    return taskOvertimeSeconds > 0 ? `${base} + ${fmtHours(taskOvertimeSeconds)} OT` : base;
  })();

  return {
    dailyCapSeconds,
    dailyCapLabel,
    dailyCapLeftLabel,
    workedTodayLabel,
    dayUsedPercent,
    dayOverPercent,
    dayHint,
    activityToday,
    activityTrackedSeconds,
    activityPercent,
    activityLabel,
    activityDash,
    weekActivityDash,
    weekActiveSeconds,
    weekIdleSeconds,
    weeklyCapSeconds,
    weekWorkedLabel,
    weekUsedPercent,
    weekOfLabel,
    weekFootLabel,
    projectedCapTimeLabel,
    assignedTodayLabel,
    assignedDemandSeconds,
    assignedPlannedPercent,
    assignedDeferredPercent,
    assignedCarriedLabel,
    assignedTaskCountLabel,
    assignedSplitLabel,
    projectBudgetReached,
    projectBudgetPercent,
    taskBudgetRemainingLabel,
    taskEstimateSeconds,
    taskOvertimeSeconds,
    taskRegularSeconds,
    taskRegularPercent,
    taskOvertimePercent,
    taskWorkedPercent,
    taskIntoOvertime,
    taskScheduleLabel,
  };
}

export type HomeStats = ReturnType<typeof computeHomeStats>;
