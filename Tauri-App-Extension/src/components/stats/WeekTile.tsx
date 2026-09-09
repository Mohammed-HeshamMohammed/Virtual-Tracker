type WeekTileProps = {
  loading?: boolean;
  weekWorkedLabel: string;
  weekOfLabel: string;
  weeklyCapSeconds: number;
  weekUsedPercent: number;
  weekFootLabel: string;
};

export function WeekTile({ loading, weekWorkedLabel, weekOfLabel, weeklyCapSeconds, weekUsedPercent, weekFootLabel }: WeekTileProps) {
  if (loading) {
    return (
      <div className="stat-tile is-loading" aria-busy="true">
        <div className="stat-tile-head">
          <span className="stat-tile-label">This week</span>
        </div>
        <div className="stat-tile-value-row" style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "baseline" }}>
          <span className="skeleton-bar" style={{ width: 68, height: 20, borderRadius: 6, display: "inline-block" }} />
          <span className="skeleton-bar" style={{ width: 44, height: 13, borderRadius: 4, display: "inline-block" }} />
        </div>
        <div style={{ marginTop: 9 }}>
          <div className="capacity-bar slim">
            <div className="capacity-fill skeleton-bar" style={{ width: "55%", height: "100%", borderRadius: 4 }} />
          </div>
        </div>
        <div style={{ marginTop: 6 }}>
          <span className="skeleton-bar" style={{ width: 80, height: 11, borderRadius: 4, display: "inline-block" }} />
        </div>
      </div>
    );
  }
  return (
    <div className="stat-tile">
      <div className="stat-tile-head">
        <span className="stat-tile-label">This week</span>
      </div>
      <div className="stat-tile-value-row">
        <span className="stat-tile-value">{weekWorkedLabel}</span>
        {weekOfLabel ? <span className="stat-tile-of">{weekOfLabel}</span> : null}
      </div>
      {weeklyCapSeconds > 0 ? (
        <div style={{ marginTop: 9 }}>
          <div className="capacity-bar slim">
            <div
              className={`capacity-fill${weekUsedPercent > 90 ? " warn" : ""}`}
              style={{ width: `${weekUsedPercent}%` }}
            />
          </div>
        </div>
      ) : null}
      {weekFootLabel ? <span className="stat-tile-foot">{weekFootLabel}</span> : null}
    </div>
  );
}
