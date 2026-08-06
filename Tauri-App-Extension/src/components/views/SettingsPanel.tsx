import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettingsView, UserPreferences } from "../../types";
import { TitleBar } from "../common/TitleBar";

export function SettingsPanel({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<AppSettingsView | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await invoke<AppSettingsView>("get_app_settings");
    setSettings(next);
  }, []);

  useEffect(() => {
    void load().catch(console.error);
  }, [load]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 2500);
    return () => window.clearTimeout(timer);
  }, [message]);

  const toggle = async (key: keyof UserPreferences, value: boolean) => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await invoke<AppSettingsView>("save_preferences", {
        preferences: { ...settings.preferences, [key]: value },
      });
      setSettings(updated);
      setMessage("Saved");
    } catch {
      setMessage("Could not save");
    } finally {
      setSaving(false);
    }
  };

  const prefs = settings?.preferences;

  return (
    <main className="agent-tray settings-window view-settings">
      <TitleBar title="Settings" onClose={() => void invoke("close_window")} />
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
          <h3 className="settings-section-label">Diagnostics</h3>
          <div className="settings-row static">
            <span>Log file</span>
            <code>{settings?.logPath || "—"}</code>
          </div>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!settings?.logPath}
            onClick={() => void invoke("open_log_file").catch(() => setMessage("No log file yet"))}
          >
            Open log file
          </button>
        </section>

        <section className="settings-card">
          <h3 className="settings-section-label">Startup</h3>
          <label className="settings-toggle">
            <div>
              <strong>Launch at login</strong>
              <span>Open with Windows</span>
            </div>
            <input
              type="checkbox"
              checked={Boolean(prefs?.launchAtLogin)}
              disabled={saving || !prefs}
              onChange={(e) => void toggle("launchAtLogin", e.target.checked)}
            />
          </label>
          <label className="settings-toggle">
            <div>
              <strong>Start in tray</strong>
              <span>Hide window on launch</span>
            </div>
            <input
              type="checkbox"
              checked={Boolean(prefs?.startHidden)}
              disabled={saving || !prefs}
              onChange={(e) => void toggle("startHidden", e.target.checked)}
            />
          </label>
          <label className="settings-toggle">
            <div>
              <strong>Auto sign-in</strong>
              <span>Open browser link when unsigned</span>
            </div>
            <input
              type="checkbox"
              checked={Boolean(prefs?.autoSignIn)}
              disabled={saving || !prefs}
              onChange={(e) => void toggle("autoSignIn", e.target.checked)}
            />
          </label>
          <label className="settings-toggle">
            <div>
              <strong>Keep running in tray</strong>
              <span>Closing the window hides it instead of quitting</span>
            </div>
            <input
              type="checkbox"
              checked={Boolean(prefs?.closeToTray)}
              disabled={saving || !prefs}
              onChange={(e) => void toggle("closeToTray", e.target.checked)}
            />
          </label>
          {prefs?.closeToTray ? (
            <p className="settings-hint">Tracking keeps running. Use Quit in the tray to stop.</p>
          ) : null}
        </section>

        {message ? (
          <p className="settings-message" role="status" aria-live="polite">
            {message}
          </p>
        ) : null}

        <p className="settings-version">v{settings?.version || "—"}</p>
      </div>
    </main>
  );
}
