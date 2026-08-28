import { fmtHours } from "../../utils/formatters";
import type { MemberLimits } from "../../types";

type AssignedTileProps = {
  memberLimits: MemberLimits | null;
  assignedTaskCountLabel: string;
  assignedTodayLabel: string;
  assignedCarriedLabel: string;
  assignedPlannedPercent: number;
  assignedDeferredPercent: number;
  assignedSplitLabel: string;
};

/** Assigned today: what fits under the cap vs what defers to a later day. */
export function AssignedTile({
  memberLimits,
  assignedTaskCountLabel,
  assignedTodayLabel,
  assignedCarriedLabel,
  assignedPlannedPercent,
  assignedDeferredPercent,
  assignedSplitLabel,
}: AssignedTileProps) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-head">
        <span className="stat-tile-label">Assigned today</span>
        {assignedTaskCountLabel ? <span className="stat-tile-note">{assignedTaskCountLabel}</span> : null}
      </div>
      <div className="stat-tile-value-row">
        <span className="stat-tile-value">{assignedTodayLabel}</span>
        {assignedCarriedLabel ? <span className="stat-tile-of">{assignedCarriedLabel}</span> : null}
      </div>
      <div className="split-bar">
        <div className="split-bar-planned" style={{ width: `${assignedPlannedPercent}%` }} />
        <div className="split-bar-deferred" style={{ width: `${assignedDeferredPercent}%` }} />
      </div>
      <div className="split-legend">
        <span className="split-legend-row">
          <i className="split-dot" />
          {fmtHours(memberLimits?.assignedToday.plannedSeconds)} fits today
        </span>
        {memberLimits && memberLimits.assignedToday.deferredSeconds > 0 ? (
          <span className="split-legend-row deferred">
            <i className="split-dot deferred" />
            {fmtHours(memberLimits.assignedToday.deferredSeconds)} moves on
          </span>
        ) : null}
      </div>
      {assignedSplitLabel ? <div className="stat-tile-divider">{assignedSplitLabel}</div> : null}
    </div>
  );
}
