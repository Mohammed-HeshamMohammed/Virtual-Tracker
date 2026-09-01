import { fmtHours } from "../../utils/formatters";
import type { WorkspaceApprovals, WorkspacePulse } from "../../types";

// Approvals (management roles) and the org pulse (org-admin tier, i.e. Super
// Manager and up) share one card rather than sitting as two adjacent
// one-number boxes - a Super Manager gets both, and stacking two tiny cards
// for four numbers reads worse than one. Entitlement is decided server-side;
// each half is simply absent when the backend didn't send that section.
export function ManagementCard({
  approvals,
  pulse,
  onOpenDashboard,
}: {
  approvals: WorkspaceApprovals | null;
  pulse: WorkspacePulse | null;
  /** Approving is a web-dashboard action - the agent points at it rather
   *  than reimplementing an approval queue it has no room for. */
  onOpenDashboard: () => void;
}) {
  if (!approvals && !pulse) return null;
  return (
    <section className="side-tasklist side-panel-swap" style={{ animationDelay: "0.045s" }}>
      <div className="side-tasklist-head">
        <span className="stat-tile-label">{pulse ? "Organization" : "Approvals"}</span>
      </div>

      {approvals ? (
        approvals.pendingCount > 0 ? (
          <button type="button" className="side-team-cta" onClick={onOpenDashboard}>
            <span className="side-team-cta-count">{approvals.pendingCount}</span>
            <span className="side-team-cta-copy">
              timesheet{approvals.pendingCount === 1 ? "" : "s"} waiting on you
            </span>
          </button>
        ) : (
          <p className="side-tasklist-empty ok">No timesheets waiting on you</p>
        )
      ) : null}

      {pulse ? (
        <div className="side-team-summary">
          <span className="side-team-stat">
            <i className="activity-dot active" />
            {pulse.trackingNowCount} tracking
          </span>
          <span className="side-team-stat muted">{pulse.membersWorkedTodayCount} worked today</span>
          <span className="side-team-stat muted">{fmtHours(pulse.totalActiveSecondsToday)} total</span>
        </div>
      ) : null}
    </section>
  );
}
