import { taskStatusLabel } from "../../utils/formatters";
import type { ProjectInfo } from "../../types";

/** The task-less counterpart to TaskProgressPanel/TaskDetailPanel - a
 *  calling/support-type project has no task to show a "This task" card
 *  for, which otherwise left the main pane visibly shorter for that case
 *  than for a real task selection.
 *
 *  Budget scope (team vs. personal) and member count used to duplicate
 *  here too - the former is already the ProjectBudgetTile's own "team"/
 *  "yours" note right above this card (same projectBudget, same GET
 *  /api/projects/:id/budget-status), and the latter moved to the
 *  sidebar's project row instead, where it isn't competing with this
 *  card for space. */
export function ProjectDetailPanel({ project }: { project: ProjectInfo | null }) {
  if (!project) return null;

  // canCreateTasks is a role check alone (org role, project role, an
  // opt-out flag) - it says nothing about whether this project TYPE has
  // tasks at all, so it comes back true for a manager on a calling
  // project even though there's no task flow for one to use it in.
  // ProjectsList's own "+ New task" button already gates the same way.
  const canAddTask = project.hasTasks && project.canCreateTasks;

  return (
    <section className="stat-panel page-content-swap" style={{ animationDelay: "0.08s" }}>
      <div className="stat-panel-head">
        <h3 className="stat-panel-title">This project</h3>
        <span className="stat-panel-hint">{taskStatusLabel(project.projectType)}</span>
      </div>

      <div className="badge-row" style={{ marginTop: 10 }}>
        {project.requireStopNote ? <span className="badge warn">Stop note required</span> : null}
        {project.budgetExhausted ? <span className="badge bad">Budget spent</span> : null}
        {canAddTask ? <span className="badge neutral">You can add tasks here</span> : null}
      </div>

      <p className="task-detail-text" style={{ marginTop: 10 }}>
        Tracked directly against the project — no task selection needed.
      </p>
    </section>
  );
}
