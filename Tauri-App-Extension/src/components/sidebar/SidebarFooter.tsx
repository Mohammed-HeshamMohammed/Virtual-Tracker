import { Icon } from "../common/Icon";
import { initialsFromName } from "../../utils/formatters";
import type { ConnectionState } from "../../types";

type SidebarFooterProps = {
  signedIn: boolean;
  avatarUrl: string | undefined;
  avatarError: boolean;
  onAvatarError: () => void;
  displayName: string;
  footerName: string;
  footerEmail: string;
  footerRole: string;
  loadingProfile: boolean;
  connection: ConnectionState;
  tracking: boolean;
  paused: boolean;
  onViewProfile: () => void;
  onViewSettings: () => void;
};

// Profile and Settings as peers in the flow. The gear used to float at
// position:absolute bottom-left, detached from the layout and the only
// route into Settings; the avatar was secretly the only route into the
// profile. The card itself is name + email + role, same as the People-page
// identity it is drawn from - state lives on the dot alone (tracking /
// paused / offline / ready) rather than repeating it as a second line
// under a status pill up top.
export function SidebarFooter({
  signedIn,
  avatarUrl,
  avatarError,
  onAvatarError,
  displayName,
  footerName,
  footerEmail,
  footerRole,
  loadingProfile,
  connection,
  tracking,
  paused,
  onViewProfile,
  onViewSettings,
}: SidebarFooterProps) {
  return (
    <div className="side-footer">
      <button
        type="button"
        className="side-footer-profile"
        disabled={!signedIn}
        title={signedIn ? "View profile" : undefined}
        onClick={onViewProfile}
      >
        <span className="side-footer-avatar">
          {/* The circular clip lives on this inner span, not on
              .side-footer-avatar itself - clipping the outer element also
              clipped the status dot below to the circle's own edge instead
              of letting it sit on the rim. */}
          <span className="side-footer-avatar-circle">
            {avatarUrl && !avatarError ? (
              <img src={avatarUrl} alt="" referrerPolicy="no-referrer" draggable={false} onError={onAvatarError} />
            ) : (
              <span>{signedIn ? initialsFromName(displayName) : "VT"}</span>
            )}
          </span>
          <i
            className={`side-footer-dot ${
              loadingProfile
                ? "idle"
                : connection === "disconnected"
                  ? "warn"
                  : tracking
                    ? "live"
                    : paused
                      ? "paused"
                      : "ok"
            }`}
            title={
              loadingProfile
                ? "Checking…"
                : connection === "disconnected"
                  ? "Offline"
                  : tracking
                    ? "Tracking"
                    : paused
                      ? "On a break"
                      : signedIn
                        ? "Ready"
                        : "Not linked"
            }
          />
        </span>
        <span className="side-footer-copy">
          <span className="side-footer-name">{signedIn ? footerName : "Signed out"}</span>
          {signedIn && footerEmail ? <span className="side-footer-email">{footerEmail}</span> : null}
          {signedIn && footerRole ? <span className="badge neutral side-footer-badge">{footerRole}</span> : null}
        </span>
      </button>
      <button
        className="icon-btn side-footer-settings"
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={onViewSettings}
      >
        <Icon name="gear" />
      </button>
    </div>
  );
}
