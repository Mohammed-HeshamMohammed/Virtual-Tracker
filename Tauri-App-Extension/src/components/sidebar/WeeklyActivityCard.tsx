import { fmtHours } from "../../utils/formatters";
import { ACTIVITY_RING_CIRCUMFERENCE } from "../../utils/homeStats";

type WeeklyActivityCardProps = {
  signedIn: boolean;
  /** First load still in flight - show the placeholder instead of nothing, so
   *  the card does not pop into existence a beat after everything else. */
  loading: boolean;
  /** Active share of the week's tracked time; null before anything is tracked. */
  weekActivityPercent: number | null;
  weekActivityDash: number;
  weekActiveSeconds: number;
  weekIdleSeconds: number;
};

export function WeeklyActivityCard({
  signedIn,
  loading,
  weekActivityPercent,
  weekActivityDash,
  weekActiveSeconds,
  weekIdleSeconds,
}: WeeklyActivityCardProps) {
  if (!signedIn) return null;
  if (loading) {
    return (
      <div className="side-skeleton side-panel-swap" aria-hidden="true">
        <span className="skeleton-bar skeleton-bar-lg" />
        <span className="skeleton-bar" />
      </div>
    );
  }
  return (
    // Nothing in this card is interactive (no buttons, no clicks) - it's
    // otherwise just dead space in the sidebar, so it doubles as a window
    // drag handle the same way the titlebar does.
    <section data-help="Weekly activity: how active you were this week, from keyboard and mouse use, with your active and idle time."
      className="side-weekly side-panel-swap"
      style={{ animationDelay: "0.01s" }}
      data-tauri-drag-region
    >
      <div className="side-tasklist-head" data-tauri-drag-region>
        <span className="stat-tile-label">Weekly activity</span>
      </div>
      <div className="side-weekly-ring-row" data-tauri-drag-region>
        <div className="activity-ring side-weekly-ring">
          <svg viewBox="0 0 60 60" aria-hidden="true">
            <circle
              cx="30"
              cy="30"
              r="26"
              fill="none"
              stroke="var(--on-surface-fainter)"
              strokeOpacity={0.35}
              strokeWidth="6"
            />
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
          <span className="activity-ring-value">{weekActivityPercent == null ? "—" : `${weekActivityPercent}%`}</span>
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
