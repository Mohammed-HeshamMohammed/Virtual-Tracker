import { fmtHours } from "../../utils/formatters";
import type { WeeklyActivityDay } from "../../types";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type WeekChartProps = {
  /** Monday-first, from GET /api/dashboard/general's weeklyActivity. */
  days: WeeklyActivityDay[];
  loading: boolean;
  now: number;
  timeZone?: string;
};

/** Which of the week's days is today, matched by its short label ("Mon")
 *  in the zone the rest of the page shows times in. -1 when it can't tell. */
export function todayIndexFor(days: { label: string }[], now: number, timeZone?: string): number {
  let label: string;
  try {
    label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(now);
  } catch {
    label = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(now);
  }
  return days.findIndex((d) => d.label === label);
}

export function WeekChart({ days, loading, now, timeZone }: WeekChartProps) {
  const shown: WeeklyActivityDay[] = days.length
    ? days
    : DAY_LABELS.map((label) => ({ key: label.toLowerCase(), label, activeHours: 0, idleHours: 0 }));
  const todayIndex = todayIndexFor(shown, now, timeZone);
  const maxHours = Math.max(0, ...shown.map((d) => d.activeHours + d.idleHours));
  const activeSeconds = Math.round(shown.reduce((sum, d) => sum + d.activeHours, 0) * 3600);
  const empty = !loading && maxHours === 0;

  return (
    <section className="stat-panel week-chart page-content-swap" style={{ animationDelay: "0.1s" }} aria-busy={loading}>
      <div className="week-chart-head">
        <span className="stat-tile-label">Your week</span>
        <span className="week-chart-legend" aria-hidden="true">
          <span>
            <i className="activity-dot active" /> active
          </span>
          <span>
            <i className="activity-dot idle" /> idle
          </span>
        </span>
        <span className="week-chart-total">{loading ? "" : `${fmtHours(activeSeconds)} active`}</span>
      </div>

      <div className={`week-chart-bars${loading ? " is-loading" : ""}`}>
        {shown.map((day, index) => {
          const active = Math.round(day.activeHours * 3600);
          const idle = Math.round(day.idleHours * 3600);
          const total = day.activeHours + day.idleHours;
          // A day with any time at all keeps a visible sliver next to a long one.
          const heightPct = maxHours > 0 && total > 0 ? Math.max(4, (total / maxHours) * 100) : 0;
          const future = todayIndex >= 0 && index > todayIndex;
          return (
            <div
              key={day.key || day.label}
              className={`week-chart-day${index === todayIndex ? " is-today" : ""}${future ? " is-future" : ""}`}
              title={`${day.label}: ${fmtHours(active)} active, ${fmtHours(idle)} idle`}
            >
              <span className="week-chart-value">{active > 0 ? fmtHours(active) : ""}</span>
              <div className="week-chart-track">
                <div className="week-chart-stack" style={{ height: `${heightPct}%` }}>
                  {idle > 0 ? <div className="week-chart-idle" style={{ flexGrow: idle }} /> : null}
                  {active > 0 ? <div className="week-chart-active" style={{ flexGrow: active }} /> : null}
                </div>
              </div>
              <span className="week-chart-label">{day.label}</span>
            </div>
          );
        })}
        {empty ? <p className="week-chart-empty">Nothing tracked this week yet.</p> : null}
      </div>
    </section>
  );
}
