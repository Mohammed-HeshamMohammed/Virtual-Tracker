// Renders each tile extracted from App.tsx with representative props,
// including the edge cases their JSX branches on (null projectBudget, an
// activityPercent of null pairing with an undefined activityToday, zero
// caps). tsc verified the prop *types* line up when these were pulled out
// of App.tsx; this verifies they actually mount without throwing - the
// `activityToday!` non-null assertion inside ActivityTile is exactly the
// kind of thing a type check alone won't catch if the null-guard around it
// were ever accidentally loosened.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayPanel } from "./TodayPanel";
import { ActivityTile } from "./ActivityTile";
import { WeekTile } from "./WeekTile";
import { ProjectBudgetTile } from "./ProjectBudgetTile";
import { AssignedTile } from "./AssignedTile";
import type { MemberLimits, ProjectBudgetStatus } from "../../types";

const memberLimits: MemberLimits = {
  dailyHours: 8,
  weeklyHours: 40,
  usesShifts: false,
  workedTodaySeconds: 3600,
  workedWeekSeconds: 7200,
  allowedRemainingSeconds: 3600,
  limitReached: false,
  assignedToday: {
    demandSeconds: 3600,
    plannedSeconds: 3600,
    deferredSeconds: 0,
    rolloverSeconds: 0,
    taskCount: 1,
    byProjectType: { normal: 3600, calling: 0 },
  },
  workingToday: true,
  isMakeupDay: false,
  todayActivity: { activeSeconds: 100, idleSeconds: 20 },
};

const projectBudget: ProjectBudgetStatus = {
  scope: "per_person",
  capSeconds: 36000,
  spentSeconds: 18000,
  remainingSeconds: 18000,
};

describe("stat tiles render without throwing", () => {
  it("TodayPanel - with a cap and a projected landing time", () => {
    const html = renderToStaticMarkup(
      <TodayPanel
        dayHint="makeup day"
        memberLimits={memberLimits}
        workedTodayLabel="1h 0m"
        dailyCapSeconds={28800}
        dailyCapLabel="8h"
        projectedCapTimeLabel="5:00 PM"
        dailyCapLeftLabel="7h"
        dayUsedPercent={12.5}
        dayOverPercent={0}
      />,
    );
    expect(html).toContain("makeup day");
    expect(html).toContain("5:00 PM");
  });

  it("TodayPanel - no cap at all (dailyCapSeconds 0) skips the bar entirely", () => {
    const html = renderToStaticMarkup(
      <TodayPanel
        dayHint=""
        memberLimits={null}
        workedTodayLabel="—"
        dailyCapSeconds={0}
        dailyCapLabel="—"
        projectedCapTimeLabel=""
        dailyCapLeftLabel="—"
        dayUsedPercent={0}
        dayOverPercent={0}
      />,
    );
    expect(html).not.toContain("capacity-bar");
  });

  it("ActivityTile - nothing tracked yet (activityPercent null, activityToday undefined)", () => {
    const html = renderToStaticMarkup(
      <ActivityTile activityDash={0} activityLabel="—" activityPercent={null} activityToday={undefined} />,
    );
    expect(html).toContain("nothing tracked yet");
  });

  it("ActivityTile - a real split renders both legend rows without hitting the non-null assertion unsafely", () => {
    const html = renderToStaticMarkup(
      <ActivityTile
        activityDash={40}
        activityLabel="83%"
        activityPercent={83}
        activityToday={{ activeSeconds: 100, idleSeconds: 20 }}
      />,
    );
    expect(html).toContain("83%");
    expect(html).toContain("active");
    expect(html).toContain("idle");
  });

  it("WeekTile - with and without a weekly cap", () => {
    const withCap = renderToStaticMarkup(
      <WeekTile weekWorkedLabel="2h" weekOfLabel="of 40h" weeklyCapSeconds={144000} weekUsedPercent={5} weekFootLabel="38h left" />,
    );
    expect(withCap).toContain("38h left");

    const withoutCap = renderToStaticMarkup(
      <WeekTile weekWorkedLabel="2h" weekOfLabel="" weeklyCapSeconds={0} weekUsedPercent={0} weekFootLabel="" />,
    );
    expect(withoutCap).not.toContain("capacity-bar");
  });

  it("ProjectBudgetTile - renders nothing at all when there is no budget", () => {
    const html = renderToStaticMarkup(
      <ProjectBudgetTile projectBudget={null} projectBudgetReached={false} projectBudgetPercent={0} />,
    );
    expect(html).toBe("");
  });

  it("ProjectBudgetTile - renders the scope label and percent when a budget exists", () => {
    const html = renderToStaticMarkup(
      <ProjectBudgetTile projectBudget={projectBudget} projectBudgetReached={false} projectBudgetPercent={50} />,
    );
    expect(html).toContain("yours");
  });

  it("AssignedTile - with a deferred split", () => {
    const html = renderToStaticMarkup(
      <AssignedTile
        memberLimits={{
          ...memberLimits,
          assignedToday: { ...memberLimits.assignedToday, deferredSeconds: 1800 },
        }}
        assignedTaskCountLabel="1 task"
        assignedTodayLabel="1h 30m"
        assignedCarriedLabel=""
        assignedPlannedPercent={66}
        assignedDeferredPercent={34}
        assignedSplitLabel=""
      />,
    );
    expect(html).toContain("moves on");
  });

  it("AssignedTile - with null memberLimits (still loading) does not throw", () => {
    const html = renderToStaticMarkup(
      <AssignedTile
        memberLimits={null}
        assignedTaskCountLabel=""
        assignedTodayLabel="—"
        assignedCarriedLabel=""
        assignedPlannedPercent={0}
        assignedDeferredPercent={0}
        assignedSplitLabel=""
      />,
    );
    expect(html).toContain("fits today");
  });
});
