import { CaretDown } from "@phosphor-icons/react";
import { projectHealth, statCards, weekTrend } from "../../data/dashboard";

const CHART_W = 700;
const CHART_H = 160;

function chartPath(values: number[]): string {
  const max = Math.max(...values, 1);
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * CHART_W;
      const y = CHART_H - (value / max) * (CHART_H - 12) - 6;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Command Center, copied from Dashboard-Web: stat cards, a weekly productivity trend, and
 *  project health. Mock numbers only - this mode never talks to the real dashboard. */
export function DashboardHome() {
  const activeValues = weekTrend.map(day => day.active);
  const line = chartPath(activeValues);
  const fill = `${line} L${CHART_W},${CHART_H} L0,${CHART_H} Z`;

  return (
    <div className="dashboard-content">
      <div className="dashboard-content-head">
        <span className="dashboard-range-pill">LAST 7 DAYS</span>
        <button className="dashboard-project-picker">All Projects<CaretDown /></button>
      </div>

      <section className="dashboard-stat-row">
        {statCards.map(card => (
          <div className="dashboard-stat-card" key={card.label}>
            <div className="dashboard-stat-head">
              <span className={`dashboard-stat-badge tone-${card.tone}`}>{card.badge}</span>
            </div>
            <span className="dashboard-stat-label">{card.label}</span>
            <strong className="dashboard-stat-value">{card.value}</strong>
            {card.bar !== undefined ? (
              <div className="dashboard-stat-bar"><span style={{ width: `${card.bar}%` }} /></div>
            ) : null}
          </div>
        ))}
      </section>

      <section className="dashboard-panels">
        <div className="dashboard-card dashboard-chart-card">
          <h3>Weekly Productivity Trends</h3>
          <p>Hours tracked for All Projects · {weekTrend[weekTrend.length - 1].day} · {weekTrend[weekTrend.length - 1].active}h active, {weekTrend[weekTrend.length - 1].idle}h idle</p>
          <svg className="dashboard-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none">
            <path d={fill} className="dashboard-chart-fill" />
            <path d={line} className="dashboard-chart-line" />
          </svg>
          <div className="dashboard-chart-days">{weekTrend.map(day => <span key={day.day}>{day.day}</span>)}</div>
        </div>

        <div className="dashboard-card dashboard-health-card">
          <h3>Project Health</h3>
          <div className="dashboard-health-list">
            {projectHealth.map(project => (
              <div className="dashboard-health-row" key={project.name}>
                <div className="dashboard-health-head"><strong>{project.name}</strong><span>{project.detail} <b>{project.status}</b></span></div>
                <div className="dashboard-stat-bar"><span style={{ width: `${project.percent}%` }} /></div>
              </div>
            ))}
          </div>
          <button className="dashboard-health-more">View Detailed Metrics</button>
        </div>
      </section>
    </div>
  );
}
