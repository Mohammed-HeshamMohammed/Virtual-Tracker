import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";
import { toast } from "./Toast";

type ProfileInfo = {
  signedIn: boolean;
  linkPending?: boolean;
  name: string;
  email?: string;
  avatarUrl: string;
  serverLabel: string;
};

type LinkStatus = {
  connected: boolean;
  serverLabel: string;
  status: string;
};

type SignInResult = {
  success: boolean;
  error?: string;
};

type AuthView = "signin" | "signup" | "forgot";

type SignUpFields = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
};

type SignUpState = SignUpFields & {
  busy: boolean;
  error: string | null;
  success: string | null;
};

type ForgotState = {
  email: string;
  busy: boolean;
  error: string | null;
  success: string | null;
};

type UserPreferences = {
  launchAtLogin: boolean;
  startHidden: boolean;
  autoSignIn: boolean;
  closeToTray: boolean;
};

type AppSettingsView = {
  version: string;
  preferences: UserPreferences;
  logPath: string;
};

type AgentTask = {
  id: string;
  title: string;
  status: string;
};

type ProjectInfo = {
  id: string;
  name: string;
  // "calling" projects have no tasks — the timer runs against the project.
  projectType: "normal" | "calling";
};

type SessionInfo = {
  id?: string | null;
  status: string;
  taskId?: string | null;
  taskTitle?: string | null;
  projectId?: string | null;
  /** 0 working, 1 idle 5m, 2 idle 10m, 3 stopped for idling. */
  idleStage?: number;
  activeSeconds?: number;
  idleSeconds?: number;
};

/** CF-2: composed server-side from the live monitoring_policy row - never hardcoded here. */
type MonitoringNoticeView = {
  version: string;
  text: string;
  requiresAcknowledgement: boolean;
};

type ConnectionState = "connected" | "disconnected" | "signedOut";

type ReconnectResult = {
  success: boolean;
  needsRelink: boolean;
  error?: string;
};

type ActionResult = {
  success: boolean;
  error?: string;
  session?: SessionInfo;
};

type TaskTimeTracking = {
  activeSeconds: number;
  idleSeconds: number;
  taskStatus: string;
  estimatedSeconds?: number | null;
  overtimeSeconds?: number | null;
  workingDays?: number | null;
  hoursPerDay?: number | null;
  overtimeHoursPerDay?: number | null;
  progressPercent?: number | null;
  workedTodaySeconds?: number | null;
  workedTodayOnTaskSeconds?: number | null;
  allowedRemainingSeconds?: number | null;
  limitReached: boolean;
  allowanceMessage?: string | null;
};

type MemberLimits = {
  dailyHours: number;
  weeklyHours: number;
  usesShifts: boolean;
  workedTodaySeconds: number;
  workedWeekSeconds: number;
  /** null = no cap applies. Not the same as 0 seconds left. */
  allowedRemainingSeconds: number | null;
  limitReached: boolean;
};

