import type { MemberLimits, MemberProfile, ProfileInfo } from "../../types";
import { fmtHours, fmtLimitHours, initialsFromName } from "../../utils/formatters";
import { PanelBackHeader } from "../common/PanelBackHeader";
import { Icon } from "../common/Icon";

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
  onBack,
  onSignOut,
  signingOut,
}: {
  profile: ProfileInfo | null;
  memberProfile: MemberProfile | null;
  memberLimits: MemberLimits | null;
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

        <button className="btn btn-danger" type="button" disabled={signingOut} onClick={onSignOut}>
          {signingOut ? "Signing out…" : "Log out"}
        </button>
      </div>
    </>
  );
}
