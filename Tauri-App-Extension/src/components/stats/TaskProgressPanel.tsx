import { fmtHours } from "../../utils/formatters";
import type { TaskTimeTracking } from "../../types";

type TaskProgressPanelProps = {
  taskLessSession: boolean;
  taskTracking: TaskTimeTracking | null;
  taskEstimateSeconds: number;
  taskRegularPercent: number;
  taskOvertimePercent: number;
  taskWorkedPercent: number;
  taskIntoOvertime: boolean;
  taskScheduleLabel: string;
  taskBudgetRemainingLabel: string;
};

// Task estimate, budget and progress are what performance is measured
// from - a task-less session has none of it, hence the early null.
export function TaskProgressPanel({
  taskLessSession,
  taskTracking,
  taskEstimateSeconds,
  taskRegularPercent,
  taskOvertimePercent,
  taskWorkedPercent,
  taskIntoOvertime,
  taskScheduleLabel,
  taskBudgetRemainingLabel,
}: TaskProgressPanelProps) {
  if (taskLessSession) return null;
  return (
    <section className="stat-panel page-content-swap" style={{ animationDelay: "0.08s" }}>
      <div className="stat-panel-head">
        <h3 className="stat-panel-title">This task</h3>
        {taskTracking?.sharedBudget ? <span className="stat-panel-hint">shared across the team</span> : null}
      </div>

      {/* No task title here - it is already the page heading. */}
      <div className="task-budget-row" style={{ marginTop: 9 }}>
        <span className="task-budget-number">{fmtHours(taskTracking?.activeSeconds)}</span>
        <span className="task-budget-of">
          {taskEstimateSeconds > 0 ? `of ${fmtHours(taskEstimateSeconds)} budget` : "no estimate set"}
        </span>
        <span className="task-budget-today">{fmtHours(taskTracking?.workedTodayOnTaskSeconds)} today</span>
      </div>

      {taskEstimateSeconds > 0 ? (
        <div style={{ marginTop: 9 }}>
          <div className="budget-track">
            <div className="budget-zone regular" style={{ left: 0, width: `${taskRegularPercent}%` }} />
            {taskOvertimePercent > 0 ? (
              <div
                className="budget-zone overtime"
                style={{ left: `${taskRegularPercent}%`, width: `${taskOvertimePercent}%` }}
              />
            ) : null}
            <div
              className={`budget-worked${taskIntoOvertime ? " overtime" : ""}`}
              style={{ width: `${taskWorkedPercent}%` }}
            />
          </div>
          <div className="budget-scale">
            <span>{taskScheduleLabel}</span>
            <span className={`right${taskIntoOvertime ? " overtime" : ""}`}>
              {taskIntoOvertime ? "into overtime · " : ""}
              {taskBudgetRemainingLabel} left
            </span>
          </div>
        </div>
      ) : null}

      {taskTracking?.progressPercent != null ? (
        <div className="task-progress-block">
          <div className="task-progress-head">
            <span className="label">Progress</span>
            <span className="value">{Math.round(taskTracking.progressPercent)}%</span>
          </div>
          <div className="capacity-bar slim">
            <div
              className="capacity-fill active"
              style={{ width: `${Math.min(100, Math.max(0, taskTracking.progressPercent))}%` }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
