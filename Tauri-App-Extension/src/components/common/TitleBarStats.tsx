import { fmtHours } from "../../utils/formatters";
import { ACTIVITY_RING_CIRCUMFERENCE } from "../../utils/homeStats";
import type { WorkspacePulse } from "../../types";

export type WeeklyStat = {
  /** Active share of the week's tracked time; null before anything is tracked. */
  percent: number | null;
  /** Length of the ring's filled arc, in the ring's own units. */
  dash: number;
  activeSeconds: number;
  idleSeconds: number;
};

const SCOPE_LABEL: Record<string, string> = {
  organization: "Organization",
  people: "Your people",
  projects: "Your projects",
};

const SCOPE_HELP: Record<string, string> = {
  organization: "everyone in the organization",
  people: "the people you manage",
  projects: "the people on your projects",
};

/** The at-a-glance numbers that used to fill the top of the sidebar: this week's activity
 *  ring with active / idle time, and - for managers - how many people are tracking right
 *  now. Read-only, so it never blocks the title bar's own drag area. */
export function TitleBarStats({ weekly, pulse }: { weekly: WeeklyStat | null; pulse: WorkspacePulse | null }) {
  if (!weekly && !pulse) return null;
  return (
    <div
      className="titlebar-stats"
      data-help={`This week's activity${pulse ? `, and live how many of ${SCOPE_HELP[pulse.scope ?? ""] ?? "your people"} are tracking today` : ""}.`}
    >
      {weekly ? (
        <span className="titlebar-stat">
          <svg className="titlebar-ring" viewBox="0 0 60 60" aria-hidden="true">
            <circle cx="30" cy="30" r="26" fill="none" stroke="var(--on-surface-fainter)" strokeOpacity={0.35} strokeWidth="8" />
            <circle
              cx="30"
              cy="30"
              r="26"
              fill="none"
              stroke="#34d399"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${weekly.dash} ${ACTIVITY_RING_CIRCUMFERENCE}`}
            />
          </svg>
          <strong>{weekly.percent == null ? "—" : `${weekly.percent}%`}</strong>
          <span className="titlebar-stat-part">
            <i className="activity-dot active" />
            {fmtHours(weekly.activeSeconds)} <em>active</em>
          </span>
          <span className="titlebar-stat-part">
            <i className="activity-dot idle" />
            {fmtHours(weekly.idleSeconds)} <em>idle</em>
          </span>
        </span>
      ) : null}
      {pulse ? (
        <span className="titlebar-stat">
          {pulse.scope && SCOPE_LABEL[pulse.scope] ? <span className="titlebar-stat-scope">{SCOPE_LABEL[pulse.scope]}</span> : null}
          <span className="titlebar-stat-part">
            <i className="activity-dot active" />
            <strong>{pulse.trackingNowCount}</strong> <em>tracking</em>
          </span>
          <span className="titlebar-stat-part">
            <strong>{pulse.membersWorkedTodayCount}</strong> <em>worked today</em>
          </span>
          <span className="titlebar-stat-part">
            <strong>{fmtHours(pulse.totalActiveSecondsToday)}</strong> <em>total</em>
          </span>
        </span>
      ) : null}
    </div>
  );
}
