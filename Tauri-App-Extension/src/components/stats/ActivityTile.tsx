import { fmtHours } from "../../utils/formatters";
import { ACTIVITY_RING_CIRCUMFERENCE } from "../../utils/homeStats";
import type { TodayActivity } from "../../types";

type ActivityTileProps = {
  loading?: boolean;
  activityDash: number;
  activityLabel: string;
  activityPercent: number | null;
  activityToday: TodayActivity | undefined;
};

export function ActivityTile({ loading, activityDash, activityLabel, activityPercent, activityToday }: ActivityTileProps) {
  if (loading) {
    return (
      <div className="stat-tile activity-tile is-loading" aria-busy="true">
        <div className="activity-ring">
          <svg viewBox="0 0 60 60" aria-hidden="true">
            <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(8,16,34,0.9)" strokeWidth="6" />
            <circle
              cx="30"
              cy="30"
              r="26"
              fill="none"
              stroke="rgb(var(--c-primary) / 0.3)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`90 ${ACTIVITY_RING_CIRCUMFERENCE}`}
              className="activity-ring-skeleton-circle"
            />
          </svg>
          <span className="skeleton-bar activity-ring-skeleton-val" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className="stat-tile-label">Activity</span>
          <div className="activity-legend" style={{ marginTop: 4 }}>
            <span className="activity-legend-row">
              <i className="activity-dot active" style={{ opacity: 0.4 }} />
              <span className="skeleton-bar" style={{ width: 48, height: 11, borderRadius: 4, display: "inline-block" }} />
            </span>
            <span className="activity-legend-row" style={{ marginTop: 3 }}>
              <i className="activity-dot idle" style={{ opacity: 0.4 }} />
              <span className="skeleton-bar" style={{ width: 40, height: 11, borderRadius: 4, display: "inline-block" }} />
            </span>
          </div>
        </div>
      </div>
    );
  }
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
