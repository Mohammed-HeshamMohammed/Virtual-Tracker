import { invoke } from "@tauri-apps/api/core";
import type { MemberLimits, MemberProfile, ProfileInfo } from "../../types";
import { fmtLimitHours, initialsFromName } from "../../utils/formatters";
import { TitleBar } from "../common/TitleBar";

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

  return (
    <main className="agent-tray settings-window view-settings">
      <TitleBar title="Profile" onClose={() => void invoke("close_window")} />
      <div className="settings-back-row">
        <button
          className="settings-back-btn"
          type="button"
          title="Back"
          aria-label="Back"
          onClick={onBack}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M7.5 2.5 3 6l4.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <div className="content settings-content">
        <section className="settings-card">
          <div className="hero-top">
            <div className="avatar-wrap">
              {displayAvatar ? (
                <img className="avatar-img" src={displayAvatar} alt="" draggable={false} />
              ) : (
                <div className="avatar-fallback">{initialsFromName(displayName)}</div>
              )}
            </div>
            <div className="hero-copy">
              <h1 className="hero-name">{displayName}</h1>
              {displayEmail ? <span className="hero-kicker">{displayEmail}</span> : null}
            </div>
          </div>
          {memberProfile ? (
            <>
              <div className="settings-row static">
                <span>Role</span>
                <code>{memberProfile.role || "—"}</code>
              </div>
              <div className="settings-row static">
                <span>Status</span>
                <code>{memberProfile.status || "—"}</code>
              </div>
              {memberProfile.dateAdded ? (
                <div className="settings-row static">
                  <span>Member since</span>
                  <code>{memberProfile.dateAdded}</code>
                </div>
              ) : null}
              {memberProfile.phone ? (
                <div className="settings-row static">
                  <span>Phone</span>
                  <code>{memberProfile.phone}</code>
                </div>
              ) : null}
              <div className="settings-row static">
                <span>Teams</span>
                <code>{memberProfile.teams}</code>
              </div>
            </>
          ) : (
            <p className="settings-message">Loading…</p>
          )}
        </section>

        <section className="settings-card">
          <h3 className="settings-section-label">Your work-hour limits</h3>
          {memberLimits?.isMakeupDay ? (
            <p className="settings-message settings-message-highlight">
              Today is a scheduled makeup day — tracking is allowed.
            </p>
          ) : memberLimits && !memberLimits.workingToday ? (
            <p className="settings-message settings-message-warning">
              Today is not a scheduled working day — tracking is disabled.
            </p>
          ) : null}
          {memberLimits?.usesShifts ? (
            <p className="settings-message">Your hours are scheduled by shifts instead of a daily/weekly cap.</p>
          ) : memberLimits ? (
            <>
              <div className="settings-row static">
                <span>Daily limit</span>
                <code>{fmtLimitHours(memberLimits.dailyHours)}</code>
              </div>
              <div className="settings-row static">
                <span>Weekly limit</span>
                <code>{fmtLimitHours(memberLimits.weeklyHours)}</code>
              </div>
            </>
          ) : (
            <p className="settings-message">Loading…</p>
          )}
        </section>

        <button
          className="btn btn-danger"
          type="button"
          disabled={signingOut}
          onClick={onSignOut}
        >
          Log out
        </button>
      </div>
    </main>
  );
}
