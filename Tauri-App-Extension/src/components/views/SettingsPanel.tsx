import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AppSettingsView,
  LayoutKind,
  LayoutPreference,
  ThemePreference,
  UserPreferences,
  WindowLayout,
} from "../../types";
import { LayoutPreview } from "../common/LayoutPreview";
import { PanelBackHeader } from "../common/PanelBackHeader";
import { Switch } from "../common/Switch";
import { Icon } from "../common/Icon";
import { toast } from "../../Toast";
import { applyTheme } from "../../utils/theme";

const DEVELOPERS = [
  { name: "Mohammed Hesham", handle: "Mohammed-HeshamMohammed" },
  { name: "Mohammed Magdy", handle: "mo7amed-magdy" },
];

/** Inline rather than from an icon library: this app has no icon package, and
 *  lucide dropped brand marks. 24x24 viewBox, currentColor. */
function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const LAYOUTS: { id: LayoutPreference; label: string; forScreens: string }[] = [
  { id: "auto", label: "Auto", forScreens: "Picks the best layout for this screen" },
  { id: "standard", label: "Standard", forScreens: "Fits most laptops and monitors" },
  { id: "wide", label: "Wide", forScreens: "Large monitors" },
  { id: "extended", label: "Extended", forScreens: "Desktop monitors, the original size" },
  { id: "focus", label: "Focus", forScreens: "Small laptops and high scaling" },
];

/** Each layout's window size on a screen with room for it - mirrors
 *  preferred_size / side_column_width in window_layout.rs. Wide and Standard
 *  lose their column's width when apps & screenshots is off. */
function layoutSize(kind: LayoutKind, showInsights: boolean): string {
  const sizes: Record<LayoutKind, [number, number, number]> = {
    standard: [1320, 660, 310],
    wide: [1420, 820, 374],
    extended: [1100, 750, 0],
    focus: [1100, 600, 0],
  };
  const [width, height, column] = sizes[kind];
  return `${showInsights ? width : width - column} × ${height}`;
}

const LAYOUT_NAMES: Record<LayoutKind, string> = {
  standard: "Standard",
  wide: "Wide",
  extended: "Extended",
  focus: "Focus",
};

