type WeekTileProps = {
  weekWorkedLabel: string;
  weekOfLabel: string;
  weeklyCapSeconds: number;
  weekUsedPercent: number;
  weekFootLabel: string;
};

export function WeekTile({ weekWorkedLabel, weekOfLabel, weeklyCapSeconds, weekUsedPercent, weekFootLabel }: WeekTileProps) {
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
