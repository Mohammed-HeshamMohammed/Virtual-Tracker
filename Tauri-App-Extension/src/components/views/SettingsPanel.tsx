import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettingsView, ThemePreference, UserPreferences } from "../../types";
import { TitleBar } from "../common/TitleBar";
import { PanelBackHeader } from "../common/PanelBackHeader";
import { Switch } from "../common/Switch";
import { Icon } from "../common/Icon";
import { toast } from "../../Toast";
import { applyTheme } from "../../utils/theme";

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function SettingsPanel({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<AppSettingsView | null>(null);
  const [saving, setSaving] = useState(false);
  // Which row just saved, so the confirmation lands on the control the user
  // actually touched. Toggling used to only disable the input while the write
  // was in flight, which made a slow save and a failed one look identical.
  const [savedKey, setSavedKey] = useState<keyof UserPreferences | null>(null);

  const load = useCallback(async () => {
    const next = await invoke<AppSettingsView>("get_app_settings");
    setSettings(next);
  }, []);

  useEffect(() => {
    void load().catch(console.error);
  }, [load]);

  const save = async (key: keyof UserPreferences, value: boolean | string) => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await invoke<AppSettingsView>("save_preferences", {
        preferences: { ...settings.preferences, [key]: value },
      });
      setSettings(updated);
      setSavedKey(key);
      window.setTimeout(() => setSavedKey((cur) => (cur === key ? null : cur)), 1600);
    } catch {
      toast.error("Could not save this setting.");
    } finally {
      setSaving(false);
    }
  };

  const prefs = settings?.preferences;

  const Toggle = ({
    field,
    title,
    sub,
  }: {
    field: keyof UserPreferences;
    title: string;
    sub: string;
  }) => (
    <div className="settings-row">
      <div className="settings-row-copy">
        <span className="settings-row-title">
          {title}
          {savedKey === field ? (
            <span className="settings-saved">
              <Icon name="check" /> Saved
            </span>
          ) : null}
        </span>
        <span className="settings-row-sub">{sub}</span>
      </div>
      <Switch
        checked={Boolean(prefs?.[field])}
        disabled={saving || !prefs}
        label={title}
        onChange={(next) => void save(field, next)}
      />
    </div>
  );

  return (
    <main className="agent-tray settings-window view-settings">
      <TitleBar title="Settings" onClose={() => void invoke("close_window")} />
      <PanelBackHeader title="Settings" onBack={onBack} />

      <div className="content settings-content">
        <section className="settings-card">
          <h3 className="settings-section-label">Appearance</h3>
          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-row-title">
                Theme
                {savedKey === "theme" ? (
                  <span className="settings-saved">
                    <Icon name="check" /> Saved
                  </span>
                ) : null}
              </span>
              <span className="settings-row-sub">Matches the dashboard&rsquo;s light and dark themes</span>
            </div>
            <div className="segmented" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`segmented-btn${prefs?.theme === t.id ? " active" : ""}`}
                  aria-pressed={prefs?.theme === t.id}
                  disabled={saving || !prefs}
                  onClick={() => {
                    // Painted immediately, then persisted - waiting on the
                    // round trip makes the picker feel broken.
                    applyTheme(t.id);
                    void save("theme", t.id);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-card">
          <h3 className="settings-section-label">Startup</h3>
          <Toggle field="launchAtLogin" title="Launch at login" sub="Open with Windows" />
          <Toggle field="startHidden" title="Start in tray" sub="Hide the window on launch" />
          <Toggle field="autoSignIn" title="Auto sign-in" sub="Open the browser link when signed out" />
        </section>

        {/* Closing behaviour governs the window, not startup - it sat under
            the Startup heading with the three above it. */}
        <section className="settings-card">
          <h3 className="settings-section-label">Window</h3>
          <Toggle
            field="closeToTray"
            title="Keep running in tray"
            sub="Closing the window hides it instead of quitting"
          />
          {prefs?.closeToTray ? (
            <p className="settings-note">
              <Icon name="info" />
              <span>
                Tracking keeps running when the window is closed. Use <strong>Quit</strong> in the tray to stop it.
              </span>
            </p>
          ) : null}
        </section>

        <section className="settings-card">
          <h3 className="settings-section-label">Diagnostics</h3>
          <span className="settings-row-sub">Log file</span>
          <code className="settings-code">{settings?.logPath || "—"}</code>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!settings?.logPath}
            onClick={() => void invoke("open_log_file").catch(() => toast.message("No log file yet"))}
          >
            Open log file
            <Icon name="external" />
          </button>
        </section>

        <p className="settings-version">
          Virtual Tracker Agent <span className="settings-version-pill">v{settings?.version || "—"}</span>
        </p>
      </div>
    </main>
  );
}
