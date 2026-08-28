import { describe, expect, it } from "vitest";
import { computeHomeStats, ACTIVITY_RING_CIRCUMFERENCE } from "./homeStats";
import type { DashboardSummary, MemberLimits, ProjectBudgetStatus, TaskTimeTracking } from "../types";

const baseMemberLimits: MemberLimits = {
  dailyHours: 8,
  weeklyHours: 40,
  usesShifts: false,
  workedTodaySeconds: 0,
  workedWeekSeconds: 0,
  allowedRemainingSeconds: null,
  limitReached: false,
  assignedToday: {
    demandSeconds: 0,
    plannedSeconds: 0,
    deferredSeconds: 0,
    rolloverSeconds: 0,
    taskCount: 0,
    byProjectType: { normal: 0, calling: 0 },
  },
  workingToday: true,
  isMakeupDay: false,
  todayActivity: { activeSeconds: 0, idleSeconds: 0 },
};

const emptyInput = {
  memberLimits: null,
  dashboardSummary: null,
  projectBudget: null,
  taskTracking: null,
  liveWorkedTodaySeconds: 0,
  tracking: false,
};

describe("computeHomeStats - no data yet", () => {
  it("falls back to placeholders everywhere rather than throwing on nulls", () => {
    const stats = computeHomeStats(emptyInput);
    expect(stats.dailyCapSeconds).toBe(0);
    expect(stats.dailyCapLabel).toBe("—");
    expect(stats.dailyCapLeftLabel).toBe("—");
    expect(stats.workedTodayLabel).toBe("—");
    expect(stats.dayUsedPercent).toBe(0);
    expect(stats.activityPercent).toBeNull();
    expect(stats.activityLabel).toBe("—");
    expect(stats.activityDash).toBe(0);
    expect(stats.assignedTodayLabel).toBe("—");
    expect(stats.projectBudgetReached).toBe(false);
    expect(stats.taskBudgetRemainingLabel).toBe("—");
  });
});

describe("computeHomeStats - daily cap", () => {
  it("derives the cap in seconds and labels it from dailyHours", () => {
    const stats = computeHomeStats({
      ...emptyInput,
      memberLimits: baseMemberLimits,
      liveWorkedTodaySeconds: 3600,
    });
    expect(stats.dailyCapSeconds).toBe(8 * 3600);
    expect(stats.dailyCapLabel).toBe("8h");
    expect(stats.dayUsedPercent).toBeCloseTo(12.5, 5);
  });

  it("reports 'By shifts' and no cap-seconds for a shift-based member regardless of dailyHours", () => {
    const stats = computeHomeStats({
      ...emptyInput,
      memberLimits: { ...baseMemberLimits, usesShifts: true },
    });
    expect(stats.dailyCapSeconds).toBe(0);
    expect(stats.dailyCapLabel).toBe("By shifts");
    expect(stats.dailyCapLeftLabel).toBe("No cap");
  });

  // dayOverPercent's own ceiling is `100 - dayUsedPercent`, but dayUsedPercent
  // is already clamped to 100 by the time you're over the cap - so that
  // ceiling is always exactly 0 the moment there's anything to show. Pinned
  // here as documented, not-yet-fixed pre-existing behavior (found writing
  // this test, not introduced by it) rather than silently reshaping bar math
  // with no live render to confirm the visual result against.
  it("caps dayUsedPercent at 100, but dayOverPercent's own ceiling formula leaves it at 0 even when over the cap", () => {
    const stats = computeHomeStats({
      ...emptyInput,
      memberLimits: baseMemberLimits,
      liveWorkedTodaySeconds: 10 * 3600, // 2h over an 8h cap
    });
    expect(stats.dayUsedPercent).toBe(100);
    expect(stats.dayOverPercent).toBe(0);
  });

  it("reports the limit as reached distinctly from just having a cap", () => {
    const stats = computeHomeStats({
      ...emptyInput,
      memberLimits: { ...baseMemberLimits, limitReached: true, allowedRemainingSeconds: 0 },
    });
    expect(stats.dailyCapLeftLabel).toBe("Limit reached");
  });

  it("surfaces the makeup-day and not-a-working-day hints", () => {
    expect(
      computeHomeStats({ ...emptyInput, memberLimits: { ...baseMemberLimits, isMakeupDay: true } })
        .dayHint,
    ).toBe("makeup day");
    expect(
      computeHomeStats({ ...emptyInput, memberLimits: { ...baseMemberLimits, workingToday: false } })
        .dayHint,
    ).toBe("not a working day");
    expect(computeHomeStats({ ...emptyInput, memberLimits: baseMemberLimits }).dayHint).toBe("");
  });

  it("only projects a wall-clock cap time while actually tracking with time remaining", () => {
    const withRemaining = {
      ...baseMemberLimits,
      allowedRemainingSeconds: 3600,
    };
    expect(computeHomeStats({ ...emptyInput, memberLimits: withRemaining, tracking: false }).projectedCapTimeLabel).toBe("");
    expect(computeHomeStats({ ...emptyInput, memberLimits: withRemaining, tracking: true }).projectedCapTimeLabel).not.toBe("");
    expect(
      computeHomeStats({
        ...emptyInput,
        memberLimits: { ...withRemaining, allowedRemainingSeconds: 0 },
        tracking: true,
      }).projectedCapTimeLabel,
    ).toBe("");
  });
});

