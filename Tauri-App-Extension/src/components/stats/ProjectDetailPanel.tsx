import { fmtCapturedAt, fmtHours } from "../../utils/formatters";
import type { ProjectAppTime, ProjectInfo, ScreenshotRef } from "../../types";

const RADAR_CENTER = 50;
const RADAR_MAX_RADIUS = 32;
const RADAR_LABEL_RADIUS = 41;
const RADAR_GRID_RINGS = [1 / 3, 2 / 3, 1];

/** Where axis `index` of `count` total sits at `radius` from center, in the
 *  chart's 0-100 square coordinate space. Axes start at the top (12
 *  o'clock) and go clockwise - screen y grows downward, so a plain
 *  increasing angle with cos/sin already reads clockwise on screen. */
function radarPoint(index: number, count: number, radius: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index / count) * 2 * Math.PI;
  return { x: RADAR_CENTER + radius * Math.cos(angle), y: RADAR_CENTER + radius * Math.sin(angle) };
}

function radarPolygon(count: number, radius: number): string {
  return Array.from({ length: count }, (_, i) => {
    const { x, y } = radarPoint(i, count, radius);
    return `${x},${y}`;
  }).join(" ");
}

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

  const hasChart = appBreakdown.length > 0;
  const hasShots = screenshots.length > 0;
  const hasBadges = project.requireStopNote || project.budgetExhausted || canAddTask;

  return (
    <section className="stat-panel page-content-swap" style={{ animationDelay: "0.08s" }}>
      {hasBadges ? (
        <div className="badge-row">
          {project.requireStopNote ? <span className="badge warn">Stop note required</span> : null}
          {project.budgetExhausted ? <span className="badge bad">Budget spent</span> : null}
          {canAddTask ? <span className="badge neutral">You can add tasks here</span> : null}
        </div>
      ) : null}

      {hasChart || hasShots ? (
        <div className={`project-detail-row${hasBadges ? "" : " no-badges"}`}>
          {hasChart ? (
            <div className="project-app-chart">
              <span className="stat-tile-label">This week's top apps</span>
              <div className="project-radar">
                <svg viewBox="0 0 100 100" className="project-radar-svg" aria-hidden="true">
                  {RADAR_GRID_RINGS.map((step) => (
                    <polygon
                      key={step}
                      points={radarPolygon(appBreakdown.length, RADAR_MAX_RADIUS * step)}
                      className="project-radar-grid"
                    />
                  ))}
                  {appBreakdown.map((_, i) => {
                    const { x, y } = radarPoint(i, appBreakdown.length, RADAR_MAX_RADIUS);
                    return (
                      <line
                        key={i}
                        x1={RADAR_CENTER}
                        y1={RADAR_CENTER}
                        x2={x}
                        y2={y}
                        className="project-radar-grid"
                      />
                    );
                  })}
                  <polygon
                    points={appBreakdown
                      .map((app, i) => {
                        const { x, y } = radarPoint(i, appBreakdown.length, (app.totalSeconds / maxAppSeconds) * RADAR_MAX_RADIUS);
                        return `${x},${y}`;
                      })
                      .join(" ")}
                    className="project-radar-shape"
                  />
                </svg>
                {appBreakdown.map((app, i) => {
                  const dot = radarPoint(i, appBreakdown.length, (app.totalSeconds / maxAppSeconds) * RADAR_MAX_RADIUS);
                  const label = radarPoint(i, appBreakdown.length, RADAR_LABEL_RADIUS);
                  const sharePct = Math.round((app.totalSeconds / totalAppSeconds) * 100);
                  return (
                    <div key={app.appName}>
                      {/* The dot is the actual mark this app is plotted as -
                          one point per axis, at that app's own share of the
                          week. Focusable so the tooltip is reachable by
                          keyboard, not only on hover. */}
                      <div
                        className="project-radar-point"
                        style={{ left: `${dot.x}%`, top: `${dot.y}%` }}
                        tabIndex={0}
                        role="img"
                        aria-label={`${app.appName}: ${fmtHours(app.totalSeconds)}, ${sharePct}% of the apps shown`}
                      >
                        <span className="project-radar-dot" aria-hidden="true" />
                        <div className="project-app-tooltip" role="tooltip">
                          <strong>{fmtHours(app.totalSeconds)}</strong>
                          <span className="project-app-tooltip-sub">{sharePct}% of the apps shown</span>
                        </div>
                      </div>
                      <div className="project-radar-label" style={{ left: `${label.x}%`, top: `${label.y}%` }}>
                        <span className="project-app-name">{app.appName}</span>
                        <span className="project-app-time">{fmtHours(app.totalSeconds)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {hasShots ? (
            <div className="project-shots-card">
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
        </div>
      ) : null}
    </section>
  );
}
