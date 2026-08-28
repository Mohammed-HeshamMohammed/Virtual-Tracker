import { fmtHours } from "../../utils/formatters";
import { ACTIVITY_RING_CIRCUMFERENCE } from "../../utils/homeStats";
import type { TodayActivity } from "../../types";

type ActivityTileProps = {
  activityDash: number;
  activityLabel: string;
  activityPercent: number | null;
  activityToday: TodayActivity | undefined;
};

export function ActivityTile({ activityDash, activityLabel, activityPercent, activityToday }: ActivityTileProps) {
  return (
    <div className="stat-tile activity-tile">
      <div className="activity-ring">
        <svg viewBox="0 0 60 60" aria-hidden="true">
          <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(8,16,34,0.9)" strokeWidth="6" />
          <circle
            cx="30"
            cy="30"
            r="26"
            fill="none"
            stroke="#34d399"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${activityDash} ${ACTIVITY_RING_CIRCUMFERENCE}`}
          />
        </svg>
        <span className="activity-ring-value">{activityLabel}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <span className="stat-tile-label">Activity</span>
        {activityPercent == null ? (
          <div className="stat-tile-foot">nothing tracked yet</div>
        ) : (
          <div className="activity-legend">
            <span className="activity-legend-row">
              <i className="activity-dot active" />
              {fmtHours(activityToday!.activeSeconds)} <em>active</em>
            </span>
            <span className="activity-legend-row">
              <i className="activity-dot idle" />
              {fmtHours(activityToday!.idleSeconds)} <em>idle</em>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
