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
  const totalAppSeconds = appBreakdown.reduce((sum, a) => sum + a.totalSeconds, 0) || 1;
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
        <div className="project-app-chart">
          <span className="stat-tile-label">This week's top apps</span>
          <div className="project-app-plot">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="project-app-plot-svg" aria-hidden="true">
              <line x1="0" y1="90" x2="100" y2="90" className="project-app-plot-axis" />
              <polyline
                points={appBreakdown
                  .map((app, i) => {
                    const x = ((i + 0.5) / appBreakdown.length) * 100;
                    const y = 90 - (app.totalSeconds / maxAppSeconds) * 70;
                    return `${x},${y}`;
                  })
                  .join(" ")}
                className="project-app-plot-line"
              />
            </svg>
            {appBreakdown.map((app, i) => {
              const x = ((i + 0.5) / appBreakdown.length) * 100;
              const y = 90 - (app.totalSeconds / maxAppSeconds) * 70;
              const sharePct = Math.round((app.totalSeconds / totalAppSeconds) * 100);
              return (
                // The dot is the actual mark this app is plotted as - the
                // line just traces the rank order (apps arrive sorted by
                // time, most to least). Focusable so the tooltip is
                // reachable by keyboard, not only on hover.
                <div
                  key={app.appName}
                  className="project-app-point"
                  style={{ left: `${x}%`, top: `${y}%` }}
                  tabIndex={0}
                  role="img"
                  aria-label={`${app.appName}: ${fmtHours(app.totalSeconds)}, ${sharePct}% of the apps shown`}
                >
                  <span className="project-app-point-dot" aria-hidden="true" />
                  <div className="project-app-tooltip" role="tooltip">
                    <strong>{fmtHours(app.totalSeconds)}</strong>
                    <span className="project-app-tooltip-sub">{sharePct}% of the apps shown</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="project-app-plot-labels"
            style={{ gridTemplateColumns: `repeat(${appBreakdown.length}, 1fr)` }}
          >
            {appBreakdown.map((app) => (
              <div className="project-app-plot-label" key={app.appName}>
                <span className="project-app-name">{app.appName}</span>
                <span className="project-app-time">{fmtHours(app.totalSeconds)}</span>
              </div>
            ))}
          </div>
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
