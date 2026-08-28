import type { ProjectInfo } from "../../types";

type ProjectsListProps = {
  signedIn: boolean;
  projects: ProjectInfo[];
  selectedProjectId: string;
  busy: boolean;
  sessionOpen: boolean;
  openTaskCountByProject: Map<string, number>;
  projectProgressById: Map<string, number>;
  onSelectProject: (project: ProjectInfo) => void;
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
}: ProjectsListProps) {
  if (!signedIn || projects.length === 0) return null;
  return (
    <section className="side-tasklist side-panel-swap" style={{ animationDelay: "0.02s" }}>
      <div className="side-tasklist-head">
        <span className="stat-tile-label">Your projects</span>
        <span className="side-tasklist-count">{projects.length}</span>
      </div>
      <div className="side-tasklist-body">
        {projects.map((project) => {
          const openCount = openTaskCountByProject.get(project.id) ?? 0;
          const progress = projectProgressById.get(project.id);
          return (
            <button
              key={project.id}
              type="button"
              className={`side-task-row${progress != null && !project.budgetExhausted ? " has-progress" : ""}${project.id === selectedProjectId ? " active" : ""}`}
              disabled={busy || sessionOpen || project.budgetExhausted}
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
          );
        })}
      </div>
    </section>
  );
}