export function SettingsPanel({
  onBack,
  onLayoutChanged,
  onShowInsightsChanged,
}: {
  onBack: () => void;
  /** The window has been resized for a new layout; the app rearranges to match. */
  onLayoutChanged?: (layout: WindowLayout) => void;
  /** The apps & screenshots card was switched on or off. */
  onShowInsightsChanged?: (show: boolean) => void;
}) {
  const [settings, setSettings] = useState<AppSettingsView | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedKey, setSavedKey] = useState<keyof UserPreferences | null>(null);
  const [windowLayout, setWindowLayout] = useState<WindowLayout | null>(null);

  const load = useCallback(async () => {
    const next = await invoke<AppSettingsView>("get_app_settings");
    setSettings(next);
    setWindowLayout(await invoke<WindowLayout>("get_window_layout").catch(() => null));
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
      if (key === "showInsights") onShowInsightsChanged?.(Boolean(value));
      if (key === "layout" || key === "showInsights") {
        // save_preferences has already resized the window - switching apps &
        // screenshots off narrows Wide and Standard too. Ask what it settled
        // on (Auto depends on the screen) so the app can match it.
        const layout = await invoke<WindowLayout>("get_window_layout");
        setWindowLayout(layout);
        onLayoutChanged?.(layout);
      }
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
    <div className="settings-row" data-help={sub}>
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
        tip={sub}
        onChange={(next) => void save(field, next)}
      />
    </div>
  );

  return (
    <>
      <PanelBackHeader title="Settings" onBack={onBack} />

      <div className="content settings-content">
        <section data-help="Appearance: light, dark, or follow your system." className="settings-card">
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
            <div className="segmented" role="group" aria-label="Theme" data-help="Choose light or dark, or follow your system.">
              {THEMES.map((t) => (
                <button data-tip={`Use the ${t.label.toLowerCase()} theme`}
                  key={t.id}
                  type="button"
                  className={`segmented-btn${prefs?.theme === t.id ? " active" : ""}`}
                  aria-pressed={prefs?.theme === t.id}
                  disabled={saving || !prefs}
                  onClick={() => {
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

        <section data-help="Window layout: how large the window is and what it shows. Auto picks the best fit for your screen." className="settings-card">
          <h3 className="settings-section-label">Window layout</h3>
          <div className="settings-row-copy">
            <span className="settings-row-title">
              Layout
              {savedKey === "layout" ? (
                <span className="settings-saved">
                  <Icon name="check" /> Applied
                </span>
              ) : null}
            </span>
            <span className="settings-row-sub">
              Every layout keeps the app at its normal size - smaller screens rearrange it instead of shrinking it.
              {prefs?.layout === "auto" && windowLayout
                ? ` Auto is using ${LAYOUT_NAMES[windowLayout.kind]} on this screen.`
                : ""}
            </span>
          </div>

          <Toggle
            field="showInsights"
            title="Show apps & screenshots"
            sub={
              prefs?.showInsights
                ? "This week's top apps and recent screenshots (the green blocks below). Off narrows Standard and Wide instead of leaving the space empty."
                : "Off by default: Standard and Wide have no side column and a narrower window, and Focus leaves the card out. Extended always shows it."
            }
          />

          <div className="layout-picker" role="radiogroup" aria-label="Window layout" data-help="Pick a window size, or let Auto choose the best one for this screen.">
            {LAYOUTS.map((l) => {
              const active = (prefs?.layout ?? "auto") === l.id;
              const insightsOn = prefs?.showInsights ?? false;
              // Auto previews whatever it has picked for this screen.
              const previewKind: LayoutKind =
                l.id === "auto" ? (windowLayout?.kind ?? "standard") : l.id;
              const sizeLabel =
                l.id === "auto"
                  ? windowLayout
                    ? `${windowLayout.width} × ${windowLayout.height} here`
                    : "Fits your screen"
                  : layoutSize(previewKind, insightsOn);
              return (
                <button data-tip={`${l.label}: ${l.forScreens}`}
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`layout-option${active ? " active" : ""}`}
                  disabled={saving || !prefs}
                  onClick={() => {
                    if (!active) void save("layout", l.id);
                  }}
                >
                  <LayoutPreview
                    kind={previewKind}
                    showInsights={previewKind === "extended" || insightsOn}
                    auto={l.id === "auto"}
                  />
                  <span className="layout-option-name">
                    {l.label}
                    {active ? <Icon name="check" /> : null}
                  </span>
                  <span className="layout-option-size">{sizeLabel}</span>
                  <span className="layout-option-for">{l.forScreens}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section data-help="Startup: what the app does when you sign in to your computer." className="settings-card">
          <h3 className="settings-section-label">Startup</h3>
          <Toggle field="launchAtLogin" title="Launch at login" sub="Open with Windows" />
          <Toggle field="startHidden" title="Start in tray" sub="Hide the window on launch" />
          <Toggle field="autoSignIn" title="Auto sign-in" sub="Open the browser link when signed out" />
        </section>

        <section data-help="Window: what closing the window does." className="settings-card">
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

        <section data-help="Diagnostics: the log file that support may ask you for." className="settings-card">
          <h3 className="settings-section-label">Diagnostics</h3>
          <span className="settings-row-sub">Log file</span>
          <code className="settings-code">{settings?.logPath || "—"}</code>
          <button data-tip="Open the diagnostic log file"
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
          My Virtual Tracker <span className="settings-version-pill">v{settings?.version || "—"}</span>
        </p>
        <p className="settings-credit">Soft Fix &middot; Virtual Callers</p>
        <div className="settings-credit-links">
          {DEVELOPERS.map((dev) => (
            <button
              key={dev.handle}
              type="button"
              className="settings-credit-link"
              // openUrl, never an <a href>: a plain link navigates this webview
              // to github.com and replaces the agent UI. The window has no
              // decorations and is not resizable, so there is no way back.
              onClick={() => void openUrl(`https://github.com/${dev.handle}`).catch(() => {})}
              title={`github.com/${dev.handle}`}
            >
              <GithubMark />
              {dev.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
