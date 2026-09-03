import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProfileInfo } from "../../types";
import { initialsFromName } from "../../utils/formatters";
import { TitleBar } from "../common/TitleBar";

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

          <button className="link-btn" type="button" disabled={busy} onClick={onSwitchAccount}>
            Not you? Switch account →
          </button>
        </div>
      </div>
    </main>
  );
}
