import { fmtHours } from "../../utils/formatters";
import type { WorkspacePulse } from "../../types";

const SCOPE_HELP: Record<string, string> = {
  organization: "everyone in the organization",
  people: "the people you manage",
  projects: "the people on your projects",
};

/** The live team numbers in the title bar - how many people are tracking now, how many worked
 *  today and their total - for the roles the server gives a pulse to. Whom it covers is only in
 *  the help text, not on screen. Your own week's activity lives in the sidebar
 *  (WeeklyActivityCard). Read-only, so it never blocks the title bar's own drag area. */
export function TitleBarStats({ pulse }: { pulse: WorkspacePulse | null }) {
  if (!pulse) return null;
  return (
    <div
      className="titlebar-stats"
      data-help={`Live: how many of ${SCOPE_HELP[pulse.scope ?? ""] ?? "your people"} are tracking now, how many worked today, and their total time today.`}
    >
      <span className="titlebar-stat">
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
    </div>
  );
}
