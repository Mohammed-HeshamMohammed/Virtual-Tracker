import { useState } from "react";
import type { ProjectInfo } from "../../types";

const SEARCH_THRESHOLD = 6;

type ProjectsListProps = {
  signedIn: boolean;
  /** First load still in flight. Without this the whole section vanished
   *  until the list arrived, so the sidebar visibly reflowed on every cold
   *  start - the placeholder holds the space the rows are about to take. */
  loading: boolean;
  projects: ProjectInfo[];
  selectedProjectId: string;
  busy: boolean;
  sessionOpen: boolean;
  openTaskCountByProject: Map<string, number>;
  projectProgressById: Map<string, number>;
  memberCountById: Map<string, number>;
  onSelectProject: (project: ProjectInfo) => void;
  onCreateTask?: (project: ProjectInfo) => void;
};

export function ProjectsList({
  signedIn,
  loading,
  projects,
  selectedProjectId,
  busy,
  sessionOpen,
  openTaskCountByProject,
  projectProgressById,
  memberCountById,
  onSelectProject,
  onCreateTask,
}: ProjectsListProps) {
  const [query, setQuery] = useState("");
  if (!signedIn) return null;
  if (projects.length === 0) {
    if (!loading) return null;
    return (
      <section className="side-tasklist side-panel-swap" style={{ animationDelay: "0.02s" }}>
        <div className="side-tasklist-head">
          <span className="stat-tile-label">Your projects</span>
        </div>
        <div className="side-skeleton" aria-hidden="true">
          <span className="skeleton-bar" />
          <span className="skeleton-bar" />
          <span className="skeleton-bar" />
        </div>
      </section>
    );
  }
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
          const memberCount = memberCountById.get(project.id);
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
                      {project.hasTasks
                        ? `${openCount} open task${openCount === 1 ? "" : "s"}`
                        : memberCount != null
                          ? `Calling project · ${memberCount} ${memberCount === 1 ? "member" : "members"}`
                          : "Calling project"}
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
