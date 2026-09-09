import { fmtHours } from "../../utils/formatters";
import type { ProjectBudgetStatus } from "../../types";

type ProjectBudgetTileProps = {
  loading?: boolean;
  projectBudget: ProjectBudgetStatus | null;
  projectBudgetReached: boolean;
  projectBudgetPercent: number;
};

export function ProjectBudgetTile({ loading, projectBudget, projectBudgetReached, projectBudgetPercent }: ProjectBudgetTileProps) {
  if (loading) {
    return (
      <div className="stat-tile is-loading" aria-busy="true">
        <div className="stat-tile-head">
          <span className="stat-tile-label">Project budget</span>
          <span className="skeleton-bar" style={{ width: 34, height: 14, borderRadius: 999, display: "inline-block" }} />
        </div>
        <div className="stat-tile-value-row" style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "baseline" }}>
          <span className="skeleton-bar" style={{ width: 68, height: 20, borderRadius: 6, display: "inline-block" }} />
          <span className="skeleton-bar" style={{ width: 60, height: 13, borderRadius: 4, display: "inline-block" }} />
        </div>
        <div style={{ marginTop: 9 }}>
          <div className="capacity-bar slim">
            <div className="capacity-fill skeleton-bar" style={{ width: "40%", height: "100%", borderRadius: 4 }} />
          </div>
        </div>
      </div>
    );
  }
  if (!projectBudget) return null;
  return (
    <div className="stat-tile">
      <div className="stat-tile-head">
        <span className="stat-tile-label">Project budget</span>
        <span className="stat-tile-note">{projectBudget.scope === "per_person" ? "yours" : "team"}</span>
      </div>
      <div className="stat-tile-value-row">
        <span className={`stat-tile-value${projectBudgetReached ? " warn" : ""}`}>
          {fmtHours(projectBudget.remainingSeconds)}
        </span>
        <span className="stat-tile-of">left of {fmtHours(projectBudget.capSeconds)}</span>
      </div>
      <div style={{ marginTop: 9 }}>
        <div className="capacity-bar slim">
          <div
            className={`capacity-fill${projectBudgetPercent > 90 ? " warn" : ""}`}
            style={{ width: `${projectBudgetPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