describe("computeHomeStats - activity ring", () => {
  it("is null (no ring) when nothing has been tracked at all", () => {
    const stats = computeHomeStats({
      ...emptyInput,
      memberLimits: { ...baseMemberLimits, todayActivity: { activeSeconds: 0, idleSeconds: 0 } },
    });
    expect(stats.activityPercent).toBeNull();
    expect(stats.activityDash).toBe(0);
  });

  it("rounds active/(active+idle) to a whole percent and draws a proportional dash", () => {
    const stats = computeHomeStats({
      ...emptyInput,
      memberLimits: { ...baseMemberLimits, todayActivity: { activeSeconds: 30, idleSeconds: 10 } },
    });
    expect(stats.activityPercent).toBe(75);
    expect(stats.activityLabel).toBe("75%");
    expect(stats.activityDash).toBeCloseTo(0.75 * ACTIVITY_RING_CIRCUMFERENCE, 5);
  });
});

describe("computeHomeStats - weekly activity (dashboardSummary)", () => {
  const dashboardSummary: DashboardSummary = {
    activityWeekPercent: 40,
    weeklyActivity: [
      { key: "mon", label: "MON", activeHours: 2, idleHours: 0.5 },
      { key: "tue", label: "TUE", activeHours: 3, idleHours: 1 },
    ],
    recentProjects: [],
  };

  it("sums the week's per-day hours into seconds", () => {
    const stats = computeHomeStats({ ...emptyInput, dashboardSummary });
    expect(stats.weekActiveSeconds).toBe(5 * 3600);
    expect(stats.weekIdleSeconds).toBe(1.5 * 3600);
  });

  it("draws the ring from the payload's own percent, independent of today's activity ring", () => {
    const stats = computeHomeStats({ ...emptyInput, dashboardSummary });
    expect(stats.weekActivityDash).toBeCloseTo(0.4 * ACTIVITY_RING_CIRCUMFERENCE, 5);
  });

  it("is a flat zero with no dashboard summary yet", () => {
    const stats = computeHomeStats(emptyInput);
    expect(stats.weekActiveSeconds).toBe(0);
    expect(stats.weekActivityDash).toBe(0);
  });
});

describe("computeHomeStats - assigned today split", () => {
  it("splits planned vs deferred as percentages of total demand", () => {
    const stats = computeHomeStats({
      ...emptyInput,
      memberLimits: {
        ...baseMemberLimits,
        assignedToday: {
          demandSeconds: 4 * 3600,
          plannedSeconds: 3 * 3600,
          deferredSeconds: 1 * 3600,
          rolloverSeconds: 0,
          taskCount: 2,
          byProjectType: { normal: 0, calling: 0 },
        },
      },
    });
    expect(stats.assignedPlannedPercent).toBeCloseTo(75, 5);
    expect(stats.assignedDeferredPercent).toBeCloseTo(25, 5);
    expect(stats.assignedTaskCountLabel).toBe("2 tasks");
  });

  it("uses the singular for exactly one task", () => {
    expect(
      computeHomeStats({
        ...emptyInput,
        memberLimits: {
          ...baseMemberLimits,
          assignedToday: { ...baseMemberLimits.assignedToday, taskCount: 1 },
        },
      }).assignedTaskCountLabel,
    ).toBe("1 task");
  });

  it("never lets demand of zero divide by zero (guarded to a minimum of 1)", () => {
    const stats = computeHomeStats({ ...emptyInput, memberLimits: baseMemberLimits });
    expect(Number.isFinite(stats.assignedPlannedPercent)).toBe(true);
    expect(stats.assignedPlannedPercent).toBe(0);
  });

  it("only labels the normal/calling split once both are actually present", () => {
    const bothPresent = computeHomeStats({
      ...emptyInput,
      memberLimits: {
        ...baseMemberLimits,
        assignedToday: { ...baseMemberLimits.assignedToday, byProjectType: { normal: 3600, calling: 1800 } },
      },
    });
    expect(bothPresent.assignedSplitLabel).not.toBe("");

    const onlyOne = computeHomeStats({
      ...emptyInput,
      memberLimits: {
        ...baseMemberLimits,
        assignedToday: { ...baseMemberLimits.assignedToday, byProjectType: { normal: 3600, calling: 0 } },
      },
    });
    expect(onlyOne.assignedSplitLabel).toBe("");
  });
});

