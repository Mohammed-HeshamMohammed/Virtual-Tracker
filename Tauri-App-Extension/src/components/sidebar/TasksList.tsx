import { useState } from "react";
import { Icon } from "../common/Icon";
import { taskStatusLabel, taskStatusTone } from "../../utils/formatters";
import type { AgentTask } from "../../types";

// Same cutoff and reasoning as ProjectsList's SEARCH_THRESHOLD.
const SEARCH_THRESHOLD = 6;

type TasksListProps = {
  signedIn: boolean;
  /** First load still in flight. Distinct from "loaded and empty" and from
   *  "loaded and failed" - all three used to collapse into one row. */
  loading: boolean;
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
  loading,
  assignedTasks,
  assignedTasksFailed,
  selectedTaskId,
  busy,
  sessionOpen,
  projectNameById,
  onSelectTask,
}: TasksListProps) {
  const [query, setQuery] = useState("");
  if (!signedIn) return null;
  const trimmed = query.trim().toLowerCase();
  // Matches the task's own title or the project it's in - "what's left on
  // Project X" is as real a search as "find that one task".
  const visible = trimmed
    ? assignedTasks.filter(
        (t) =>
          t.title.toLowerCase().includes(trimmed) ||
          (t.projectId && (projectNameById.get(t.projectId) || "").toLowerCase().includes(trimmed)),
      )
    : assignedTasks;
  return (
    <section className="side-tasklist side-panel-swap" style={{ animationDelay: "0.03s" }}>
      <div className="side-tasklist-head">
        <span className="stat-tile-label">Your tasks</span>
        {assignedTasks.length > 0 ? <span className="side-tasklist-count">{assignedTasks.length}</span> : null}
      </div>
      {assignedTasks.length > SEARCH_THRESHOLD ? (
        <input
          type="text"
          className="side-tasklist-search"
          placeholder="Filter tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter your tasks"
        />
      ) : null}
      {assignedTasks.length > 0 && visible.length === 0 ? (
        <p className="side-tasklist-empty">No task matches "{query.trim()}"</p>
      ) : assignedTasks.length > 0 ? (
        <div className="side-tasklist-body">
          {visible.map((task) => (
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
      ) : loading ? (
        /* First load still in flight. This used to fall straight through to
           the failure row, so a slow network announced itself as
           "Couldn't load your tasks" before anything had actually failed. */
        <div className="side-skeleton" aria-hidden="true">
          <span className="skeleton-bar" />
          <span className="skeleton-bar" />
        </div>
      ) : assignedTasksFailed ? (
        <p className="side-tasklist-empty bad">
          <Icon name="warn" />
          Couldn't load your tasks
        </p>
      ) : (
        // Neutral, not the green "ok" tone this used to carry: having no
        // task assigned isn't an achievement to confirm, it's a state that
        // needs a next step. The plain .side-tasklist-empty base is the
        // app's informational grey - the same one the search-miss row above
        // uses - so this reads as guidance rather than as success or error.
        <p className="side-tasklist-empty">
          <Icon name="info" />
          No tasks assigned to you. Pick a project that has tasks, or one you can track directly.
        </p>
      )}
    </section>
  );
}
