import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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
};

type SessionInfo = {
  id?: string | null;
  status: string;
  taskId?: string | null;
  taskTitle?: string | null;
  activeSeconds?: number;
  idleSeconds?: number;
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
  progressPercent?: number | null;
  workedTodaySeconds?: number | null;
  workedTodayOnTaskSeconds?: number | null;
  allowedRemainingSeconds?: number | null;
  limitReached: boolean;
  allowanceMessage?: string | null;
};

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtHours(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || totalSeconds <= 0) return "0h";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
  onClose,
  onCheckUpdate,
  checkingUpdate,
}: {
  title: string;
  onClose: () => void;
  onCheckUpdate?: () => void;
  checkingUpdate?: boolean;
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
  const [view, setView] = useState<"home" | "settings">("home");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [link, setLink] = useState<LinkStatus | null>(null);
  const [version, setVersion] = useState("0.2.0");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [taskTracking, setTaskTracking] = useState<TaskTimeTracking | null>(null);
  const [liveActiveSeconds, setLiveActiveSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [refreshingData, setRefreshingData] = useState(false);
  const [bars, setBars] = useState<number[]>(() =>
    Array.from({ length: 9 }, () => 20),
  );

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
      setSelectedProjectId((current) =>
        current && next.some((p) => p.id === current) ? current : "",
      );
    } catch {
      setProjects([]);
    }
  }, [signedIn]);

  const refreshTasks = useCallback(async () => {
    if (!signedIn || !selectedProjectId) {
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
  }, [signedIn, selectedProjectId]);

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

  useEffect(() => {
    void invoke<string>("get_version")
      .then(setVersion)
      .catch(() => undefined);
    void refresh()
      .catch(console.error)
      .finally(() => setLoadingProfile(false));

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
  }, [refreshTasks]);

  const refreshTaskTracking = useCallback(async () => {
    if (!selectedTaskId) {
      setTaskTracking(null);
      return;
    }
    try {
      const next = await invoke<TaskTimeTracking | null>("get_task_time_tracking", {
        taskId: selectedTaskId,
      });
      setTaskTracking(next);
    } catch {
      setTaskTracking(null);
    }
  }, [selectedTaskId]);

  useEffect(() => {
    void refreshTaskTracking();
    const timer = window.setInterval(() => void refreshTaskTracking(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshTaskTracking]);

  // Re-sync from the last server snapshot, then tick locally so the clock is
  // smooth between 5s polls instead of jumping.
  useEffect(() => {
    setLiveActiveSeconds(session?.activeSeconds ?? 0);
  }, [session?.activeSeconds]);

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
  const displayName = loadingProfile ? "Loading…" : profile?.name || "Not signed in";
  const firstName =
    signedIn && profile?.name ? profile.name.trim().split(/\s+/)[0] : displayName;
  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  const remainingLabel = !taskTracking
    ? "—"
    : taskTracking.limitReached
      ? "Limit reached"
      : taskTracking.allowedRemainingSeconds == null
        ? "No cap"
        : `${fmtHours(taskTracking.allowedRemainingSeconds)} left`;

  if (view === "settings") {
    return <SettingsPanel onBack={() => setView("home")} />;
  }

  return (
    <main className="agent-tray view-home">
      <TitleBar
        title="Virtual Tracker"
        onClose={() => void invoke("close_window")}
        onCheckUpdate={() => void checkForUpdate()}
        checkingUpdate={checkingUpdate}
      />

      <div className="app-body">
        <aside className="side-panel">
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
                <h1 className="hero-name">{firstName}</h1>
              </div>
              <span className={`pill pill-${loadingProfile ? "idle" : tone}`}>
                {loadingProfile ? "Loading" : statusLabel(link?.status || "", signedIn)}
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
                    ? `Tracking${selectedTask ? ` · ${selectedTask.title}` : ""}`
                    : signedIn
                      ? "Select a task and start when you’re ready"
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
            <nav className="actions side-panel-swap">
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
              <section className="task-card side-panel-swap">
                <label className="task-label" htmlFor="project-select">
                  Project
                </label>
                <Dropdown
                  id="project-select"
                  value={selectedProjectId}
                  options={projects.map((project) => ({ id: project.id, label: project.name }))}
                  placeholder="Select a project"
                  emptyLabel="No projects"
                  disabled={busy || tracking}
                  onChange={setSelectedProjectId}
                />
              </section>

              <section className="task-card side-panel-swap" style={{ animationDelay: "0.03s" }}>
                <label className="task-label" htmlFor="task-select">
                  Your tasks
                </label>
                <Dropdown
                  id="task-select"
                  value={selectedTaskId}
                  options={tasks.map((task) => ({ id: task.id, label: task.title }))}
                  placeholder="Select a task"
                  emptyLabel={!selectedProjectId ? "Select a project first" : "No assigned tasks"}
                  disabled={busy || tracking || !selectedProjectId}
                  onChange={setSelectedTaskId}
                />
              </section>

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

        <section className="page-area">
          <div className="page-header">
            <div className="page-header-titles">
              <span className="page-eyebrow">Today</span>
              <h2 className="page-title">{selectedTask ? selectedTask.title : "Time Tracking"}</h2>
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

          {signedIn && selectedTaskId ? (
            <>
              <div className="page-clock page-content-swap">
                <span className="page-clock-value">{fmtClock(liveActiveSeconds)}</span>
                <span className="page-clock-label">{tracking ? "Elapsed · Tracking" : "Paused"}</span>
              </div>

              <div className="stat-grid page-content-swap" style={{ animationDelay: "0.04s" }}>
                <div className="stat-card">
                  <span className="stat-card-label">Today, this task</span>
                  <span className="stat-card-value">{fmtHours(taskTracking?.workedTodayOnTaskSeconds)}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-card-label">Task total</span>
                  <span className="stat-card-value">
                    {taskTracking?.estimatedSeconds ? fmtHours(taskTracking.estimatedSeconds) : "—"}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-card-label">Remaining</span>
                  <span className={`stat-card-value${taskTracking?.limitReached ? " warn" : ""}`}>
                    {remainingLabel}
                  </span>
                </div>
              </div>

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

              {taskTracking?.limitReached ? (
                <p className="page-limit-banner">
                  {taskTracking.allowanceMessage || "Maximum allowed work time reached."}
                </p>
              ) : null}
            </>
          ) : (
            <div className="page-empty page-content-swap">
              <span className="page-empty-title">{signedIn ? "No task selected" : "Not signed in"}</span>
              <p className="page-empty-text">
                {signedIn
                  ? "Pick a project and task on the left, then start tracking to see today's stats here."
                  : "Sign in on the left to link this PC to your account."}
              </p>
            </div>
          )}

          <span className="version-banner">v{version}</span>
        </section>
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
