import { useEffect } from "react";
import { fmtCapturedAt, fmtHours, taskStatusLabel } from "../../utils/formatters";
import type { ProjectAppTime, ProjectInfo, ScreenshotRef } from "../../types";

type ProjectDetailModalProps = {
  open: boolean;
  project: ProjectInfo | null;
  appBreakdown: ProjectAppTime[];
  screenshots: ScreenshotRef[];
  screenshotImages: Record<string, string>;
  selectedScreenshotId: string | null;
  onSelectScreenshot: (id: string) => void;
  onClose: () => void;
};

/** The task-less counterpart to TaskProgressPanel/TaskDetailPanel - a
 *  calling/support-type project has no task to show a "This task" card
 *  for. Used to live inline in the main pane's card stack; now a centered
 *  popup instead, backdrop-click and Escape both close it, matching
 *  Dashboard-Web's project modal - opens the moment a task-less project
 *  is selected, and can be reopened afterward from the (i) button next
 *  to the page title.
 *
 *  Budget scope (team vs. personal) doesn't duplicate here - it's already
 *  the ProjectBudgetTile's own "team"/"yours" note in the main pane (same
 *  projectBudget, same GET /api/projects/:id/budget-status). Member count
 *  moved to the sidebar's "YOUR PROJECTS" header instead of living here. */
export function ProjectDetailModal({
  open,
  project,
  appBreakdown,
  screenshots,
  screenshotImages,
  selectedScreenshotId,
  onSelectScreenshot,
  onClose,
}: ProjectDetailModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !project) return null;

  // canCreateTasks is a role check alone (org role, project role, an
  // opt-out flag) - it says nothing about whether this project TYPE has
  // tasks at all, so it comes back true for a manager on a calling
  // project even though there's no task flow for one to use it in.
  // ProjectsList's own "+ New task" button already gates the same way.
  const canAddTask = project.hasTasks && project.canCreateTasks;
  const maxAppSeconds = Math.max(1, ...appBreakdown.map((a) => a.totalSeconds));
  const selectedImage = selectedScreenshotId ? screenshotImages[selectedScreenshotId] : "";

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-label={`${project.name} details`}>
        <div className="modal-head">
          <div className="modal-head-titles">
            <h3 className="modal-title">{project.name}</h3>
            <span className="modal-sub">{taskStatusLabel(project.projectType)}</span>
          </div>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="badge-row">
          {project.requireStopNote ? <span className="badge warn">Stop note required</span> : null}
          {project.budgetExhausted ? <span className="badge bad">Budget spent</span> : null}
          {canAddTask ? <span className="badge neutral">You can add tasks here</span> : null}
        </div>

        <p className="task-detail-text">Tracked directly against the project — no task selection needed.</p>

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

        {appBreakdown.length === 0 && screenshots.length === 0 ? (
          <p className="modal-sub">Nothing tracked here yet this week.</p>
        ) : null}
      </div>
    </div>
  );
}
