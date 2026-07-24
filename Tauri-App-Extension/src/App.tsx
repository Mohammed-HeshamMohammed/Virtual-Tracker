import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type ProfileInfo = {
  signedIn: boolean;
  linkPending?: boolean;
  name: string;
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

type UserPreferences = {
  launchAtLogin: boolean;
  startHidden: boolean;
  autoSignIn: boolean;
};

type AppSettingsView = {
  apiUrl: string;
  webUrl: string;
  authPort: number;
  version: string;
  isProduction: boolean;
  preferences: UserPreferences;
};

type AgentProject = {
  id: string;
  name: string;
};

type AgentTask = {
  id: string;
  title: string;
  status: string;
  projectId?: string;
};

type SessionInfo = {
  id?: string | null;
  status: string;
  taskId?: string | null;
  taskTitle?: string | null;
};

type ActionResult = {
  success: boolean;
  error?: string;
  session?: SessionInfo;
};

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
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <header className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region>
        <img
          className="titlebar-logo-img"
          src="/app-icon.ico"
          width={16}
          height={16}
          alt=""
          draggable={false}
        />
        <span className="titlebar-label" data-tauri-drag-region>
          {title}
        </span>
      </div>
      <div className="titlebar-controls">
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

function SettingsApp() {
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
    <main className="agent-tray settings-window">
      <TitleBar
        title="Settings"
        onClose={() => void invoke("close_settings_window")}
      />
      <div className="content settings-content">
        <section className="settings-card">
          <h3 className="settings-section-label">Connection</h3>
          <div className="settings-row static">
            <span>Dashboard</span>
            <code>{settings?.webUrl || "—"}</code>
          </div>
          <div className="settings-row static">
            <span>API</span>
            <code>{settings?.apiUrl || "—"}</code>
          </div>
          <div className="settings-row static">
            <span>Mode</span>
            <code>{settings?.isProduction ? "Production" : "Development"}</code>
          </div>
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
        </section>

        {message ? <p className="settings-message">{message}</p> : null}

        <p className="settings-version">v{settings?.version || "—"}</p>
      </div>
    </main>
  );
}

