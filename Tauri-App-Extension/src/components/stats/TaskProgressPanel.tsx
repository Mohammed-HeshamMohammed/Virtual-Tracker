import { fmtHours, taskPriorityTone, taskStatusLabel } from "../../utils/formatters";
import type { TaskTimeTracking } from "../../types";

type TaskProgressPanelProps = {
  loading?: boolean;
  taskLessSession: boolean;
  taskTracking: TaskTimeTracking | null;
  taskPriority: string;
  taskEstimateSeconds: number;
  taskRegularPercent: number;
  taskOvertimePercent: number;
  taskWorkedPercent: number;
  taskIntoOvertime: boolean;
  taskScheduleLabel: string;
  taskBudgetRemainingLabel: string;
};

export function TaskProgressPanel({
  loading,
  taskLessSession,
  taskTracking,
  taskPriority,
  taskEstimateSeconds,
  taskRegularPercent,
  taskOvertimePercent,
  taskWorkedPercent,
  taskIntoOvertime,
  taskScheduleLabel,
  taskBudgetRemainingLabel,
}: TaskProgressPanelProps) {
  if (taskLessSession) return null;
  if (loading) {
    return (
      <section className="stat-panel page-content-swap is-loading" style={{ animationDelay: "0.08s" }} aria-busy="true">
        <div className="stat-panel-head">
          <h3 className="stat-panel-title">This task</h3>
          <span className="skeleton-bar" style={{ width: 56, height: 16, borderRadius: 999 }} />
        </div>

        <div className="task-budget-row" style={{ marginTop: 9, display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="skeleton-bar" style={{ width: 75, height: 20, borderRadius: 6, display: "inline-block" }} />
          <span className="skeleton-bar" style={{ width: 90, height: 13, borderRadius: 4, display: "inline-block" }} />
          <span className="skeleton-bar" style={{ width: 60, height: 13, borderRadius: 4, display: "inline-block", marginLeft: "auto" }} />
        </div>

        <div style={{ marginTop: 9 }}>
          <div className="budget-track">
            <div className="capacity-fill skeleton-bar" style={{ width: "60%", height: "100%", borderRadius: 4 }} />
          </div>
          <div className="budget-scale" style={{ marginTop: 4, display: "flex", justifyContent: "space-between" }}>
            <span className="skeleton-bar" style={{ width: 70, height: 10, borderRadius: 3, display: "inline-block" }} />
            <span className="skeleton-bar right" style={{ width: 80, height: 10, borderRadius: 3, display: "inline-block" }} />
          </div>
        </div>

        <div className="task-progress-block" style={{ marginTop: 9 }}>
          <div className="task-progress-head">
            <span className="label">Progress</span>
            <span className="skeleton-bar" style={{ width: 28, height: 12, borderRadius: 3 }} />
          </div>
          <div className="capacity-bar slim" style={{ marginTop: 4 }}>
            <div className="capacity-fill skeleton-bar" style={{ width: "45%", height: "100%", borderRadius: 4 }} />
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="stat-panel page-content-swap" style={{ animationDelay: "0.08s" }}>
      <div className="stat-panel-head">
        <h3 className="stat-panel-title">This task</h3>
        <span className="stat-panel-head-right">
          {taskTracking?.sharedBudget ? <span className="stat-panel-hint">shared across the team</span> : null}
          {taskPriority ? (
            <span className={`badge ${taskPriorityTone(taskPriority)}`}>{taskStatusLabel(taskPriority)}</span>
          ) : null}
        </span>
      </div>

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
