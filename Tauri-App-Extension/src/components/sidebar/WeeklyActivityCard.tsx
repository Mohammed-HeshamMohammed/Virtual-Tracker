import { fmtHours } from "../../utils/formatters";
import { ACTIVITY_RING_CIRCUMFERENCE } from "../../utils/homeStats";
import type { DashboardSummary } from "../../types";

type WeeklyActivityCardProps = {
  signedIn: boolean;
  /** First load still in flight - show the placeholder instead of nothing, so
   *  the card does not pop into existence a beat after everything else. */
  loading: boolean;
  dashboardSummary: DashboardSummary | null;
  weekActivityDash: number;
  weekActiveSeconds: number;
  weekIdleSeconds: number;
};

export function WeeklyActivityCard({
  signedIn,
  loading,
  dashboardSummary,
  weekActivityDash,
  weekActiveSeconds,
  weekIdleSeconds,
}: WeeklyActivityCardProps) {
  if (!signedIn) return null;
  if (!dashboardSummary) {
    return loading ? (
      <div className="side-skeleton side-panel-swap" aria-hidden="true">
        <span className="skeleton-bar skeleton-bar-lg" />
        <span className="skeleton-bar" />
      </div>
    ) : null;
  }
  return (
    <section className="side-weekly side-panel-swap" style={{ animationDelay: "0.01s" }}>
      <div className="side-tasklist-head">
        <span className="stat-tile-label">Weekly activity</span>
      </div>
      <div className="side-weekly-ring-row">
        <div className="activity-ring side-weekly-ring">
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
              strokeDasharray={`${weekActivityDash} ${ACTIVITY_RING_CIRCUMFERENCE}`}
            />
          </svg>
          <span className="activity-ring-value">{Math.round(dashboardSummary.activityWeekPercent)}%</span>
        </div>
        <div className="activity-legend">
          <span className="activity-legend-row">
            <i className="activity-dot active" />
            {fmtHours(weekActiveSeconds)} <em>active</em>
          </span>
          <span className="activity-legend-row">
            <i className="activity-dot idle" />
            {fmtHours(weekIdleSeconds)} <em>idle</em>
          </span>
        </div>
      </div>
    </section>
  );
}