// The viewer's own People-page member record - richer than what's in the
// Firebase JWT claims (role, status, date added, team count).
type MemberProfile = {
  name: string;
  email: string;
  avatarUrl: string;
  role: string;
  status: string;
  dateAdded: string;
  phone: string;
  teams: number;
};

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Sub-hour values need mins/seconds to actually look like they're recording
// (an active task sitting at "0h" for the first 59 minutes reads as broken,
// even though the real number underneath is fine). Right at an hour boundary
// with 0 minutes elapsed, minutes alone would freeze on "Xh 0m" for up to a
// full minute — show seconds there too until the first minute ticks over.
function fmtHours(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || totalSeconds <= 0) return "0s";
  const total = Math.floor(totalSeconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m === 0 ? `${h}h ${s}s` : `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function initialsFromName(name: string): string {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.[0] || "?").toUpperCase();
}

function statusTone(status: string, signedIn: boolean): "idle" | "ok" | "live" | "warn" {
  const s = status.toLowerCase();
  if (s.includes("active")) return "live";
  if (s.includes("linking")) return "warn";
  if (signedIn) return "ok";
  return "idle";
}

function statusLabel(status: string, signedIn: boolean): string {
  const s = status.toLowerCase();
  if (s.includes("active")) return "Tracking";
  if (s.includes("idle") || s.includes("paused")) return "Paused";
  if (s.includes("linking")) return "Linking";
  if (signedIn) return "Ready";
  return "Signed out";
}

function TitleBar({
  title,
  showBrand = true,
  onClose,
  onCheckUpdate,
  checkingUpdate,
}: {
  title?: string;
  showBrand?: boolean;
  onClose: () => void;
  onCheckUpdate?: () => void;
  checkingUpdate?: boolean;
}) {
  return (
    <header className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region>
        {showBrand ? (
          <>
            <img
              className="titlebar-logo-img"
              src="/app-icon.ico"
              width={16}
              height={16}
              alt=""
              draggable={false}
            />
            {title ? (
              <span className="titlebar-label" data-tauri-drag-region>
                {title}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="titlebar-controls">
        {onCheckUpdate ? (
          <button
            className="win-btn"
            type="button"
            title="Check for updates"
            aria-label="Check for updates"
            disabled={checkingUpdate}
            onClick={onCheckUpdate}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1Zm-7 15a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"
              />
            </svg>
          </button>
        ) : null}
        <button
          className="win-btn"
          type="button"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => void invoke("minimize_current")}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="win-btn win-close"
          type="button"
          title="Close"
          aria-label="Close"
          onClick={onClose}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M1.5 1.5l9 9M10.5 1.5l-9 9"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}

function SettingsPanel({ onBack }: { onBack: () => void }) {
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

function fmtLimitHours(hours: number): string {
  if (!hours || hours <= 0) return "No cap";
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function ProfilePanel({
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

/**
 * Shown when the agent still knows who you are but can no longer talk to the
 * backend. Name and avatar come from the cached token claims, so this renders
 * fully offline. The button recovers in-app - it does not send you to a
 * browser unless the device itself has been unlinked.
 */
function WelcomeBackPanel({
  profile,
  message,
  busy,
  needsRelink,
  staleSession,
  onReconnect,
  onRelink,
  onSwitchAccount,
}: {
  profile: ProfileInfo | null;
  message: string | null;
  busy: boolean;
  needsRelink: boolean;
  /** Signed out server-side but still showing a cached identity. */
  staleSession: boolean;
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
                : staleSession
                  ? "We couldn't verify this session. Continue, or sign in as someone else."
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

// CF-2: full-screen, non-dismissible by design - no back button, no close-X,
// no click-outside-to-dismiss. The only way past it is the Accept action,
// which is exactly what "cannot be hidden or disabled by any setting or
// flag" means for the one screen whose entire job is to require attention.
function MonitoringNoticePanel({
  notice,
  busy,
  onAccept,
}: {
  notice: MonitoringNoticeView;
  busy: boolean;
  onAccept: () => void;
}) {
  return (
    <main className="agent-tray view-home">
      <TitleBar title="Virtual Tracker" onClose={() => void invoke("close_window")} />
      <div className="reconnect-body">
        <div className="notice-card">
          <h1 className="reconnect-name">Before you start tracking</h1>
          <pre className="notice-text">{notice.text}</pre>
          <button
            className="btn btn-primary reconnect-btn"
            type="button"
            disabled={busy}
            onClick={onAccept}
          >
            {busy ? "Recording…" : "I understand — continue"}
          </button>
        </div>
      </div>
    </main>
  );
}

// Signed-out screen: full-width split (brand panel + form), taking over the full 1150x650 window.
function SignInPanel({
  busy,
  actionError,
  signInEmail,
  signInPassword,
  linkPending,
  authView,
  signUp,
  forgot,
  onEmailChange,
  onPasswordChange,
  onPasswordSignIn,
  onSignIn,
  onAuthViewChange,
  onSignUpFieldChange,
  onSignUpSubmit,
  onForgotEmailChange,
  onForgotSubmit,
  onCheckUpdate,
  checkingUpdate,
}: {
  busy: boolean;
  actionError: string | null;
  signInEmail: string;
  signInPassword: string;
  linkPending: boolean;
  authView: AuthView;
  signUp: SignUpState;
  forgot: ForgotState;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onPasswordSignIn: () => void;
  onSignIn: (hint?: string) => void;
  onAuthViewChange: (view: AuthView) => void;
  onSignUpFieldChange: (field: keyof SignUpFields, value: string) => void;
  onSignUpSubmit: () => void;
  onForgotEmailChange: (value: string) => void;
  onForgotSubmit: () => void;
  onCheckUpdate: () => void;
  checkingUpdate: boolean;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

  return (
    <main className="agent-tray view-home">
      <TitleBar
        showBrand={false}
        onClose={() => void invoke("close_window")}
        onCheckUpdate={onCheckUpdate}
        checkingUpdate={checkingUpdate}
      />
      <div className="app-body auth-split">
        <section className="auth-brand" aria-hidden="true">
          <div className="auth-brand-mark">
            <img src="/app-icon.ico" width={36} height={36} alt="" draggable={false} />
            <span>Virtual Tracker</span>
          </div>
          <div className="auth-brand-copy">
            <h2>Time tracking that stays out of your way.</h2>
            <p>Sign in to link this desktop agent to your account and start tracking your work seamlessly.</p>

            <div className="auth-brand-features">
              <div className="auth-feature-item">
                <span className="auth-feature-icon">⚡</span>
                <div>
                  <strong>Instant Sync</strong>
                  <p>Real-time sync with web dashboard & assigned tasks.</p>
                </div>
              </div>
              <div className="auth-feature-item">
                <span className="auth-feature-icon">🔒</span>
                <div>
                  <strong>Enterprise Security</strong>
                  <p>Encrypted device authentication & secure tokens.</p>
                </div>
              </div>
              <div className="auth-feature-item">
                <span className="auth-feature-icon">⏱️</span>
                <div>
                  <strong>Smart Tracking</strong>
                  <p>Automatic idle detection & work limit notifications.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="auth-brand-viz">
            {Array.from({ length: 16 }, (_, i) => (
              <span key={i} className="auth-brand-bar" style={{ animationDelay: `${i * 0.09}s` }} />
            ))}
          </div>
        </section>

        <section className="auth-form-panel">
          <div className="auth-form-card">
            {authView === "signup" ? (
              <>
                <div className="auth-form-head">
                  <h1>Create account</h1>
                  <p>Set up a new Virtual Tracker account</p>
                </div>
                <form
                  className="signin-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSignUpSubmit();
                  }}
                >
                  <div className="auth-back-row">
                    <button className="link-btn" type="button" onClick={() => onAuthViewChange("signin")}>
                      ← Back to sign in
                    </button>
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-first-name">
                      First name
                    </label>
                    <input
                      id="signup-first-name"
                      className="text-input"
                      type="text"
                      autoComplete="given-name"
                      value={signUp.firstName}
                      disabled={signUp.busy}
                      onChange={(e) => onSignUpFieldChange("firstName", e.target.value)}
                    />
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-last-name">
                      Last name
                    </label>
                    <input
                      id="signup-last-name"
                      className="text-input"
                      type="text"
                      autoComplete="family-name"
                      value={signUp.lastName}
                      disabled={signUp.busy}
                      onChange={(e) => onSignUpFieldChange("lastName", e.target.value)}
                    />
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-phone">
                      Phone number
                    </label>
                    <input
                      id="signup-phone"
                      className="text-input"
                      type="tel"
                      autoComplete="tel"
                      value={signUp.phone}
                      disabled={signUp.busy}
                      onChange={(e) => onSignUpFieldChange("phone", e.target.value)}
                    />
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-email">
                      Email address
                    </label>
                    <input
                      id="signup-email"
                      className="text-input"
                      type="email"
                      placeholder="name@company.com"
                      autoComplete="username"
                      spellCheck={false}
                      value={signUp.email}
                      disabled={signUp.busy}
                      onChange={(e) => onSignUpFieldChange("email", e.target.value)}
                    />
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-password">
                      Password
                    </label>
                    <div className="input-wrapper">
                      <input
                        id="signup-password"
                        className="text-input"
                        type={showSignUpPassword ? "text" : "password"}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        value={signUp.password}
                        disabled={signUp.busy}
                        onChange={(e) => onSignUpFieldChange("password", e.target.value)}
                      />
                      <button
                        type="button"
                        className="input-eye-btn"
                        title={showSignUpPassword ? "Hide password" : "Show password"}
                        aria-label={showSignUpPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowSignUpPassword(!showSignUpPassword)}
                      >
                        {showSignUpPassword ? (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-confirm-password">
                      Confirm password
                    </label>
                    <input
                      id="signup-confirm-password"
                      className="text-input"
                      type={showSignUpPassword ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      value={signUp.confirmPassword}
                      disabled={signUp.busy}
                      onChange={(e) => onSignUpFieldChange("confirmPassword", e.target.value)}
                    />
                  </div>

                  {signUp.error ? (
                    <div className="auth-error-banner">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{signUp.error}</span>
                    </div>
                  ) : null}

                  {signUp.success ? (
                    <div className="auth-success-banner">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span>{signUp.success}</span>
                    </div>
                  ) : null}

                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={
                      signUp.busy ||
                      !signUp.firstName ||
                      !signUp.lastName ||
                      !signUp.phone ||
                      !signUp.email ||
                      !signUp.password ||
                      !signUp.confirmPassword
                    }
                  >
                    {signUp.busy ? "Creating account…" : "Create account"}
                  </button>
                </form>
              </>
            ) : authView === "forgot" ? (
              <>
                <div className="auth-form-head">
                  <h1>Reset your password</h1>
                  <p>Enter your email and we'll send you a reset link</p>
                </div>
                <form
                  className="signin-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onForgotSubmit();
                  }}
                >
                  <div className="auth-back-row">
                    <button className="link-btn" type="button" onClick={() => onAuthViewChange("signin")}>
                      ← Back to sign in
                    </button>
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="forgot-email">
                      Email address
                    </label>
                    <input
                      id="forgot-email"
                      className="text-input"
                      type="email"
                      placeholder="name@company.com"
                      autoComplete="username"
                      spellCheck={false}
                      value={forgot.email}
                      disabled={forgot.busy}
                      onChange={(e) => onForgotEmailChange(e.target.value)}
                    />
                  </div>

                  {forgot.error ? (
                    <div className="auth-error-banner">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{forgot.error}</span>
                    </div>
                  ) : null}

                  {forgot.success ? (
                    <div className="auth-success-banner">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span>{forgot.success}</span>
                    </div>
                  ) : null}

                  <button className="btn btn-primary" type="submit" disabled={forgot.busy || !forgot.email}>
                    {forgot.busy ? "Sending…" : "Send reset link"}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="auth-form-head">
                  <h1>Welcome Back</h1>
                  <p>Sign in to your account to get started</p>
                </div>

                <form
                  className="signin-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onPasswordSignIn();
                  }}
                >
                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signin-email">
                      Email address
                    </label>
                    <input
                      id="signin-email"
                      className="text-input"
                      type="email"
                      placeholder="name@company.com"
                      autoComplete="username"
                      spellCheck={false}
                      value={signInEmail}
                      disabled={busy}
                      onChange={(e) => onEmailChange(e.target.value)}
                    />
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signin-password">
                      Password
                    </label>
                    <div className="input-wrapper">
                      <input
                        id="signin-password"
                        className="text-input"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        value={signInPassword}
                        disabled={busy}
                        onChange={(e) => onPasswordChange(e.target.value)}
                      />
                      <button
                        type="button"
                        className="input-eye-btn"
                        title={showPassword ? "Hide password" : "Show password"}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {actionError ? (
                    <div className="auth-error-banner">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{actionError}</span>
                    </div>
                  ) : null}

                  <button className="btn btn-primary" type="submit" disabled={busy || !signInEmail || !signInPassword}>
                    {busy ? "Signing in…" : "Sign in"}
                  </button>

                  <div className="signin-divider">
                    <span>or continue with</span>
                  </div>

                  <div className="social-row">
                    <button
                      className="btn-icon-social"
                      type="button"
                      title="Continue with Google"
                      aria-label="Continue with Google"
                      disabled={busy}
                      onClick={() => onSignIn("provider=google")}
                    >
                      <svg viewBox="0 0 18 18" aria-hidden="true" width="18" height="18">
                        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z" />
                        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z" />
                        <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z" />
                        <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
                      </svg>
                      Google
                    </button>

                    <button
                      className="btn-icon-social"
                      type="button"
                      title="Continue with Apple"
                      aria-label="Continue with Apple"
                      disabled={busy}
                      onClick={() => onSignIn("provider=apple")}
                    >
                      <svg viewBox="0 0 17 20" aria-hidden="true" width="16" height="19">
                        <path
                          fill="currentColor"
                          d="M13.94 10.6c-.02-2.1 1.72-3.1 1.8-3.15-.98-1.44-2.5-1.63-3.04-1.65-1.3-.13-2.53.76-3.19.76-.66 0-1.68-.75-2.76-.73-1.42.02-2.73.83-3.46 2.1-1.47 2.56-.38 6.35 1.06 8.42.7 1.02 1.53 2.15 2.63 2.11 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.75.66 1.14-.02 1.86-1.03 2.55-2.06.8-1.18 1.13-2.32 1.15-2.38-.03-.01-2.19-.84-2.21-3.4ZM11.86 4.36c.58-.7.97-1.68.86-2.65-.83.03-1.85.56-2.45 1.25-.54.6-1.01 1.6-.88 2.55.93.07 1.88-.47 2.47-1.15Z"
                        />
                      </svg>
                      Apple
                    </button>
                  </div>

                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => onSignIn()}
                  >
                    {linkPending ? "Open link page" : "Link account via browser"}
                  </button>

                  <div className="signin-links">
                    <button className="link-btn" type="button" onClick={() => onAuthViewChange("signup")}>
                      Create account
                    </button>
                    <button className="link-btn" type="button" onClick={() => onAuthViewChange("forgot")}>
                      Forgot password?
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

type DropdownOption = { id: string; label: string };

function Dropdown({
  id,
  value,
  options,
  placeholder,
  emptyLabel,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  options: DropdownOption[];
  placeholder: string;
  emptyLabel: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selected = options.find((o) => o.id === value);
  const isEmpty = options.length === 0;

  const openAt = (index: number) => {
    setActiveIndex(Math.max(0, Math.min(options.length - 1, index)));
    setOpen(true);
  };

  const commit = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (isEmpty) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          openAt(options.findIndex((o) => o.id === value));
        } else {
          setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) {
          openAt(options.findIndex((o) => o.id === value));
        } else {
          setActiveIndex((i) => Math.max(0, i - 1));
        }
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) commit(activeIndex);
        else openAt(Math.max(0, options.findIndex((o) => o.id === value)));
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      default:
        break;
    }
  };

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open && options[activeIndex] ? `${id}-opt-${activeIndex}` : undefined}
        className={`dropdown-trigger${open ? " open" : ""}`}
        disabled={disabled || isEmpty}
        onClick={() => (open ? setOpen(false) : openAt(Math.max(0, options.findIndex((o) => o.id === value))))}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="dropdown-value">
          {selected ? selected.label : isEmpty ? emptyLabel : placeholder}
        </span>
        <svg
          className={`dropdown-chevron${open ? " open" : ""}`}
          viewBox="0 0 12 12"
          width="10"
          height="10"
          aria-hidden="true"
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && !isEmpty ? (
        <div className="dropdown-menu" role="listbox" id={`${id}-listbox`}>
          {options.map((option, index) => (
            <button
              key={option.id}
              id={`${id}-opt-${index}`}
              type="button"
              role="option"
              aria-selected={option.id === value}
              className={`dropdown-item${option.id === value ? " active" : ""}${index === activeIndex ? " highlighted" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MainApp() {
  const [view, setView] = useState<"home" | "settings" | "profile">("home");
  const [signingOut, setSigningOut] = useState(false);
  const [memberLimits, setMemberLimits] = useState<MemberLimits | null>(null);
  const [memberProfile, setMemberProfile] = useState<MemberProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [link, setLink] = useState<LinkStatus | null>(null);
  const [monitoringNotice, setMonitoringNotice] = useState<MonitoringNoticeView | null>(null);
  const [acceptingNotice, setAcceptingNotice] = useState(false);
  const [version, setVersion] = useState("0.4.0");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [taskTracking, setTaskTracking] = useState<TaskTimeTracking | null>(null);
  const [liveActiveSeconds, setLiveActiveSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [refreshingData, setRefreshingData] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("connected");
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectMessage, setReconnectMessage] = useState<string | null>(null);
  const [needsRelink, setNeedsRelink] = useState(false);
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [authView, setAuthView] = useState<AuthView>("signin");
  const [signUp, setSignUp] = useState<SignUpState>({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
    busy: false,
    error: null,
    success: null,
  });
  const [forgot, setForgot] = useState<ForgotState>({
    email: "",
    busy: false,
    error: null,
    success: null,
  });
  // Distinguishes "you have no projects" from "we couldn't load them" - they
  // used to render identically, which is what made a dead session look like an
  // empty account.
  const [projectsFailed, setProjectsFailed] = useState(false);
  const [bars, setBars] = useState<number[]>(() =>
    Array.from({ length: 9 }, () => 20),
  );

  useEffect(() => {
    setAvatarError(false);
  }, [profile?.avatarUrl]);

  const checkForUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (err) {
      console.error("update check failed", err);
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  const signedIn = Boolean(profile?.signedIn);
  // get_profile builds identity from the cached id token's claims, so an
  // expired/revoked/wrong-user token still reports signedIn. Paired with a
  // signedOut connection state that means: we still show a user, the server
  // no longer accepts them.
  const staleSession = connection === "signedOut" && signedIn;
  const tracking =
    (session?.status || "").toLowerCase() === "active" ||
    (link?.status || "").toLowerCase().includes("active");

  const refresh = useCallback(async () => {
    const [nextProfile, nextLink, nextSession, nextConnection, nextNotice] = await Promise.all([
      invoke<ProfileInfo>("get_profile"),
      invoke<LinkStatus>("get_link_status"),
      invoke<SessionInfo>("get_session").catch(() => null),
      invoke<ConnectionState>("get_connection_state").catch<ConnectionState>(() => "connected"),
      // CF-2: same poll cadence as everything else here, so a capability
      // change server-side (which bumps the notice version) surfaces within
      // one cycle. A failed fetch leaves the previous value in place rather
      // than clearing it - a network blip must not be read as "acknowledged".
      invoke<MonitoringNoticeView | null>("get_monitoring_notice").catch(() => undefined),
    ]);
    setProfile(nextProfile);
    setLink(nextLink);
    setConnection(nextConnection);
    if (nextSession) {
      setSession(nextSession);
      if (nextSession.taskId) {
        setSelectedTaskId(nextSession.taskId);
      }
    }
    if (nextNotice !== undefined) {
      setMonitoringNotice(nextNotice);
    }
    setLoadingProfile(false);
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!signedIn) {
      setProjects([]);
      setSelectedProjectId("");
      return;
    }
    try {
      const next = await invoke<ProjectInfo[]>("list_projects");
      setProjects(next);
      setProjectsFailed(false);
      setSelectedProjectId((current) =>
        current && next.some((p) => p.id === current) ? current : "",
      );
    } catch {
      setProjects([]);
      setProjectsFailed(true);
    }
  }, [signedIn]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const isCallingProject = selectedProject?.projectType === "calling";
  // Only a picked, task-based project has tasks to choose from.
  const showTaskPicker = Boolean(selectedProjectId) && !isCallingProject;

  const refreshTasks = useCallback(async () => {
    if (!signedIn || !selectedProjectId || isCallingProject) {
      setTasks([]);
      setSelectedTaskId("");
      return;
    }
    try {
      const next = await invoke<AgentTask[]>("list_tasks", {
        projectId: selectedProjectId,
      });
      setTasks(next);
      setSelectedTaskId((current) => {
        if (current && next.some((t) => t.id === current)) return current;
        return next[0]?.id || "";
      });
    } catch {
      setTasks([]);
    }
  }, [signedIn, selectedProjectId, isCallingProject]);

  const handleManualRefresh = async () => {
    if (refreshingData) return;
    setRefreshingData(true);
    try {
      await Promise.all([refresh(), refreshProjects()]);
      await refreshTasks();
    } catch (err) {
      console.error("manual refresh failed", err);
    } finally {
      setRefreshingData(false);
    }
  };

  // Every poll below is guarded by an in-flight ref. Without it, a slow or
  // stalled backend (sleep, fullscreen game, dead network) lets each 5s tick
  // queue another four invocations that all fire at once on unblock - a 30s
  // stall used to enqueue roughly two dozen.
  const refreshInFlight = useRef(false);
  const trackingInFlight = useRef(false);
  const limitsInFlight = useRef(false);

  const refreshGuarded = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      await refresh();
    } finally {
      refreshInFlight.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    void invoke<string>("get_version")
      .then(setVersion)
      .catch(() => undefined);
    void refreshGuarded()
      .catch(console.error)
      .finally(() => setLoadingProfile(false));

    const onStatus = () => {
      void refreshGuarded().catch(console.error);
    };
    // Coming back from the tray, from sleep, or from a fullscreen game: check
    // the session immediately instead of letting the next click be the thing
    // that discovers the token aged out. The in-flight guard makes this free
    // when a poll is already running.
    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      void refreshGuarded().catch(console.error);
    };
    window.addEventListener("vt-status", onStatus);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    const timer = window.setInterval(() => {
      void refreshGuarded().catch(console.error);
    }, 5000);
    return () => {
      window.removeEventListener("vt-status", onStatus);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
      window.clearInterval(timer);
    };
  }, [refreshGuarded]);

  useEffect(() => {
    void refreshProjects().catch(console.error);
  }, [refreshProjects, signedIn]);

  useEffect(() => {
    void refreshTasks().catch(console.error);
  }, [refreshTasks]);

  const refreshTaskTracking = useCallback(async () => {
    if (!selectedTaskId) {
      setTaskTracking(null);
      return;
    }
    if (trackingInFlight.current) return;
    trackingInFlight.current = true;
    try {
      const next = await invoke<TaskTimeTracking | null>("get_task_time_tracking", {
        taskId: selectedTaskId,
      });
      setTaskTracking(next);
    } catch {
      setTaskTracking(null);
    } finally {
      trackingInFlight.current = false;
    }
  }, [selectedTaskId]);

  useEffect(() => {
    void refreshTaskTracking();
    const timer = window.setInterval(() => void refreshTaskTracking(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshTaskTracking]);

  // The personal daily/weekly cap, which is the *only* thing that limits a
  // calling-project timer. Polled on the home view too (not just the profile
  // view, as before) because "Remaining today" has to keep counting down
  // while the clock runs.
  const refreshMemberLimits = useCallback(async () => {
    if (!signedIn || limitsInFlight.current) return;
    limitsInFlight.current = true;
    try {
      setMemberLimits(await invoke<MemberLimits>("get_member_limits"));
    } catch {
      setMemberLimits(null);
    } finally {
      limitsInFlight.current = false;
    }
  }, [signedIn]);

  useEffect(() => {
    if (view !== "home" && view !== "profile") return;
    void refreshMemberLimits();
    const timer = window.setInterval(() => void refreshMemberLimits(), 5000);
    return () => window.clearInterval(timer);
  }, [view, refreshMemberLimits]);

  // The People-page member record never changes while the app is open - one
  // fetch when the profile view opens, no polling.
  useEffect(() => {
    if (view !== "profile" || !signedIn) return;
    invoke<MemberProfile>("get_member_profile")
      .then(setMemberProfile)
      .catch(() => setMemberProfile(null));
  }, [view, signedIn]);

  // Re-sync from the last server snapshot, then tick locally so the clock is
  // smooth between 5s polls instead of jumping.
  //
  // TC-3: session.activeSeconds only advances every SESSION_SYNC_INTERVAL_SEC
  // (20s) server-side, but this poll runs every 5s - so most polls read a
  // value the local ticker has already passed. Same invariant as
  // Dashboard-Web's applyBackendTaskTimerState({ preferLocalIfHigher }):
  // "backend is source of truth when idle; while timer runs, never drop
  // below local counters." While tracking, the displayed clock can only move
  // forward - a stale/behind poll is ignored until the server catches up
  // past it. Once tracking stops (new task, new session, genuinely no
  // session) the guard drops and the server value is taken verbatim.
  useEffect(() => {
    const next = session?.activeSeconds ?? 0;
    setLiveActiveSeconds((s) => (tracking ? Math.max(s, next) : next));
  }, [session?.activeSeconds, tracking]);

  useEffect(() => {
    if (!tracking) return;
    const timer = window.setInterval(() => setLiveActiveSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [tracking]);

  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  useEffect(() => {
    if (!tracking) {
      setBars(Array.from({ length: 9 }, () => 12));
      return;
    }
    const barTimer = window.setInterval(() => {
      setBars(Array.from({ length: 9 }, () => Math.floor(Math.random() * 75) + 15));
    }, 800);
    return () => window.clearInterval(barTimer);
  }, [tracking]);

  // In-app sign-in. The password lives in component state only for as long as
  // the form is on screen and is cleared the moment the call returns - it is
  // never written anywhere, and the Rust side does not persist it either.
  const handlePasswordSignIn = async () => {
    if (busy) return;
    setActionError(null);
    setBusy(true);
    try {
      const result = await invoke<SignInResult>("sign_in_with_password", {
        email: signInEmail,
        password: signInPassword,
      });
      if (result.success) {
        toast.success("Signed in");
        await refresh();
        await refreshProjects();
      } else {
        const msg = result.error || "Could not sign in";
        setActionError(msg);
        toast.error(msg);
      }
    } catch {
      const msg = "Could not sign in. Check your connection and try again.";
      setActionError(msg);
      toast.error(msg);
    } finally {
      // Clear on every attempt, not just success — a failed password
      // shouldn't linger in memory/DOM waiting for the user to retype it.
      setSignInPassword("");
      setBusy(false);
    }
  };

  // Generic link and the two social buttons still hand off to the browser -
  // the hint tells the web login page which provider pane to open first, and
  // the link token is what ties that browser tab back to this device. Create
  // account / Forgot password no longer go through here; they're native forms
  // below (handleSignUp / handleForgotPassword).
  const handleSignIn = async (hint?: string) => {
    setActionError(null);
    setBusy(true);
    try {
      const result = await invoke<SignInResult>("sign_in", { hint: hint ?? null });
      if (result && result.success === false) {
        const msg = result.error || "Sign-in failed";
        setActionError(msg);
        toast.error(msg);
      }
      await refresh();
    } catch {
      const msg = "Sign-in is not ready yet. Reopen the agent and try again.";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSignUpFieldChange = (field: keyof SignUpFields, value: string) => {
    setSignUp((s) => ({ ...s, [field]: value, error: null }));
  };

  // In-app account creation, no browser round-trip. Mirrors the web's
  // register form: create the account, then ask the user to verify their
  // email and sign in normally - it does not sign the agent in directly.
  const handleSignUp = async () => {
    if (signUp.busy) return;
    if (signUp.password !== signUp.confirmPassword) {
      setSignUp((s) => ({ ...s, error: "Passwords do not match." }));
      return;
    }
    setSignUp((s) => ({ ...s, busy: true, error: null, success: null }));
    try {
      const result = await invoke<SignInResult>("sign_up", {
        email: signUp.email,
        password: signUp.password,
        firstName: signUp.firstName,
        lastName: signUp.lastName,
        phone: signUp.phone,
      });
      if (result.success) {
        toast.success("Account created");
        setSignInEmail(signUp.email);
        setSignUp({
          firstName: "",
          lastName: "",
          phone: "",
          email: "",
          password: "",
          confirmPassword: "",
          busy: false,
          error: null,
          success: `Account created. We sent a verification email to ${signUp.email}. Verify your email, then sign in.`,
        });
        setAuthView("signin");
      } else {
        const msg = result.error || "Could not create account";
        setSignUp((s) => ({ ...s, busy: false, error: msg }));
        toast.error(msg);
      }
    } catch {
      const msg = "Could not create account. Check your connection and try again.";
      setSignUp((s) => ({ ...s, busy: false, error: msg }));
      toast.error(msg);
    }
  };

  const handleForgotEmailChange = (value: string) => {
    setForgot((f) => ({ ...f, email: value, error: null }));
  };

  // In-app password reset request, no browser round-trip. Enumeration-safe on
  // the Rust side - "success" here means the request was accepted, not that
  // this email has an account.
  const handleForgotPassword = async () => {
    if (forgot.busy) return;
    setForgot((f) => ({ ...f, busy: true, error: null, success: null }));
    try {
      const result = await invoke<SignInResult>("send_password_reset", { email: forgot.email });
      if (result.success) {
        setForgot((f) => ({
          ...f,
          busy: false,
          success: "If an account exists for this email, a password reset link has been sent.",
        }));
      } else {
        const msg = result.error || "Could not send reset email";
        setForgot((f) => ({ ...f, busy: false, error: msg }));
        toast.error(msg);
      }
    } catch {
      const msg = "Could not send reset email. Check your connection and try again.";
      setForgot((f) => ({ ...f, busy: false, error: msg }));
      toast.error(msg);
    }
  };

  const handleAuthViewChange = (view: AuthView) => {
    setAuthView(view);
    setActionError(null);
    setSignUp((s) => ({ ...s, error: null, success: null }));
    setForgot((f) => ({ ...f, error: null, success: null }));
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    setReconnectMessage(null);
    try {
      const result = await invoke<ReconnectResult>("reconnect");
      if (result.success) {
        setNeedsRelink(false);
        setConnection("connected");
        toast.success("Reconnected");
        await refresh();
        await refreshProjects();
        await refreshTasks();
      } else {
        setNeedsRelink(result.needsRelink);
        setReconnectMessage(result.error ?? "Could not reconnect.");
      }
    } catch {
      setReconnectMessage("Could not reconnect. Try again in a moment.");
    } finally {
      setReconnecting(false);
    }
  };

  // CF-2: records disclosure + consent for the notice currently shown, then
  // re-fetches it so the blocking panel clears only once the server has
  // actually confirmed the acknowledgement - never optimistically.
  const handleAcceptNotice = async () => {
    if (!monitoringNotice) return;
    setAcceptingNotice(true);
    try {
      const ok = await invoke<boolean>("acknowledge_monitoring_notice", {
        noticeVersion: monitoringNotice.version,
      });
      if (ok) {
        await refresh();
      } else {
        toast.error("Could not record your acknowledgement — check your connection and try again.");
      }
    } catch {
      toast.error("Could not record your acknowledgement — check your connection and try again.");
    } finally {
      setAcceptingNotice(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    setActionError(null);
    try {
      await invoke("sign_out");
      setView("home");
      await refresh();
    } catch {
      setActionError("Could not sign out. Try again.");
    } finally {
      setSigningOut(false);
    }
  };

  // Clears this machine's tokens *and* device credential, then falls back to
  // the signed-out home view - which is now the in-app sign-in form, so
  // switching user no longer requires a browser trip at all. The form's own
  // "Link account in browser" button covers the provider accounts it can't
  // handle.
  const handleSwitchAccount = async () => {
    setReconnectMessage(null);
    setSignInEmail("");
    setSignInPassword("");
    try {
      await invoke("sign_out");
    } catch {
      // Best-effort: the refresh below reflects whatever state we ended in.
    }
    await refresh();
  };

  const handleStart = async () => {
    if (isCallingProject) {
      await startCallingSession();
      return;
    }
    if (!selectedTaskId) {
      const msg = "Select a task to start tracking";
      setActionError(msg);
      toast.error(msg);
      return;
    }
    if (taskTracking?.limitReached) {
      const msg = taskTracking.allowanceMessage || "Maximum allowed work time reached.";
      setActionError(msg);
      toast.error(msg);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await invoke<ActionResult>("start_task_session", {
        taskId: selectedTaskId,
      });
      if (!result.success) {
        const msg = result.error || "Could not start session";
        setActionError(msg);
        toast.error(msg);
      } else if (result.session) {
        setSession(result.session);
        toast.success("Tracking session started");
      }
      await refresh();
    } catch {
      const msg = "Could not start session";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  // Calling projects have no task to pick, so the timer runs against the
  // project itself. The backend enforces the member's own hour cap there.
  const startCallingSession = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await invoke<ActionResult>("start_project_session", {
        projectId: selectedProjectId,
      });
      if (!result.success) {
        const msg = result.error || "Could not start session";
        setActionError(msg);
        toast.error(msg);
      } else if (result.session) {
        setSession(result.session);
        toast.success("Tracking session started");
      }
      await refresh();
    } catch {
      const msg = "Could not start session";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await invoke<ActionResult>("stop_session");
      if (!result.success) {
        const msg = result.error || "Could not stop session";
        setActionError(msg);
        toast.error(msg);
      } else if (result.session) {
        setSession(result.session);
        toast.message("Tracking session paused");
      }
      await refresh();
    } catch {
      const msg = "Could not stop session";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const idleStage = session?.idleStage ?? 0;
  const tone = statusTone(link?.status || "", signedIn);
  const displayName = loadingProfile ? "Loading…" : profile?.name || "Not signed in";
  const firstName =
    signedIn && profile?.name ? profile.name.trim().split(/\s+/)[0] : displayName;
  const selectedTask = tasks.find((t) => t.id === selectedTaskId);
  // Calling sessions have no task title to show, so the project names the run.
  const trackingLabel = isCallingProject
    ? selectedProject?.name ?? ""
    : selectedTask?.title ?? "";

  const remainingLabel = !taskTracking
    ? "—"
    : taskTracking.limitReached
      ? "Limit reached"
      : taskTracking.allowedRemainingSeconds == null
        ? "No cap"
        : `${fmtHours(taskTracking.allowedRemainingSeconds)} left`;

  // The member's own cap, straight from /api/activity/limits. Task projects
  // fold this into "Remaining" above, which hides *which* cap is binding;
  // calling projects had no cap information on screen at all.
  const dailyCapLabel = !memberLimits
    ? "—"
    : memberLimits.usesShifts
      ? "By shifts"
      : memberLimits.dailyHours > 0
        ? fmtLimitHours(memberLimits.dailyHours)
        : memberLimits.weeklyHours > 0
          ? `${fmtLimitHours(memberLimits.weeklyHours)}/wk`
          : "No hour limit";
  const capSubLabel = !memberLimits
    ? ""
    : memberLimits.usesShifts
      ? "Scheduled by shifts — no daily cap"
      : memberLimits.dailyHours > 0
        ? "your daily limit"
        : memberLimits.weeklyHours > 0
          ? "weekly limit — no daily cap"
          : "no cap set on your account";
  const remainingTodayLabel = !memberLimits
    ? "—"
    : memberLimits.usesShifts || memberLimits.allowedRemainingSeconds == null
      ? "No cap"
      : memberLimits.limitReached
        ? "Limit reached"
        : `${fmtHours(memberLimits.allowedRemainingSeconds)} left`;
  const workedTodayLabel = memberLimits ? fmtHours(memberLimits.workedTodaySeconds) : "—";

  // Rendered under both project types: on its own for a calling project (which
  // has no task stats at all), and alongside the task cards otherwise.
  const hoursTodayCards = (
    <div className="stat-grid cols-3 page-content-swap" style={{ animationDelay: "0.04s" }}>
      <div className="stat-card">
        <span className="stat-card-label">Today, all work</span>
        <span className="stat-card-value">{workedTodayLabel}</span>
        <span className="stat-card-sub">across every project</span>
      </div>
      <div className="stat-card">
        <span className="stat-card-label">Daily cap</span>
        <span className="stat-card-value">{dailyCapLabel}</span>
        {capSubLabel ? <span className="stat-card-sub">{capSubLabel}</span> : null}
      </div>
      <div className="stat-card">
        <span className="stat-card-label">Remaining today</span>
        <span className={`stat-card-value${memberLimits?.limitReached ? " warn" : ""}`}>
          {remainingTodayLabel}
        </span>
      </div>
    </div>
  );

  // Whole-task budget remaining, independent of whichever daily/weekly cap
  // "Remaining" above is currently bound by. activeSeconds here is the
  // cumulative total worked on this task across every day, so this decreases
  // by real time worked whether it came out of regular or overtime hours.
  const taskBudgetRemainingLabel = !taskTracking?.estimatedSeconds
    ? "—"
    : fmtHours(Math.max(0, taskTracking.estimatedSeconds - taskTracking.activeSeconds));

  if (view === "settings") {
    return <SettingsPanel onBack={() => setView("home")} />;
  }

  // CF-2: mandatory disclosure. Blocks every view except settings (sign-out
  // has to stay reachable for someone who doesn't want to consent) and never
  // interrupts a session already in progress - same "don't yank the screen
  // away mid-timer" rule the reconnect flow below follows. The real
  // enforcement is server-side (start_task_session/start_project_session
  // both refuse while unacknowledged); this is what makes that visible
  // instead of surfacing as a rejected click. Gated on being actually
  // connected - a stale cached "requires acknowledgement" from before a
  // disconnect must not block the reconnect flow's own escape hatch below.
  if (
    signedIn &&
    connection !== "disconnected" &&
    !staleSession &&
    !tracking &&
    monitoringNotice?.requiresAcknowledgement
  ) {
    return (
      <MonitoringNoticePanel
        notice={monitoringNotice}
        busy={acceptingNotice}
        onAccept={() => void handleAcceptNotice()}
      />
    );
  }

  // Recovery takes over the window only when idle. Mid-timer it stays a
  // banner - yanking away a running clock reads as lost work, and the tracker
  // keeps counting locally and flushes once the connection returns.
  //
  // "signedOut with a cached profile" is the stale-session case: the refresh
  // token was rejected and there is no device credential, so get_profile still
  // renders the old user from JWT claims while every real call 401s. Without
  // this branch the home view looked normal and nothing offered a way out.
  if ((connection === "disconnected" || staleSession) && !tracking && view === "home") {
    return (
      <WelcomeBackPanel
        profile={profile}
        message={reconnectMessage}
        busy={reconnecting || busy}
        needsRelink={needsRelink || staleSession}
        staleSession={staleSession}
        onReconnect={() => void handleReconnect()}
        onRelink={() => void handleSignIn()}
        onSwitchAccount={() => void handleSwitchAccount()}
      />
    );
  }

  if (!signedIn && view === "home") {
    return (
      <SignInPanel
        busy={busy}
        actionError={actionError}
        signInEmail={signInEmail}
        signInPassword={signInPassword}
        linkPending={profile?.linkPending ?? false}
        authView={authView}
        signUp={signUp}
        forgot={forgot}
        onEmailChange={setSignInEmail}
        onPasswordChange={setSignInPassword}
        onPasswordSignIn={() => void handlePasswordSignIn()}
        onSignIn={(hint) => void handleSignIn(hint)}
        onAuthViewChange={handleAuthViewChange}
        onSignUpFieldChange={handleSignUpFieldChange}
        onSignUpSubmit={() => void handleSignUp()}
        onForgotEmailChange={handleForgotEmailChange}
        onForgotSubmit={() => void handleForgotPassword()}
        onCheckUpdate={() => void checkForUpdate()}
        checkingUpdate={checkingUpdate}
      />
    );
  }

  if (view === "profile") {
    return (
      <ProfilePanel
        profile={profile}
        memberProfile={memberProfile}
        memberLimits={memberLimits}
        onBack={() => setView("home")}
        onSignOut={() => void handleSignOut()}
        signingOut={signingOut}
      />
    );
  }

  return (
    <main className="agent-tray view-home">
      <TitleBar
        title="Virtual Tracker"
        onClose={() => void invoke("close_window")}
        onCheckUpdate={() => void checkForUpdate()}
        checkingUpdate={checkingUpdate}
      />

      <div className={`app-body${signedIn ? "" : " app-body-auth-only"}`}>
        <aside className="side-panel">
          <section className="hero-card">
            <div className="hero-top">
              <button
                type="button"
                className="avatar-wrap avatar-button"
                disabled={!signedIn}
                title={signedIn ? "View profile" : undefined}
                aria-label="View profile"
                onClick={() => setView("profile")}
              >
                {profile?.avatarUrl && !avatarError ? (
                  <img
                    className="avatar-img"
                    src={profile.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    draggable={false}
                    onError={() => setAvatarError(true)}
                  />
                ) : (
                  <div className="avatar-fallback">
                    {signedIn ? initialsFromName(displayName) : "VT"}
                  </div>
                )}
              </button>
              <div className="hero-copy">
                <span className="hero-kicker">Desktop Agent</span>
                <h1 className="hero-name">{firstName}</h1>
              </div>
              <span
                className={`pill pill-${loadingProfile ? "idle" : connection === "disconnected" ? "warn" : tone
                  }`}
              >
                {loadingProfile
                  ? "Loading"
                  : connection === "disconnected"
                    ? "Offline"
                    : statusLabel(link?.status || "", signedIn)}
              </span>
            </div>

            <div className={`signal${tracking ? " live" : ""}`}>
              <div className="viz-bars" aria-hidden="true">
                {bars.map((height, index) => (
                  <span
                    key={index}
                    className="viz-bar"
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
              <p className="signal-text">
                {loadingProfile
                  ? "Checking your session…"
                  : tracking
                    ? `Tracking${trackingLabel ? ` · ${trackingLabel}` : ""}`
                    : signedIn
                      ? isCallingProject
                        ? "Start when you’re ready"
                        : "Select a task and start when you’re ready"
                      : "Sign in to link this PC to your account"}
              </p>
            </div>
          </section>

          {loadingProfile ? (
            <div className="side-skeleton side-panel-swap" aria-hidden="true">
              <span className="skeleton-bar skeleton-bar-lg" />
              <span className="skeleton-bar" />
            </div>
          ) : !signedIn ? (
            /* Sign in here, in the app. The browser link flow stays as a peer
               option below it - it is still the only path for Google/Apple
               accounts and for anything needing a second factor. */
            <form
              className="signin-form side-panel-swap"
              onSubmit={(event) => {
                event.preventDefault();
                void handlePasswordSignIn();
              }}
            >
              <label className="task-label" htmlFor="signin-email">
                Email
              </label>
              <input
                id="signin-email"
                className="text-input"
                type="email"
                autoComplete="username"
                spellCheck={false}
                value={signInEmail}
                disabled={busy}
                onChange={(e) => setSignInEmail(e.target.value)}
              />

              <label className="task-label" htmlFor="signin-password">
                Password
              </label>
              <input
                id="signin-password"
                className="text-input"
                type="password"
                autoComplete="current-password"
                value={signInPassword}
                disabled={busy}
                onChange={(e) => setSignInPassword(e.target.value)}
              />

              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>

              <div className="signin-divider">
                <span>or</span>
              </div>

              {/* Google/Apple can't run inside this app's own webview (Google
                  actively blocks OAuth in embedded webviews; Apple requires a
                  full web context too) - both open the system browser to the
                  web login page's existing, working provider buttons, with a
                  hint so that page jumps straight to the right one instead of
                  landing on plain email/password. */}
              <button
                className="btn btn-social btn-google"
                type="button"
                disabled={busy}
                onClick={() => void handleSignIn("provider=google")}
              >
                <svg viewBox="0 0 18 18" aria-hidden="true" width="16" height="16">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z" />
                  <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
                </svg>
                Continue with Google
              </button>

              <button
                className="btn btn-social btn-apple"
                type="button"
                disabled={busy}
                onClick={() => void handleSignIn("provider=apple")}
              >
                <svg viewBox="0 0 17 20" aria-hidden="true" width="15" height="17">
                  <path
                    fill="currentColor"
                    d="M13.94 10.6c-.02-2.1 1.72-3.1 1.8-3.15-.98-1.44-2.5-1.63-3.04-1.65-1.3-.13-2.53.76-3.19.76-.66 0-1.68-.75-2.76-.73-1.42.02-2.73.83-3.46 2.1-1.47 2.56-.38 6.35 1.06 8.42.7 1.02 1.53 2.15 2.63 2.11 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.75.66 1.14-.02 1.86-1.03 2.55-2.06.8-1.18 1.13-2.32 1.15-2.38-.03-.01-2.19-.84-2.21-3.4ZM11.86 4.36c.58-.7.97-1.68.86-2.65-.83.03-1.85.56-2.45 1.25-.54.6-1.01 1.6-.88 2.55.93.07 1.88-.47 2.47-1.15Z"
                  />
                </svg>
                Continue with Apple
              </button>

              <button
                className="btn btn-secondary"
                type="button"
                disabled={busy}
                onClick={() => void handleSignIn()}
              >
                {profile?.linkPending ? "Open link page" : "Link account in browser"}
              </button>

              <div className="signin-links">
                {/* Both live on the web app's single auth page, which switches
                    modes internally - no separate routes to point at. Each
                    hint just pre-selects the right pane there. */}
                <button
                  className="link-btn"
                  type="button"
                  onClick={() => void handleSignIn("mode=signup")}
                >
                  Create account
                </button>
                <button
                  className="link-btn"
                  type="button"
                  onClick={() => void handleSignIn("mode=forgot-password")}
                >
                  Forgot password?
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Centred as a pair, so the project card visibly rides upward as
                  the task card grows in - and sits centred on its own for a
                  calling project, which never gets one. */}
              <div className="selector-stack side-panel-swap">
                <section className="task-card">
                  <label className="task-label" htmlFor="project-select">
                    Project
                  </label>
                  <Dropdown
                    id="project-select"
                    value={selectedProjectId}
                    options={projects.map((project) => ({ id: project.id, label: project.name }))}
                    placeholder="Select a project"
                    emptyLabel={projectsFailed ? "Couldn't load projects" : "No projects"}
                    disabled={busy || tracking}
                    onChange={setSelectedProjectId}
                  />
                </section>

                <div
                  className={`task-slot${showTaskPicker ? " open" : ""}`}
                  aria-hidden={!showTaskPicker}
                  inert={!showTaskPicker}
                >
                  <section className="task-card">
                    <label className="task-label" htmlFor="task-select">
                      Your tasks
                    </label>
                    <Dropdown
                      id="task-select"
                      value={selectedTaskId}
                      options={tasks.map((task) => ({ id: task.id, label: task.title }))}
                      placeholder="Select a task"
                      emptyLabel="No assigned tasks"
                      disabled={busy || tracking}
                      onChange={setSelectedTaskId}
                    />
                  </section>
                </div>
              </div>

              <nav className="actions side-panel-swap" style={{ animationDelay: "0.06s" }}>
                {tracking ? (
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleStop()}
                  >
                    Stop tracking
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={
                      busy ||
                      (isCallingProject ? !selectedProjectId : !selectedTaskId) ||
                      Boolean(taskTracking?.limitReached)
                    }
                    title={taskTracking?.limitReached ? taskTracking.allowanceMessage || "Maximum allowed work time reached." : undefined}
                    onClick={() => void handleStart()}
                  >
                    Start tracking
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void invoke("open_web_app")}
                >
                  Open dashboard
                </button>
                <button
                  className="btn btn-tertiary"
                  type="button"
                  onClick={() => void handleSignIn()}
                >
                  Re-link account
                </button>
              </nav>
            </>
          )}

          {connection === "disconnected" ? (
            <div className="reconnect-banner">
              <span>Connection lost — time is still being counted locally.</span>
              <button type="button" disabled={reconnecting} onClick={() => void handleReconnect()}>
                {reconnecting ? "Reconnecting…" : "Reconnect"}
              </button>
            </div>
          ) : null}

          {actionError ? <p className="inline-error">{actionError}</p> : null}

          <button
            className="settings-corner-btn"
            type="button"
            title="Settings"
            aria-label="Settings"
            onClick={() => setView("settings")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.484.484 0 0 0 14.06 2h-3.88c-.24 0-.45.17-.49.41l-.36 2.54a7.03 7.03 0 0 0-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.39 1.04.71 1.62.94l.36 2.54c.05.24.25.41.49.41h3.88c.24 0 .44-.17.49-.41l.36-2.54c.58-.23 1.12-.55 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
              />
            </svg>
          </button>
        </aside>

        {signedIn ? (
          <section className="page-area">
            <div className="page-header">
              <div className="page-header-titles">
                <span className="page-eyebrow">Today</span>
                <h2 className="page-title">{trackingLabel || "Time Tracking"}</h2>
              </div>
              <button
                className="page-refresh-btn"
                type="button"
                title="Refresh projects & tasks"
                aria-label="Refresh projects & tasks"
                disabled={refreshingData}
                onClick={() => void handleManualRefresh()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className={refreshingData ? "spin" : undefined}>
                  <path
                    fill="currentColor"
                    d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
                  />
                </svg>
              </button>
            </div>

            {signedIn && (selectedTaskId || (isCallingProject && selectedProjectId)) ? (
              <>
                <div className="page-clock page-content-swap">
                  <span className="page-clock-value">{fmtClock(liveActiveSeconds)}</span>
                  <span className="page-clock-label">{tracking ? "Elapsed · Tracking" : "Paused"}</span>
                </div>

                {/* Your own hours - the only cap a calling project has, and the
                  one the task cards below fold invisibly into "Remaining". */}
                <h3 className="stat-group-label">Your hours today</h3>
                {hoursTodayCards}

                {/* Task estimates, progress and budget are what performance is
                  measured from - a calling project has none of it by design. */}
                {isCallingProject ? null : (
                  <div className="stat-grid page-content-swap" style={{ animationDelay: "0.08s" }}>
                    <div className="stat-card">
                      <span className="stat-card-label">Today, this task</span>
                      <span className="stat-card-value">{fmtHours(taskTracking?.workedTodayOnTaskSeconds)}</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-card-label">Task total</span>
                      <span className="stat-card-value">
                        {taskTracking?.estimatedSeconds ? fmtHours(taskTracking.estimatedSeconds) : "—"}
                      </span>
                      {taskTracking?.workingDays && taskTracking?.hoursPerDay ? (
                        <span className="stat-card-sub">
                          {taskTracking.workingDays}d × {taskTracking.hoursPerDay}h/day
                          {taskTracking.overtimeHoursPerDay
                            ? ` +${taskTracking.overtimeHoursPerDay}h OT`
                            : ""}
                        </span>
                      ) : null}
                    </div>
                    <div className="stat-card">
                      <span className="stat-card-label">Remaining</span>
                      <span className={`stat-card-value${taskTracking?.limitReached ? " warn" : ""}`}>
                        {remainingLabel}
                      </span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-card-label">Task budget left</span>
                      <span className="stat-card-value">{taskBudgetRemainingLabel}</span>
                      <span className="stat-card-sub">across the whole task, incl. overtime used</span>
                    </div>
                  </div>
                )}

                {taskTracking?.progressPercent != null ? (
                  <div className="page-progress">
                    <div className="page-progress-row">
                      <span>Task progress</span>
                      <span>{Math.round(taskTracking.progressPercent)}%</span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${Math.min(100, Math.max(0, taskTracking.progressPercent))}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                {idleStage > 0 ? (
                  <p className={`page-idle-banner stage-${idleStage}`}>
                    {idleStage >= 3
                      ? "Timer stopped after 15 minutes idle. The idle time was removed from your hours."
                      : idleStage === 2
                        ? "Still no activity — the timer stops in 5 minutes and this idle time will be removed."
                        : "No activity detected — this time won't be counted."}
                  </p>
                ) : null}

                {taskTracking?.limitReached ? (
                  <p className="page-limit-banner">
                    {taskTracking.allowanceMessage || "Maximum allowed work time reached."}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="page-empty page-content-swap">
                <span className="page-empty-title">No task selected</span>
                <p className="page-empty-text">
                  Pick a project and task on the left, then start tracking to see today's stats here.
                </p>
              </div>
            )}

            <span className="version-banner">v{version}</span>
          </section>
        ) : null}
      </div>
    </main>
  );
}

export default function App() {
  useEffect(() => {
    const block = (event: Event) => {
      event.preventDefault();
    };
    const blockKeys = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        key === "f12" ||
        (event.ctrlKey && event.shiftKey && (key === "i" || key === "j" || key === "c")) ||
        (event.ctrlKey && key === "u")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("contextmenu", block);
    document.addEventListener("dragstart", block);
    window.addEventListener("keydown", blockKeys, true);

    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("dragstart", block);
      window.removeEventListener("keydown", blockKeys, true);
    };
  }, []);

  return <MainApp />;
}