function MainApp() {
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [link, setLink] = useState<LinkStatus | null>(null);
  const [version, setVersion] = useState("0.2.0");
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bars, setBars] = useState<number[]>(() =>
    Array.from({ length: 9 }, () => 20),
  );

  const signedIn = Boolean(profile?.signedIn);
  const tracking =
    (session?.status || "").toLowerCase() === "active" ||
    (link?.status || "").toLowerCase().includes("active");

  const refresh = useCallback(async () => {
    const [nextProfile, nextLink, nextSession] = await Promise.all([
      invoke<ProfileInfo>("get_profile"),
      invoke<LinkStatus>("get_link_status"),
      invoke<SessionInfo>("get_session").catch(() => null),
    ]);
    setProfile(nextProfile);
    setLink(nextLink);
    if (nextSession) {
      setSession(nextSession);
      if (nextSession.taskId) {
        setSelectedTaskId(nextSession.taskId);
      }
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!signedIn) {
      setProjects([]);
      return;
    }
    try {
      const next = await invoke<AgentProject[]>("list_projects");
      setProjects(next);
      setSelectedProjectId((current) =>
        current && next.some((p) => p.id === current) ? current : "",
      );
    } catch {
      setProjects([]);
    }
  }, [signedIn]);

  const refreshTasks = useCallback(async () => {
    if (!signedIn) {
      setTasks([]);
      return;
    }
    try {
      const next = await invoke<AgentTask[]>("list_tasks", {
        projectId: selectedProjectId || null,
      });
      setTasks(next);
      setSelectedTaskId((current) => {
        if (current && next.some((t) => t.id === current)) return current;
        return next[0]?.id || "";
      });
    } catch {
      setTasks([]);
    }
  }, [signedIn, selectedProjectId]);

  useEffect(() => {
    void invoke<string>("get_version")
      .then(setVersion)
      .catch(() => undefined);
    void refresh().catch(console.error);

    const onStatus = () => {
      void refresh().catch(console.error);
    };
    window.addEventListener("vt-status", onStatus);
    const timer = window.setInterval(() => {
      void refresh().catch(console.error);
    }, 5000);
    return () => {
      window.removeEventListener("vt-status", onStatus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    void refreshProjects().catch(console.error);
  }, [refreshProjects, signedIn]);

  useEffect(() => {
    void refreshTasks().catch(console.error);
  }, [refreshTasks, signedIn]);

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

  const handleSignIn = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const result = await invoke<SignInResult>("sign_in");
      if (result && result.success === false) {
        setActionError(result.error || "Sign-in failed");
      }
      await refresh();
    } catch {
      setActionError("Sign-in is not ready yet. Reopen the agent and try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleStart = async () => {
    if (!selectedTaskId) {
      setActionError("Select a task to start tracking");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await invoke<ActionResult>("start_task_session", {
        taskId: selectedTaskId,
      });
      if (!result.success) {
        setActionError(result.error || "Could not start session");
      } else if (result.session) {
        setSession(result.session);
      }
      await refresh();
    } catch {
      setActionError("Could not start session");
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
        setActionError(result.error || "Could not stop session");
      } else if (result.session) {
        setSession(result.session);
      }
      await refresh();
    } catch {
      setActionError("Could not stop session");
    } finally {
      setBusy(false);
    }
  };

  const tone = statusTone(link?.status || "", signedIn);
  const displayName = profile?.name || "Not signed in";
  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  return (
    <main className="agent-tray">
      <TitleBar
        title="Virtual Tracker"
        onClose={() => void invoke("close_window")}
      />

      <div className="content home-content">
        <section className="hero-card">
          <div className="hero-top">
            <div className="avatar-wrap">
              {profile?.avatarUrl ? (
                <img
                  className="avatar-img"
                  src={profile.avatarUrl}
                  alt=""
                  draggable={false}
                />
              ) : (
                <div className="avatar-fallback">
                  {signedIn ? initialsFromName(displayName) : "VT"}
                </div>
              )}
            </div>
            <div className="hero-copy">
              <span className="hero-kicker">Desktop Agent</span>
              <h1 className="hero-name">{displayName}</h1>
            </div>
            <span className={`pill pill-${tone}`}>{statusLabel(link?.status || "", signedIn)}</span>
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
              {tracking
                ? `Tracking${selectedTask ? ` · ${selectedTask.title}` : ""}`
                : signedIn
                  ? "Select a task and start when you’re ready"
                  : "Sign in to link this PC to your account"}
            </p>
          </div>
        </section>

        {!signedIn ? (
          <nav className="actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy}
              onClick={() => void handleSignIn()}
            >
              {profile?.linkPending ? "Open link page" : "Sign in"}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => void invoke("open_web_app")}
            >
              Open dashboard
            </button>
          </nav>
        ) : (
          <>
            {projects.length > 0 ? (
              <section className="task-card">
                <label className="task-label" htmlFor="project-select">
                  Project
                </label>
                <select
                  id="project-select"
                  className="task-select"
                  value={selectedProjectId}
                  disabled={busy || tracking}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                  <option value="">All projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </section>
            ) : null}

            <section className="task-card">
              <label className="task-label" htmlFor="task-select">
                Your tasks
              </label>
              <select
                id="task-select"
                className="task-select"
                value={selectedTaskId}
                disabled={busy || tracking || tasks.length === 0}
                onChange={(e) => setSelectedTaskId(e.target.value)}
              >
                {tasks.length === 0 ? (
                  <option value="">No assigned tasks</option>
                ) : (
                  tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))
                )}
              </select>
            </section>

            <nav className="actions">
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
                  disabled={busy || !selectedTaskId}
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

        {actionError ? <p className="inline-error">{actionError}</p> : null}
      </div>

      <footer className="footer">
        <div className="footer-tools">
          <button
            className="footer-icon"
            type="button"
            title="Settings"
            aria-label="Settings"
            onClick={() => void invoke("open_settings_window")}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.484.484 0 0 0 14.06 2h-3.88c-.24 0-.45.17-.49.41l-.36 2.54a7.03 7.03 0 0 0-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.39 1.04.71 1.62.94l.36 2.54c.05.24.25.41.49.41h3.88c.24 0 .44-.17.49-.41l.36-2.54c.58-.23 1.12-.55 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
              />
            </svg>
          </button>
        </div>
        <span className="footer-version">v{version}</span>
      </footer>
    </main>
  );
}

export default function App() {
  const [label, setLabel] = useState<string | null>(null);

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

    void invoke<string>("window_label")
      .then(setLabel)
      .catch(() => setLabel("main"));

    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("dragstart", block);
      window.removeEventListener("keydown", blockKeys, true);
    };
  }, []);

  if (!label) {
    return <main className="agent-tray boot" />;
  }
  return label === "settings" ? <SettingsApp /> : <MainApp />;
}
