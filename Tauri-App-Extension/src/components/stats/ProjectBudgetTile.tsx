import { fmtHours } from "../../utils/formatters";
import type { ProjectBudgetStatus } from "../../types";

type ProjectBudgetTileProps = {
  projectBudget: ProjectBudgetStatus | null;
  projectBudgetReached: boolean;
  projectBudgetPercent: number;
};

// Only rendered when the project actually has an Hours-based budget - no
// dash-filled card cluttering the common case of no budget configured.
export function ProjectBudgetTile({ projectBudget, projectBudgetReached, projectBudgetPercent }: ProjectBudgetTileProps) {
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
