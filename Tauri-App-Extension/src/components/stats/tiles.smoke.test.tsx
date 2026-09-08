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
import { AssignedTodayBadge, AssignedToMeBadge } from "./AssignedTodayBadge";
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
  assignedTotal: {
    assignedSeconds: 36000,
    workedSeconds: 7200,
    remainingSeconds: 28800,
    taskCount: 4,
    projectCount: 2,
  },
  workingToday: true,
  isMakeupDay: false,
  todayActivity: { activeSeconds: 100, idleSeconds: 20 },
  projectTodayActivity: { activeSeconds: 100, idleSeconds: 20 },
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

  it("AssignedTodayBadge - renders the header pill with a value, not a full stat-tile", () => {
    const html = renderToStaticMarkup(
      <AssignedTodayBadge
        memberLimits={memberLimits}
        assignedTodayLabel="1h"
        assignedTaskCountLabel="1 task"
        assignedCarriedLabel="across every project"
      />,
    );
    expect(html).toContain("assigned-today-badge");
    expect(html).toContain("1h");
    expect(html).not.toContain("stat-tile");
  });

  it("AssignedTodayBadge - carries the deferred split in its tooltip, not a visible bar", () => {
    const html = renderToStaticMarkup(
      <AssignedTodayBadge
        memberLimits={{
          ...memberLimits,
          assignedToday: { ...memberLimits.assignedToday, deferredSeconds: 1800 },
        }}
        assignedTodayLabel="1h 30m"
        assignedTaskCountLabel="1 task"
        assignedCarriedLabel=""
      />,
    );
    expect(html).toContain("moves on");
    expect(html).not.toContain("split-bar");
  });

  it("AssignedTodayBadge - renders nothing while memberLimits hasn't loaded yet", () => {
    const html = renderToStaticMarkup(
      <AssignedTodayBadge
        memberLimits={null}
        assignedTodayLabel="—"
        assignedTaskCountLabel=""
        assignedCarriedLabel=""
      />,
    );
    expect(html).toBe("");
  });
});

describe("AssignedToMeBadge", () => {
  it("renders nothing when there is nothing assigned", () => {
    expect(
      renderToStaticMarkup(<AssignedToMeBadge assignedTotalLabel="" assignedTotalDetail="" />),
    ).toBe("");
  });

  it("renders the whole open plate with its breakdown in the title", () => {
    const html = renderToStaticMarkup(
      <AssignedToMeBadge assignedTotalLabel="8h 0m" assignedTotalDetail="4 open tasks · 2 projects" />,
    );
    expect(html).toContain("Assigned to me");
    expect(html).toContain("8h 0m");
    expect(html).toContain("4 open tasks");
  });
});
