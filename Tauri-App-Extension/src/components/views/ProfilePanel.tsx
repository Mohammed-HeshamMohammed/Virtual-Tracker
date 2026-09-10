import type { AgentWorkspace, MemberLimits, MemberProfile, ProfileInfo, ScreenshotRef } from "../../types";
import { ScreenshotsCard } from "./ScreenshotsCard";
import { fmtHours, fmtLimitHours, initialsFromName } from "../../utils/formatters";
import { PanelBackHeader } from "../common/PanelBackHeader";
import { Icon } from "../common/Icon";

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

function fmtDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} day${rounded === 1 ? "" : "s"}`;
}

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

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
  screenshots,
  screenshotImages,
  selectedScreenshotId,
  screenshotTimeZone,
  onSelectScreenshot,
  onRequestTimeOff,
  onSubmitTimesheet,
  submittingTimesheet,
  onBack,
  onSignOut,
  signingOut,
}: {
  profile: ProfileInfo | null;
  memberProfile: MemberProfile | null;
  memberLimits: MemberLimits | null;
  workspace: AgentWorkspace | null;
  screenshots: ScreenshotRef[];
  screenshotImages: Record<string, string>;
  selectedScreenshotId: string | null;
  /** The member's own zone, so a capture time never contradicts the header
   *  clock - see fmtCapturedAt. */
  screenshotTimeZone?: string;
  onSelectScreenshot: (id: string) => void;
  onRequestTimeOff: () => void;
  onSubmitTimesheet: () => void;
  submittingTimesheet: boolean;
  onBack: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
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

        {workspace &&
        (workspace.self.timeOff.length > 0 ||
          workspace.self.timesheet ||
          workspace.self.earnings.hourlyRate > 0) ? (
          <section className="settings-card">
            <h3 className="settings-section-label">Your standing</h3>

            {workspace.self.timeOff.length > 0 ? (
              <>
                <div className="detail-rows">
                  {workspace.self.timeOff.map((policy) => (
                    <div className="detail-row" key={policy.policyId || policy.policyName}>
                      <span className="detail-label">{policy.policyName}</span>
                      <span className="detail-value">
                        {fmtDays(policy.balanceDays)}
                        {policy.entitlementDays > 0 ? ` of ${fmtDays(policy.entitlementDays)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  className="btn btn-secondary"
                  type="button"
                  style={{ marginTop: 12 }}
                  onClick={onRequestTimeOff}
                >
                  Request time off
                </button>
              </>
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

            {workspace.self.timesheet && workspace.self.timesheet.status.toLowerCase() === "draft" ? (
              <button
                className="btn btn-primary"
                type="button"
                style={{ marginTop: 12 }}
                disabled={submittingTimesheet}
                onClick={onSubmitTimesheet}
              >
                {submittingTimesheet ? "Submitting…" : "Submit timesheet"}
              </button>
            ) : null}

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

        <ScreenshotsCard
          screenshots={screenshots}
          images={screenshotImages}
          selectedId={selectedScreenshotId}
          timeZone={screenshotTimeZone}
          onSelect={onSelectScreenshot}
        />

        <button className="btn btn-danger" type="button" disabled={signingOut} onClick={onSignOut}>
          {signingOut ? "Signing out…" : "Log out"}
        </button>
      </div>
    </>
  );
}
