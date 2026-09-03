import { fmtHours } from "../../utils/formatters";
import type { WorkspaceTeam } from "../../types";

export function TeamStatusCard({ team }: { team: WorkspaceTeam | null }) {
  if (!team || team.members.length === 0) return null;
  return (
    <section className="side-tasklist side-panel-swap" style={{ animationDelay: "0.035s" }}>
      <div className="side-tasklist-head">
        <span className="stat-tile-label">Your team</span>
        <span className="side-tasklist-count">{team.members.length}</span>
      </div>

      <div className="side-team-summary">
        <span className="side-team-stat">
          <i className="activity-dot active" />
          {team.trackingNowCount} tracking
        </span>
        {team.notStartedCount > 0 ? (
          <span className="side-team-stat warn">
            {team.notStartedCount} not started
          </span>
        ) : null}
        <span className="side-team-stat muted">{fmtHours(team.totalActiveSecondsToday)} today</span>
      </div>

      <div className="side-tasklist-body">
        {team.members.map((member) => (
          <div className="side-task-row" key={member.memberId}>
            <span className="side-task-row-main">
              <span className="side-task-row-title">{member.name}</span>
              <span className="side-task-row-project">
                {member.activeSecondsToday > 0 ? fmtHours(member.activeSecondsToday) : "Nothing today"}
              </span>
            </span>
            {member.trackingNow ? (
              <span className="badge good">Tracking</span>
            ) : member.onBreak ? (
              <span className="badge warn">On a break</span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
