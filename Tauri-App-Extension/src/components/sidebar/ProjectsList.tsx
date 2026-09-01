import { useState } from "react";
import type { ProjectInfo } from "../../types";

// Below this, a search box is more clutter than it's worth - everything
// already fits inside .side-tasklist-body's own scroll area (143px, roughly
// 3-4 rows) without needing to find anything.
const SEARCH_THRESHOLD = 6;

type ProjectsListProps = {
  signedIn: boolean;
  projects: ProjectInfo[];
  selectedProjectId: string;
  busy: boolean;
  sessionOpen: boolean;
  openTaskCountByProject: Map<string, number>;
  projectProgressById: Map<string, number>;
  onSelectProject: (project: ProjectInfo) => void;
  // Undefined hides the row action entirely (used by the smoke tests below,
  // which don't exercise task creation) - present in the real app.
  onCreateTask?: (project: ProjectInfo) => void;
};

// Every project the member can track against, as a quick-switch list rather
// than only the dropdown below - useful the moment there's more than one,
// and each row's open-task count is something the dropdown itself has no
// room to show.
export function ProjectsList({
  signedIn,
  projects,
  selectedProjectId,
  busy,
  sessionOpen,
  openTaskCountByProject,
  projectProgressById,
  onSelectProject,
  onCreateTask,
}: ProjectsListProps) {
  const [query, setQuery] = useState("");
  if (!signedIn || projects.length === 0) return null;
  const trimmed = query.trim().toLowerCase();
  const visible = trimmed ? projects.filter((p) => p.name.toLowerCase().includes(trimmed)) : projects;
  return (
    <section className="side-tasklist side-panel-swap" style={{ animationDelay: "0.02s" }}>
      <div className="side-tasklist-head">
        <span className="stat-tile-label">Your projects</span>
        <span className="side-tasklist-count">{projects.length}</span>
      </div>
      {projects.length > SEARCH_THRESHOLD ? (
        <input
          type="text"
          className="side-tasklist-search"
          placeholder="Filter projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter your projects"
        />
      ) : null}
      <div className="side-tasklist-body">
        {visible.length === 0 ? (
          <p className="side-tasklist-empty">
            No project matches "{query.trim()}"
          </p>
        ) : null}
        {visible.map((project) => {
          const openCount = openTaskCountByProject.get(project.id) ?? 0;
          const progress = projectProgressById.get(project.id);
          // can_create_tasks only ever means something on a task-based
          // project - a calling project has no task list to add to.
          const canAddTask = Boolean(onCreateTask) && project.hasTasks && project.canCreateTasks;
          const rowDisabled = busy || sessionOpen || project.budgetExhausted;
          return (
            <div
              key={project.id}
              className={`side-task-row${progress != null && !project.budgetExhausted ? " has-progress" : ""}${project.id === selectedProjectId ? " active" : ""}${rowDisabled ? " row-disabled" : ""}`}
            >
              <button
                type="button"
                className="side-task-row-select"
                disabled={rowDisabled}
                title={project.budgetExhausted ? "This project's hours budget is spent — no timer can start against it." : undefined}
                onClick={() => onSelectProject(project)}
              >
                <span className="side-task-row-main">
                  <span className="side-task-row-top">
                    <span className="side-task-row-title">{project.name}</span>
                    {progress != null && !project.budgetExhausted ? (
                      <span className="side-task-row-percent">{Math.round(progress)}%</span>
                    ) : null}
                  </span>
                  {project.budgetExhausted ? (
                    <span className="side-task-row-project">Budget spent</span>
                  ) : progress != null ? (
                    <span className="capacity-bar slim">
                      <span className="capacity-fill active" style={{ width: `${Math.round(progress)}%` }} />
                    </span>
                  ) : (
                    <span className="side-task-row-project">
                      {project.hasTasks ? `${openCount} open task${openCount === 1 ? "" : "s"}` : "Calling project"}
                    </span>
                  )}
                </span>
                {project.budgetExhausted ? <span className="badge warn">Budget</span> : null}
              </button>
              {canAddTask ? (
                <button
                  type="button"
                  className="side-task-row-add"
                  title={`New task in ${project.name}`}
                  aria-label={`New task in ${project.name}`}
                  disabled={busy}
                  onClick={(e) => {
                    // The row button underneath would otherwise also pick up
                    // this click and select the project mid-dialog.
                    e.stopPropagation();
                    onCreateTask?.(project);
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
                  </svg>
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
