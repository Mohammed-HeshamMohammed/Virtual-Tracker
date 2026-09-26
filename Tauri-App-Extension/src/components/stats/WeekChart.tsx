import { fmtHours } from "../../utils/formatters";
import type { WeekDay } from "../../types";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type WeekChartProps = {
  /** Monday first, from GET /api/activity/limits, today's active time already
   *  following the live clock (computeHomeStats). */
  days: WeekDay[];
  /** The member's local today, "YYYY-MM-DD", as the server resolved it. */
  todayDay: string;
  loading: boolean;
};

export function WeekChart({ days, todayDay, loading }: WeekChartProps) {
  const shown: WeekDay[] = days.length
    ? days
    : DAY_LABELS.map((label) => ({ day: "", label, activeSeconds: 0, idleSeconds: 0 }));
  const maxSeconds = Math.max(0, ...shown.map((d) => d.activeSeconds + d.idleSeconds));
  const activeSeconds = shown.reduce((sum, d) => sum + d.activeSeconds, 0);
  const empty = !loading && maxSeconds === 0;

  return (
    <section data-help="Your week: one bar per day, showing the time you worked and, stacked on it, your idle time." className="stat-panel week-chart page-content-swap" style={{ animationDelay: "0.1s" }} aria-busy={loading}>
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
          const total = day.activeSeconds + day.idleSeconds;
          // A day with any time at all keeps a visible sliver next to a long one.
          const heightPct = maxSeconds > 0 && total > 0 ? Math.max(4, (total / maxSeconds) * 100) : 0;
          const isToday = Boolean(todayDay) && day.day === todayDay;
          // ISO dates compare correctly as strings.
          const future = Boolean(todayDay && day.day) && day.day > todayDay;
          return (
            <div
              key={day.day || day.label || index}
              className={`week-chart-day${isToday ? " is-today" : ""}${future ? " is-future" : ""}`}
              title={`${day.label}: ${fmtHours(day.activeSeconds)} active, ${fmtHours(day.idleSeconds)} idle`}
            >
              <span className="week-chart-value">{day.activeSeconds > 0 ? fmtHours(day.activeSeconds) : ""}</span>
              <div className="week-chart-track">
                <div className="week-chart-stack" style={{ height: `${heightPct}%` }}>
                  {day.idleSeconds > 0 ? <div className="week-chart-idle" style={{ flexGrow: day.idleSeconds }} /> : null}
                  {day.activeSeconds > 0 ? (
                    <div className="week-chart-active" style={{ flexGrow: day.activeSeconds }} />
                  ) : null}
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
