import { fmtCapturedAt, fmtHours, taskStatusLabel } from "../../utils/formatters";
import type { ProjectAppTime, ProjectInfo, ScreenshotRef } from "../../types";

type ProjectDetailPanelProps = {
  project: ProjectInfo | null;
  appBreakdown: ProjectAppTime[];
  screenshots: ScreenshotRef[];
  screenshotImages: Record<string, string>;
  selectedScreenshotId: string | null;
  onSelectScreenshot: (id: string) => void;
};

/** The task-less counterpart to TaskProgressPanel/TaskDetailPanel - a
 *  calling/support-type project has no task to show a "This task" card
 *  for, which otherwise left the main pane visibly shorter for that case
 *  than for a real task selection. Sits under the existing Today/Activity/
 *  Week/Budget cards, same slot a task's own detail panel would occupy.
 *
 *  Budget scope (team vs. personal) doesn't duplicate here - it's already
 *  the ProjectBudgetTile's own "team"/"yours" note right above (same
 *  projectBudget, same GET /api/projects/:id/budget-status). Member count
 *  lives in the sidebar's "YOUR PROJECTS" header instead of here. */
export function ProjectDetailPanel({
  project,
  appBreakdown,
  screenshots,
  screenshotImages,
  selectedScreenshotId,
  onSelectScreenshot,
}: ProjectDetailPanelProps) {
  if (!project) return null;

  // canCreateTasks is a role check alone (org role, project role, an
  // opt-out flag) - it says nothing about whether this project TYPE has
  // tasks at all, so it comes back true for a manager on a calling
  // project even though there's no task flow for one to use it in.
  // ProjectsList's own "+ New task" button already gates the same way.
  const canAddTask = project.hasTasks && project.canCreateTasks;
  const maxAppSeconds = Math.max(1, ...appBreakdown.map((a) => a.totalSeconds));
  const selectedImage = selectedScreenshotId ? screenshotImages[selectedScreenshotId] : "";

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

      {appBreakdown.length > 0 ? (
        <div className="project-app-breakdown">
          <span className="stat-tile-label">This week's top apps</span>
          {appBreakdown.map((app) => (
            <div className="project-app-row" key={app.appName}>
              <div className="project-app-row-head">
                <span className="project-app-name">{app.appName}</span>
                <span className="project-app-time">{fmtHours(app.totalSeconds)}</span>
              </div>
              <div className="capacity-bar slim">
                <div
                  className="capacity-fill active"
                  style={{ width: `${Math.round((app.totalSeconds / maxAppSeconds) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {screenshots.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <span className="stat-tile-label">Recent screenshots</span>
          <div className="shot-strip">
            {screenshots.map((shot) => (
              <button
                key={shot.id}
                type="button"
                className={`shot-chip${shot.id === selectedScreenshotId ? " active" : ""}`}
                onClick={() => onSelectScreenshot(shot.id)}
                title={fmtCapturedAt(shot.capturedAt) || "Screenshot"}
              >
                {fmtCapturedAt(shot.capturedAt) || "—"}
              </button>
            ))}
          </div>
          {selectedScreenshotId ? (
            <div className="shot-preview">
              {selectedImage ? (
                <img className="shot-preview-img" src={selectedImage} alt="Screenshot from this project" draggable={false} />
              ) : (
                <span className="skeleton-bar shot-preview-loading" />
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
