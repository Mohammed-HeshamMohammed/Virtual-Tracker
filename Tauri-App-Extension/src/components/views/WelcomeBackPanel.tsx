import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProfileInfo } from "../../types";
import { initialsFromName } from "../../utils/formatters";
import { TitleBar } from "../common/TitleBar";

/**
 * Shown when the agent still knows who you are but can no longer talk to the
 * backend. Name and avatar come from the cached token claims, so this renders
 * fully offline. The button recovers in-app - it does not send you to a
 * browser unless the device itself has been unlinked.
 */
export function WelcomeBackPanel({
  profile,
  message,
  busy,
  needsRelink,
  onReconnect,
  onRelink,
  onSwitchAccount,
}: {
  profile: ProfileInfo | null;
  message: string | null;
  busy: boolean;
  needsRelink: boolean;
  onReconnect: () => void;
  onRelink: () => void;
  onSwitchAccount: () => void;
}) {
  const [avatarBroken, setAvatarBroken] = useState(false);
  const name = profile?.name || "Welcome back";
  const firstName = profile?.name?.trim().split(/\s+/)[0] || "";

  return (
    <main className="agent-tray view-home">
      <TitleBar title="Virtual Tracker" onClose={() => void invoke("close_window")} />
      <div className="reconnect-body">
        <div className="reconnect-card">
          <div className="avatar-wrap reconnect-avatar">
            {profile?.avatarUrl && !avatarBroken ? (
              <img
                className="avatar-img"
                src={profile.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                draggable={false}
                onError={() => setAvatarBroken(true)}
              />
            ) : (
              <div className="avatar-fallback">{initialsFromName(name)}</div>
            )}
          </div>

          <h1 className="reconnect-name">{name}</h1>
          <p className="reconnect-text">
            {/* The caller ORs its own stale-session flag into needsRelink
                before this ever reaches us (App.tsx: needsRelink ||
                staleSession) - a stale session with no device credential
                genuinely has no lighter recovery than this, so there used to
                be a separate "we couldn't verify this session" message here
                for it that could never actually be reached. */}
            {message ??
              (needsRelink
                ? "This device is no longer linked to your account."
                : "Your session went idle. Reconnect to pick up where you left off.")}
          </p>

          <button
            className="btn btn-primary reconnect-btn"
            type="button"
            disabled={busy}
            onClick={needsRelink ? onRelink : onReconnect}
          >
            {busy
              ? "Reconnecting…"
              : needsRelink
                ? "Link this device again"
                : firstName
                  ? `Continue as ${firstName}`
                  : "Welcome back"}
          </button>

          {/* Replaces the old "Log out instead" button: signing out only to
              sign back in as someone else was two steps and read as a dead
              end. A link, not a third stacked button - it is the rarer path. */}
          <button className="link-btn" type="button" disabled={busy} onClick={onSwitchAccount}>
            Not you? Switch account →
          </button>
        </div>
      </div>
    </main>
  );
}
