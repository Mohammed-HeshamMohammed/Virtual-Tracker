import type { DashboardSummary, MemberLimits, ProjectBudgetStatus, TaskTimeTracking } from "../types";
import { fmtHours, fmtLimitHours } from "./formatters";

export const ACTIVITY_RING_CIRCUMFERENCE = 2 * Math.PI * 26;

export type HomeStatsInput = {
  memberLimits: MemberLimits | null;
  dashboardSummary: DashboardSummary | null;
  projectBudget: ProjectBudgetStatus | null;
  taskTracking: TaskTimeTracking | null;
  liveWorkedTodaySeconds: number;
  tracking: boolean;
};

export function computeHomeStats({
  memberLimits,
  dashboardSummary,
  projectBudget,
  taskTracking,
  liveWorkedTodaySeconds,
  tracking,
}: HomeStatsInput) {
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
  const dayHint = !memberLimits
    ? ""
    : memberLimits.isMakeupDay
      ? "makeup day"
      : memberLimits.workingToday
        ? ""
        : "not a working day";

  const activityToday = memberLimits?.projectTodayActivity ?? undefined;
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

  const projectedCapTimeLabel = (() => {
    if (!memberLimits || memberLimits.usesShifts) return "";
    const remaining = memberLimits.allowedRemainingSeconds;
    if (remaining == null || remaining <= 0 || !tracking) return "";
    const at = new Date(Date.now() + remaining * 1000);
    return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  })();

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
      ? `incl. ${fmtHours(memberLimits.assignedToday.rolloverSeconds)} carried · across every project`
      : memberLimits
        ? "across every project"
        : "";
  const assignedTaskCountLabel = !memberLimits
    ? ""
    : memberLimits.assignedToday.taskCount === 1
      ? "1 task"
      : `${memberLimits.assignedToday.taskCount} tasks`;
  const assignedSplitLabel = (() => {
    if (!memberLimits) return "";
    const { normal, calling } = memberLimits.assignedToday.byProjectType;
    if (normal > 0 && calling > 0) return `${fmtHours(normal)} on tasks · ${fmtHours(calling)} on calls`;
    return "";
  })();

  const projectBudgetReached = projectBudget != null && projectBudget.remainingSeconds <= 0;
  const projectBudgetPercent =
    projectBudget && projectBudget.capSeconds > 0
      ? Math.min(100, (projectBudget.spentSeconds / projectBudget.capSeconds) * 100)
      : 0;

  const taskBudgetRemainingLabel = !taskTracking?.estimatedSeconds
    ? "—"
    : fmtHours(Math.max(0, taskTracking.estimatedSeconds - taskTracking.activeSeconds));

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
