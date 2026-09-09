import type { MemberLimits } from "../../types";

type TodayPanelProps = {
  loading?: boolean;
  dayHint: string;
  memberLimits: MemberLimits | null;
  workedTodayLabel: string;
  dailyCapSeconds: number;
  dailyCapLabel: string;
  projectedCapTimeLabel: string;
  dailyCapLeftLabel: string;
  dayUsedPercent: number;
  dayOverPercent: number;
};

export function TodayPanel({
  loading,
  dayHint,
  memberLimits,
  workedTodayLabel,
  dailyCapSeconds,
  dailyCapLabel,
  projectedCapTimeLabel,
  dailyCapLeftLabel,
  dayUsedPercent,
  dayOverPercent,
}: TodayPanelProps) {
  if (loading) {
    return (
      <section className="stat-panel page-content-swap is-loading" style={{ animationDelay: "0.04s" }} aria-busy="true">
        <div className="stat-panel-head">
          <h3 className="stat-panel-title">Today</h3>
          <span className="skeleton-bar" style={{ width: 64, height: 14, borderRadius: 999 }} />
        </div>

        <div className="stat-hero-row">
          <div className="stat-hero-value">
            <span className="skeleton-bar" style={{ width: 110, height: 32, borderRadius: 8, display: "inline-block" }} />
            <span className="skeleton-bar" style={{ width: 80, height: 14, borderRadius: 6, display: "inline-block", marginTop: 4 }} />
          </div>

          <div className="stat-hero-aside" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <span className="skeleton-bar" style={{ width: 64, height: 16, borderRadius: 6 }} />
            <span className="skeleton-bar" style={{ width: 72, height: 11, borderRadius: 4 }} />
          </div>
        </div>

        <div style={{ marginTop: 11 }}>
          <div className="capacity-bar">
            <div className="capacity-fill skeleton-bar" style={{ width: "65%", height: "100%", borderRadius: 4 }} />
          </div>
          <div className="capacity-scale">
            <span>start of day</span>
            <span className="skeleton-bar" style={{ width: 44, height: 10, borderRadius: 3, display: "inline-block" }} />
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="stat-panel page-content-swap" style={{ animationDelay: "0.04s" }}>
      <div className="stat-panel-head">
        <h3 className="stat-panel-title">Today</h3>
        {dayHint ? <span className="stat-panel-hint">{dayHint}</span> : null}
      </div>

      <div className="stat-hero-row">
        <div className="stat-hero-value">
          <span className={`stat-hero-number${memberLimits?.limitReached ? " warn" : ""}`}>
            {workedTodayLabel}
          </span>
          <span className="stat-hero-of">
            {dailyCapSeconds > 0 ? `of ${dailyCapLabel}` : "across every project"}
          </span>
        </div>

        <div className="stat-hero-aside">
          {memberLimits?.limitReached ? (
            <span className="stat-hero-aside-value warn">Cap reached</span>
          ) : projectedCapTimeLabel ? (
            <>
              <div className="stat-hero-aside-value">{projectedCapTimeLabel}</div>
              <div className="stat-hero-aside-label">cap lands here</div>
            </>
          ) : (
            <>
              <div className="stat-hero-aside-value">{dailyCapLeftLabel}</div>
              <div className="stat-hero-aside-label">
                {dailyCapSeconds > 0 ? "still allowed" : "no daily cap"}
              </div>
            </>
          )}
        </div>
      </div>

      {dailyCapSeconds > 0 ? (
        <div style={{ marginTop: 11 }}>
          <div className="capacity-bar">
            <div
              className={`capacity-fill${memberLimits?.limitReached || dayUsedPercent > 90 ? " warn" : ""}`}
              style={{ width: `${dayUsedPercent}%` }}
            />
            {dayOverPercent > 0 ? (
              <div
                className="capacity-fill warn"
                style={{ left: `${dayUsedPercent}%`, right: "auto", width: `${dayOverPercent}%` }}
              />
            ) : null}
            {memberLimits && memberLimits.dailyHours > 0 && memberLimits.dailyHours <= 16 ? (
              <div className="capacity-ticks">
                {Array.from({ length: Math.round(memberLimits.dailyHours) }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
            ) : null}
          </div>
          <div className="capacity-scale">
            <span>start of day</span>
            <span>{dailyCapLabel} cap</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
