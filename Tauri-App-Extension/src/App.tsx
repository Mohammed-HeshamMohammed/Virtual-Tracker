import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";
import { toast } from "./Toast";

import type {
  ActionResult,
  AgentTask,
  AuthView,
  ConnectionState,
  ForgotState,
  LinkStatus,
  MemberLimits,
  MemberProfile,
  MonitoringNoticeView,
  ProfileInfo,
  ProjectInfo,
  ReconnectResult,
  SessionInfo,
  SignInResult,
  SignUpFields,
  SignUpState,
  TaskTimeTracking,
} from "./types";
import {
  fmtClock,
  fmtHours,
  fmtLimitHours,
  initialsFromName,
  statusLabel,
  statusTone,
} from "./utils/formatters";
import { TitleBar } from "./components/common/TitleBar";
import { Dropdown } from "./components/common/Dropdown";
import { SettingsPanel } from "./components/views/SettingsPanel";
import { ProfilePanel } from "./components/views/ProfilePanel";
import { WelcomeBackPanel } from "./components/views/WelcomeBackPanel";
import { MonitoringNoticePanel } from "./components/views/MonitoringNoticePanel";
import { SignInPanel } from "./components/views/SignInPanel";

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
    setSignUp((s) => ({ ...s, [field]: value, error: null, success: null }));
  };

  // Native sign-up through Auth-Backend POST /api/auth/register-agent-user.
  // Validation runs here first so obvious mismatches fail immediately without
  // a network round-trip; error messages match the web auth page.
  const handleSignUp = async () => {
    if (signUp.busy) return;
    if (signUp.password !== signUp.confirmPassword) {
      setSignUp((s) => ({ ...s, error: "Passwords do not match" }));
      return;
    }
    setSignUp((s) => ({ ...s, busy: true, error: null, success: null }));
    try {
      const result = await invoke<SignInResult>("sign_up_with_password", {
        firstName: signUp.firstName,
        lastName: signUp.lastName,
        phone: signUp.phone,
        email: signUp.email,
        password: signUp.password,
      });
      if (result.success) {
        toast.success("Account created — signed in");
        setSignUp((s) => ({
          ...s,
          busy: false,
          firstName: "",
          lastName: "",
          phone: "",
          email: "",
          password: "",
          confirmPassword: "",
        }));
        await refresh();
        await refreshProjects();
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

  // Native password-reset email via Auth-Backend POST /api/auth/forgot-password.
  // Generic error text on missing accounts is enforced server-side inside
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

  // CF-2: required disclosure notice blocks all tracker interactions until
  // acknowledged. Takes priority over stale-session recovery (a user whose
  // token aged out will reach WelcomeBackPanel immediately after accepting, or
  // be sent to re-auth when acknowledge 401s).
  if (signedIn && monitoringNotice?.requiresAcknowledgement) {
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
        onForgotEmailChange={(email) => setForgot((f) => ({ ...f, email }))}
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
                className={`pill pill-${
                  loadingProfile ? "idle" : connection === "disconnected" ? "warn" : tone
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