describe("computeHomeStats - project budget", () => {
  const budget: ProjectBudgetStatus = {
    scope: "per_person",
    capSeconds: 10 * 3600,
    spentSeconds: 9 * 3600,
    remainingSeconds: 1 * 3600,
  };

  it("computes spent-of-cap as a percent", () => {
    expect(computeHomeStats({ ...emptyInput, projectBudget: budget }).projectBudgetPercent).toBeCloseTo(90, 5);
  });

  it("flags reached only once remaining hits zero or below", () => {
    expect(computeHomeStats({ ...emptyInput, projectBudget: budget }).projectBudgetReached).toBe(false);
    expect(
      computeHomeStats({ ...emptyInput, projectBudget: { ...budget, remainingSeconds: 0 } })
        .projectBudgetReached,
    ).toBe(true);
  });
});

describe("computeHomeStats - task budget / overtime", () => {
  const taskTracking: TaskTimeTracking = {
    activeSeconds: 6 * 3600,
    idleSeconds: 0,
    taskStatus: "in_progress",
    estimatedSeconds: 10 * 3600,
    overtimeSeconds: 2 * 3600,
    workingDays: 5,
    hoursPerDay: 1.6,
    overtimeHoursPerDay: null,
    progressPercent: 60,
    workedTodaySeconds: null,
    workedTodayOnTaskSeconds: null,
    allowedRemainingSeconds: null,
    limitReached: false,
    allowanceMessage: null,
    sharedBudget: false,
  };

  it("splits the estimate into regular vs overtime zones that sum to the whole", () => {
    const stats = computeHomeStats({ ...emptyInput, taskTracking });
    expect(stats.taskRegularPercent + stats.taskOvertimePercent).toBeCloseTo(100, 5);
    expect(stats.taskOvertimePercent).toBeCloseTo(20, 5); // 2h of 10h
  });

  it("flags into-overtime only once worked time actually passes the regular zone", () => {
    // regular zone is estimate(10h) - overtime(2h) = 8h; worked 6h has not crossed it yet
    expect(computeHomeStats({ ...emptyInput, taskTracking }).taskIntoOvertime).toBe(false);
    expect(
      computeHomeStats({ ...emptyInput, taskTracking: { ...taskTracking, activeSeconds: 9 * 3600 } })
        .taskIntoOvertime,
    ).toBe(true);
  });

  it("appends the overtime hours to the schedule label only when there is any", () => {
    expect(computeHomeStats({ ...emptyInput, taskTracking }).taskScheduleLabel).toContain("OT");
    expect(
      computeHomeStats({ ...emptyInput, taskTracking: { ...taskTracking, overtimeSeconds: 0 } })
        .taskScheduleLabel,
    ).not.toContain("OT");
  });

  it("has no schedule label at all without workingDays/hoursPerDay data", () => {
    expect(
      computeHomeStats({ ...emptyInput, taskTracking: { ...taskTracking, workingDays: null } })
        .taskScheduleLabel,
    ).toBe("");
  });

  it("never lets remaining budget go negative once past the estimate", () => {
    const overBudget = { ...taskTracking, activeSeconds: 12 * 3600 };
    expect(computeHomeStats({ ...emptyInput, taskTracking: overBudget }).taskBudgetRemainingLabel).toBe("0s");
  });
});
