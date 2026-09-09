import { fmtCapturedAt, fmtHours } from "../../utils/formatters";
import type { ProjectAppTime, ProjectInfo, ScreenshotRef } from "../../types";

const RADAR_CENTER = 50;
const RADAR_MAX_RADIUS = 35;
const RADAR_LABEL_RADIUS = 44;
const RADAR_GRID_RINGS = [1 / 3, 2 / 3, 1];
/** Axis count for the loading grid, before any breakdown has arrived. */
const RADAR_SKELETON_AXES = 6;
/** The card only ever shows the newest few - App.tsx already fetches
 *  exactly this many, this is just the belt-and-suspenders cap so the
 *  layout (built for a 3-row list) can't be handed a longer one. */
const MAX_VISIBLE_SHOTS = 3;

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
  /** This project's stats are still in flight. The rows already here stay
   *  mounted behind the loading fade purely so the radar keeps its axis
   *  count while the new ones land - every value they carry is hidden
   *  until the swap, so no stale number reads as if it were this
   *  project's. */
  loading: boolean;
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
  loading,
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

  const hasBadges = project.requireStopNote || project.budgetExhausted || canAddTask;
  // While loading, both halves hold their space with a skeleton rather than
  // collapsing the card and snapping the whole page's height around.
  const showChart = appBreakdown.length > 0 || loading;
  const showShots = screenshots.length > 0 || loading;
  const axisCount = appBreakdown.length || RADAR_SKELETON_AXES;
  // Newest-first from the backend already - slicing keeps only the most
  // recent MAX_VISIBLE_SHOTS, so a screenshot arriving later naturally
  // pushes the oldest one off the end rather than needing to reconcile
  // anything here.
  const visibleShots = screenshots.slice(0, MAX_VISIBLE_SHOTS);

  return (
    <section
      // .project-detail-panel is this card growing to fill whatever
      // vertical space the main pane has left over - see App.css. Scoped
      // to its own class rather than the shared .stat-panel so Today/This
      // task's cards above (and TaskDetailPanel's own, in the non-calling
      // branch) keep their normal content-sized height.
      className="stat-panel project-detail-panel page-content-swap"
      style={{ animationDelay: "0.08s" }}
      aria-busy={loading}
    >
      {hasBadges ? (
        <div className="badge-row">
          {project.requireStopNote ? <span className="badge warn">Stop note required</span> : null}
          {project.budgetExhausted ? <span className="badge bad">Budget spent</span> : null}
          {canAddTask ? <span className="badge neutral">You can add tasks here</span> : null}
        </div>
      ) : null}

      {showChart || showShots ? (
        <div className={`project-detail-row${hasBadges ? "" : " no-badges"}`}>
          {showChart ? (
            <div className="project-app-chart">
              <span className="stat-tile-label">This week's top apps</span>
              {/* The frame is what actually grows to fill the column - a
                  plain flex-grow on .project-radar itself would stretch it
                  into a non-square rectangle the moment there's leftover
                  height, which the angle math can't tolerate. Centering it
                  in a grown frame and sizing it off height (aspect-ratio
                  deriving width, clamped by max-width) keeps it square at
                  whatever size actually fits. */}
              <div className="project-radar-frame">
                <div className={`project-radar${loading ? " is-loading" : ""}`}>
                <svg viewBox="0 0 100 100" className="project-radar-svg" aria-hidden="true">
                  <g className="project-radar-floor">
                    {RADAR_GRID_RINGS.map((step) => (
                      <polygon
                        key={step}
                        points={radarPolygon(axisCount, RADAR_MAX_RADIUS * step)}
                        className="project-radar-grid"
                      />
                    ))}
                    {Array.from({ length: axisCount }, (_, i) => {
                      const { x, y } = radarPoint(i, axisCount, RADAR_MAX_RADIUS);
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
                  </g>

                  {appBreakdown.length > 0 ? (
                    <g className="project-radar-plate">
                      <polygon
                        points={appBreakdown
                          .map((app, i) => {
                            const { x, y } = radarPoint(
                              i,
                              appBreakdown.length,
                              (app.totalSeconds / maxAppSeconds) * RADAR_MAX_RADIUS,
                            );
                            return `${x},${y}`;
                          })
                          .join(" ")}
                        className="project-radar-shape"
                      />
                    </g>
                  ) : null}
                </svg>

                {appBreakdown.map((app, i) => {
                  const dot = radarPoint(
                    i,
                    appBreakdown.length,
                    (app.totalSeconds / maxAppSeconds) * RADAR_MAX_RADIUS,
                  );
                  const label = radarPoint(i, appBreakdown.length, RADAR_LABEL_RADIUS);
                  const sharePct = Math.round((app.totalSeconds / totalAppSeconds) * 100);
                  return (
                    <div key={app.appName} style={{ "--i": i } as React.CSSProperties}>
                      {/* The dot is the actual mark this app is plotted as -
                          one point per axis, at that app's own share of the
                          week. Focusable so the tooltip is reachable by
                          keyboard, not only on hover. */}
                      {/* Held in the tree while loading only so the exit
                          transition can play - but taken out of the tab
                          order and the a11y tree with it, so the outgoing
                          project's numbers can't be reached by keyboard
                          or read aloud while they fade. (Hover is cut off
                          in CSS for the same reason.) */}
                      <div
                        className="project-radar-point"
                        style={{ left: `${dot.x}%`, top: `${dot.y}%` }}
                        tabIndex={loading ? -1 : 0}
                        aria-hidden={loading || undefined}
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
            </div>
          ) : null}

          {showShots ? (
            <div className={`project-shots-card${loading ? " is-loading" : ""}`}>
              <span className="stat-tile-label">Recent screenshots</span>
              {/* Unlike the radar, a chip has no shape worth holding onto -
                  and its label is a capture time, so showing the outgoing
                  project's chips through the load would put that project's
                  data on screen as if it were this one's. Skeletons hold
                  the space instead. */}
              {visibleShots.length > 0 && !loading ? (
                <>
                  {/* A short list, not a wrapping strip - capped to
                      MAX_VISIBLE_SHOTS rows so the newest capture always
                      pushes the oldest row out rather than growing the
                      card. */}
                  <div className="shot-strip">
                    {visibleShots.map((shot, i) => (
                      <button
                        key={shot.id}
                        type="button"
                        className={`shot-chip${shot.id === selectedScreenshotId ? " active" : ""}`}
                        style={{ "--i": i } as React.CSSProperties}
                        onClick={() => onSelectScreenshot(shot.id)}
                        title={fmtCapturedAt(shot.capturedAt) || "Screenshot"}
                      >
                        {fmtCapturedAt(shot.capturedAt) || "—"}
                      </button>
                    ))}
                  </div>
                  {/* Always mounted once there's a selection (App.tsx
                      auto-selects the newest capture) - the point of
                      giving this card more room is to have this area
                      actually showing something, not idle until a click. */}
                  {selectedScreenshotId ? (
                    <div className="shot-preview">
                      {selectedImage ? (
                        <img
                          className="shot-preview-img"
                          src={selectedImage}
                          alt="Screenshot from this project"
                          draggable={false}
                        />
                      ) : (
                        <span className="skeleton-bar shot-preview-loading" />
                      )}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="shot-strip" aria-hidden="true">
                    <span className="skeleton-bar shot-chip-skeleton" />
                    <span className="skeleton-bar shot-chip-skeleton" />
                    <span className="skeleton-bar shot-chip-skeleton" />
                  </div>
                  {/* Without this, the row list's small skeletons leave the
                      rest of the column - the space the big preview image
                      will fill in - sitting empty during the load, which
                      reads as broken rather than loading. */}
                  <div className="shot-preview">
                    <span className="skeleton-bar shot-preview-loading" aria-hidden="true" />
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
