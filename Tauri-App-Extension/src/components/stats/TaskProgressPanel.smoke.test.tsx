import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskProgressPanel } from "./TaskProgressPanel";
import type { TaskTimeTracking } from "../../types";

const baseTaskTracking: TaskTimeTracking = {
  activeSeconds: 3600,
  idleSeconds: 0,
  taskStatus: "in_progress",
  estimatedSeconds: 36000,
  overtimeSeconds: 0,
  workingDays: null,
  hoursPerDay: null,
  overtimeHoursPerDay: null,
  progressPercent: 40,
  workedTodaySeconds: null,
  workedTodayOnTaskSeconds: 3600,
  allowedRemainingSeconds: null,
  limitReached: false,
  allowanceMessage: null,
  sharedBudget: false,
};

describe("TaskProgressPanel", () => {
  it("renders nothing for a task-less session, regardless of taskTracking data", () => {
    expect(
      renderToStaticMarkup(
        <TaskProgressPanel
          taskLessSession={true}
          taskTracking={baseTaskTracking}
          taskEstimateSeconds={36000}
          taskRegularPercent={100}
          taskOvertimePercent={0}
          taskWorkedPercent={10}
          taskIntoOvertime={false}
          taskScheduleLabel=""
          taskBudgetRemainingLabel="9h"
        />,
      ),
    ).toBe("");
  });

  it("shows the 'shared across the team' hint only for a shared budget", () => {
    const html = renderToStaticMarkup(
      <TaskProgressPanel
        taskLessSession={false}
        taskTracking={{ ...baseTaskTracking, sharedBudget: true }}
        taskEstimateSeconds={36000}
        taskRegularPercent={100}
        taskOvertimePercent={0}
        taskWorkedPercent={10}
        taskIntoOvertime={false}
        taskScheduleLabel=""
        taskBudgetRemainingLabel="9h"
      />,
    );
    expect(html).toContain("shared across the team");
  });

  it("skips the budget bar entirely with no estimate set", () => {
    const html = renderToStaticMarkup(
      <TaskProgressPanel
        taskLessSession={false}
        taskTracking={{ ...baseTaskTracking, estimatedSeconds: null }}
        taskEstimateSeconds={0}
        taskRegularPercent={0}
        taskOvertimePercent={0}
        taskWorkedPercent={0}
        taskIntoOvertime={false}
        taskScheduleLabel=""
        taskBudgetRemainingLabel="—"
      />,
    );
    expect(html).toContain("no estimate set");
    expect(html).not.toContain("budget-track");
  });

  it("marks the worked bar and remaining label 'overtime' once into it", () => {
    const html = renderToStaticMarkup(
      <TaskProgressPanel
        taskLessSession={false}
        taskTracking={baseTaskTracking}
        taskEstimateSeconds={36000}
        taskRegularPercent={80}
        taskOvertimePercent={20}
        taskWorkedPercent={90}
        taskIntoOvertime={true}
        taskScheduleLabel="5d × 1.6h"
        taskBudgetRemainingLabel="1h"
      />,
    );
    expect(html).toContain("into overtime");
    expect(html).toContain("budget-worked overtime");
  });

  it("renders the progress block only once progressPercent is present", () => {
    const withProgress = renderToStaticMarkup(
      <TaskProgressPanel
        taskLessSession={false}
        taskTracking={baseTaskTracking}
        taskEstimateSeconds={36000}
        taskRegularPercent={100}
        taskOvertimePercent={0}
        taskWorkedPercent={10}
        taskIntoOvertime={false}
        taskScheduleLabel=""
        taskBudgetRemainingLabel="9h"
      />,
    );
    expect(withProgress).toContain("40%");

    const withoutProgress = renderToStaticMarkup(
      <TaskProgressPanel
        taskLessSession={false}
        taskTracking={{ ...baseTaskTracking, progressPercent: null }}
        taskEstimateSeconds={36000}
        taskRegularPercent={100}
        taskOvertimePercent={0}
        taskWorkedPercent={10}
        taskIntoOvertime={false}
        taskScheduleLabel=""
        taskBudgetRemainingLabel="9h"
      />,
    );
    expect(withoutProgress).not.toContain("task-progress-block");
  });
});
