import { Icon } from "../common/Icon";
import { taskStatusLabel, taskStatusTone } from "../../utils/formatters";
import type { AgentTask } from "../../types";

type TasksListProps = {
  signedIn: boolean;
  assignedTasks: AgentTask[];
  assignedTasksFailed: boolean;
  selectedTaskId: string;
  busy: boolean;
  sessionOpen: boolean;
  projectNameById: Map<string, string>;
  onSelectTask: (task: AgentTask) => void;
};

// Everything open and assigned to the member, across every project - not
// scoped to whichever one is currently picked. This is the task picker now,
// the same way ProjectsList is the project picker: click a row to select
// it, no dropdown.
export function TasksList({
  signedIn,
  assignedTasks,
  assignedTasksFailed,
  selectedTaskId,
  busy,
  sessionOpen,
  projectNameById,
  onSelectTask,
}: TasksListProps) {
  if (!signedIn) return null;
  return (
    <section className="side-tasklist side-panel-swap" style={{ animationDelay: "0.03s" }}>
      <div className="side-tasklist-head">
        <span className="stat-tile-label">Your tasks</span>
        {assignedTasks.length > 0 ? <span className="side-tasklist-count">{assignedTasks.length}</span> : null}
      </div>
      {assignedTasks.length > 0 ? (
        <div className="side-tasklist-body">
          {assignedTasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`side-task-row${task.id === selectedTaskId ? " active" : ""}`}
              disabled={busy || sessionOpen}
              onClick={() => onSelectTask(task)}
            >
              <span className="side-task-row-main">
                <span className="side-task-row-title">{task.title}</span>
                {task.projectId ? (
                  <span className="side-task-row-project">
                    {projectNameById.get(task.projectId) || "Unknown project"}
                  </span>
                ) : null}
              </span>
              <span className={`badge ${taskStatusTone(task.status)}`}>{taskStatusLabel(task.status)}</span>
            </button>
          ))}
        </div>
      ) : assignedTasksFailed ? (
        <p className="side-tasklist-empty bad">
          <Icon name="warn" />
          Couldn't load your tasks
        </p>
      ) : (
        <p className="side-tasklist-empty ok">
          <Icon name="check-filled" />
          Nothing open assigned to you right now
        </p>
      )}
    </section>
  );
}
