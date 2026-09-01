import type { AgentWorkspace, MemberLimits, MemberProfile, ProfileInfo } from "../../types";
import { fmtHours, fmtLimitHours, initialsFromName } from "../../utils/formatters";
import { PanelBackHeader } from "../common/PanelBackHeader";
import { Icon } from "../common/Icon";

/** Timesheet states read as states, same as the role/status badges above. */
function timesheetTone(status: string): string {
  const key = status.toLowerCase();
  if (key === "approved") return "good";
  if (key === "rejected") return "bad";
  if (key === "submitted") return "warn";
  return "neutral";
}

function timesheetLabel(status: string): string {
  const key = status.toLowerCase();
  if (key === "submitted") return "Awaiting approval";
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "Draft";
}

/** `days` carries fractions (a half-day of leave is 0.5) - trimmed so a
 *  whole number doesn't render as "12.0 days". */
function fmtDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} day${rounded === 1 ? "" : "s"}`;
}

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    // An unrecognized currency code would otherwise throw and take the whole
    // panel with it - the number still reads fine with the code beside it.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** A cap read as a ratio, matching how the stats pane reads every ceiling. */
function LimitCard({
  label,
  limitHours,
  usedSeconds,
}: {
  label: string;
  limitHours: number;
  usedSeconds: number;
}) {
  const capSeconds = limitHours > 0 ? Math.floor(limitHours * 3600) : 0;
  const percent = capSeconds > 0 ? Math.min(100, (usedSeconds / capSeconds) * 100) : 0;

  return (
    <div className="profile-limit">
      <span className="stat-tile-label">{label} limit</span>
      <div className="stat-tile-value-row">
        <span className="stat-tile-value">{fmtLimitHours(limitHours)}</span>
        {capSeconds > 0 ? <span className="stat-tile-of">· {fmtHours(usedSeconds)} used</span> : null}
      </div>
      {capSeconds > 0 ? (
        <div className="capacity-bar slim" style={{ marginTop: 9 }}>
          <div className={`capacity-fill${percent > 90 ? " warn" : ""}`} style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function ProfilePanel({
  profile,
  memberProfile,
  memberLimits,
  workspace,
  onBack,
  onSignOut,
  signingOut,
}: {
  profile: ProfileInfo | null;
  memberProfile: MemberProfile | null;
  memberLimits: MemberLimits | null;
  /** null until loaded, or on a backend without the route - every section
   *  below is skipped rather than rendering an empty shell. */
  workspace: AgentWorkspace | null;
  onBack: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  // memberProfile (People-page record) is the richer, canonical source once
  // it loads; profile (JWT claims) is what's available immediately so the
  // page isn't blank on first open.
  const displayName = memberProfile?.name || profile?.name || "Not signed in";
  const displayEmail = memberProfile?.email || profile?.email || "";
  const displayAvatar = memberProfile?.avatarUrl || profile?.avatarUrl || "";
  const status = (memberProfile?.status || "").toLowerCase();
  const statusTone = status === "active" ? "good" : status ? "warn" : "neutral";

  return (
    <>
      <PanelBackHeader title="Profile" onBack={onBack} />

      <div className="content settings-content">
        <section className="settings-card">
          <div className="profile-identity">
            <div className="avatar-wrap">
              {displayAvatar ? (
                <img className="avatar-img" src={displayAvatar} alt="" draggable={false} />
              ) : (
                <div className="avatar-fallback">{initialsFromName(displayName)}</div>
              )}
            </div>
            <div className="profile-identity-copy">
              <h1 className="profile-name">{displayName}</h1>
              {displayEmail ? <span className="profile-email">{displayEmail}</span> : null}
              {/* Role and status are states, not free text - they read far
                  faster as badges than as monospace rows. */}
              {memberProfile ? (
                <div className="badge-row">
                  {memberProfile.role ? <span className="badge neutral">{memberProfile.role}</span> : null}
                  {memberProfile.status ? (
                    <span className={`badge ${statusTone}`}>{memberProfile.status}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {memberProfile ? (
            <div className="detail-rows">
              {memberProfile.dateAdded ? (
                <div className="detail-row">
                  <span className="detail-label">Member since</span>
                  <span className="detail-value">{memberProfile.dateAdded}</span>
                </div>
              ) : null}
              {memberProfile.phone ? (
                <div className="detail-row">
                  <span className="detail-label">Phone</span>
                  <span className="detail-value">{memberProfile.phone}</span>
                </div>
              ) : null}
              <div className="detail-row">
                <span className="detail-label">Teams</span>
                <span className="detail-value">
                  {memberProfile.teams} team{memberProfile.teams === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          ) : (
            <p className="settings-row-sub">Loading…</p>
          )}
        </section>

        <section className="settings-card">
          <h3 className="settings-section-label">Work-hour limits</h3>

          {memberLimits?.isMakeupDay ? (
            <p className="settings-note warn">
              <Icon name="info" />
              <span>Today is a scheduled makeup day — tracking is allowed.</span>
            </p>
          ) : memberLimits && !memberLimits.workingToday ? (
            <p className="settings-note bad">
              <Icon name="warn" />
              <span>Today is not a scheduled working day — tracking is disabled.</span>
            </p>
          ) : null}

          {memberLimits?.usesShifts ? (
            <p className="settings-row-sub">
              Your hours are scheduled by shifts instead of a daily or weekly cap.
            </p>
          ) : memberLimits ? (
            <div className="profile-limit-grid">
              <LimitCard
                label="Daily"
                limitHours={memberLimits.dailyHours}
                usedSeconds={memberLimits.workedTodaySeconds}
              />
              <LimitCard
                label="Weekly"
                limitHours={memberLimits.weeklyHours}
                usedSeconds={memberLimits.workedWeekSeconds}
              />
            </div>
          ) : (
            <p className="settings-row-sub">Loading…</p>
          )}
        </section>

        {/* Time off, timesheet and earnings all answer "where do I stand",
            which is the same question the limits card above answers for
            hours - so they live together rather than as a fourth view. Each
            block is skipped entirely when the org doesn't use that feature
            (no policies, no timesheet yet, no pay rate), so this section
            simply doesn't appear for a workspace that has none of them. */}
        {workspace &&
        (workspace.self.timeOff.length > 0 ||
          workspace.self.timesheet ||
          workspace.self.earnings.hourlyRate > 0) ? (
          <section className="settings-card">
            <h3 className="settings-section-label">Your standing</h3>

            {workspace.self.timeOff.length > 0 ? (
              <div className="detail-rows">
                {workspace.self.timeOff.map((policy) => (
                  <div className="detail-row" key={policy.policyName}>
                    <span className="detail-label">{policy.policyName}</span>
                    <span className="detail-value">
                      {fmtDays(policy.balanceDays)}
                      {policy.entitlementDays > 0 ? ` of ${fmtDays(policy.entitlementDays)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {workspace.self.timesheet ? (
              <div className="detail-rows">
                <div className="detail-row">
                  <span className="detail-label">Latest timesheet</span>
                  <span className="detail-value">
                    <span className={`badge ${timesheetTone(workspace.self.timesheet.status)}`}>
                      {timesheetLabel(workspace.self.timesheet.status)}
                    </span>
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Period</span>
                  <span className="detail-value">
                    {workspace.self.timesheet.periodStart} — {workspace.self.timesheet.periodEnd}
                  </span>
                </div>
              </div>
            ) : null}

            {/* A rate of 0 means none is configured (or isn't visible to
                this viewer) - showing "$0.00 earned" would read as a fact
                rather than an absence. */}
            {workspace.self.earnings.hourlyRate > 0 ? (
              <div className="profile-limit-grid">
                <div className="profile-limit">
                  <span className="stat-tile-label">Earned this week</span>
                  <div className="stat-tile-value-row">
                    <span className="stat-tile-value">
                      {fmtMoney(workspace.self.earnings.weekAmount, workspace.self.earnings.currency)}
                    </span>
                  </div>
                </div>
                <div className="profile-limit">
                  <span className="stat-tile-label">Earned this month</span>
                  <div className="stat-tile-value-row">
                    <span className="stat-tile-value">
                      {fmtMoney(workspace.self.earnings.monthAmount, workspace.self.earnings.currency)}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <button className="btn btn-danger" type="button" disabled={signingOut} onClick={onSignOut}>
          {signingOut ? "Signing out…" : "Log out"}
        </button>
      </div>
    </>
  );
}
