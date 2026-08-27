import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";
import { toast } from "./Toast";

import type {
  AppSettingsView,
  ThemePreference,
  ActionResult,
  AgentTask,
  AuthView,
  ConnectionState,
  DashboardSummary,
  ForgotState,
  LinkStatus,
  MemberLimits,
  MemberProfile,
  MonitoringNoticeView,
  ProfileInfo,
  ProjectBudgetStatus,
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
  taskStatusLabel,
  taskStatusTone,
} from "./utils/formatters";
import { TitleBar } from "./components/common/TitleBar";
import { Icon } from "./components/common/Icon";
import { applyTheme } from "./utils/theme";
import { SettingsPanel } from "./components/views/SettingsPanel";
import { ProfilePanel } from "./components/views/ProfilePanel";
import { WelcomeBackPanel } from "./components/views/WelcomeBackPanel";
import { MonitoringNoticePanel } from "./components/views/MonitoringNoticePanel";
import { SignInPanel } from "./components/views/SignInPanel";

// ponytail: hand-rolled rAF countdown, ~15 lines. Dashboard-Web has
// @number-flow/react for this, but it is not a dependency of the agent and
// one animation does not justify adding it.
//
// Eases "Today, all work" from its pre-correction value down to the
// server's post-idle-stop value instead of snapping in one frame, so the
// idle rewind reads as a correction rather than lost data.
function animateWorkedTodayRewind(
  from: number,
  to: number,
  setValue: (updater: (seconds: number) => number) => void
) {
  const duration = 700;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    setValue(() => Math.round(from - (from - to) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Shared shape for refreshTaskTracking/refreshMemberLimits/
// refreshProjectBudget below: call `fn` immediately, then every
// `intervalMs`, guarded so a slow/stalled backend can't stack up queued
// calls (same reasoning refreshGuarded's own comment gives - a 30s stall
// used to enqueue roughly two dozen). `refreshGuarded` itself stays outside
// this hook: it also reacts to focus/visibility/vt-status, not just a
// timer, so folding it in would mean bolting those back on as special
// cases for one caller instead of simplifying anything.
function usePolling(enabled: boolean, intervalMs: number, fn: () => Promise<void>) {
  const inFlight = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const run = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await fn();
      } finally {
        inFlight.current = false;
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, fn]);
}

function MainApp() {
  const [view, setView] = useState<"home" | "settings" | "profile">("home");
  const [signingOut, setSigningOut] = useState(false);
  const [memberLimits, setMemberLimits] = useState<MemberLimits | null>(null);
  const [projectBudget, setProjectBudget] = useState<ProjectBudgetStatus | null>(null);
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
  // Every open task assigned to the member, across every project - not
  // scoped to whichever project happens to be picked (that's `tasks`
  // above, which only exists to feed the task dropdown). This is the
  // sidebar's own "what else is on my plate" view.
  const [assignedTasks, setAssignedTasks] = useState<AgentTask[]>([]);
  // The web dashboard's own "Weekly trends" + "Recent projects" widgets,
  // reused rather than reinvented - null on an older backend without the
  // route yet, in which case those two sidebar cards just don't render.
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [stopNoteOpen, setStopNoteOpen] = useState(false);
  const [stopNoteDraft, setStopNoteDraft] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [paused, setPaused] = useState(false);
  const [taskTracking, setTaskTracking] = useState<TaskTimeTracking | null>(null);
  const [liveActiveSeconds, setLiveActiveSeconds] = useState(0);
  const [liveWorkedTodaySeconds, setLiveWorkedTodaySeconds] = useState(0);
  // Main clock view: "day" is the current session's elapsed time (resets
  // with each new session/day); "task" is the task's cumulative total across
  // every day it's been worked, so a shift crossing midnight still reads as
  // one continuous duration instead of resetting at 12am.
  const [timerViewMode, setTimerViewMode] = useState<"day" | "task">("day");
  const [liveTaskActiveSeconds, setLiveTaskActiveSeconds] = useState(0);
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
  // Mirrors the stored preference so the title-bar control and the Settings
  // picker never disagree. main.tsx already painted the class before first
  // render; this only tracks it for the UI.
  const [themePref, setThemePref] = useState<ThemePreference>("system");

  useEffect(() => {
    setAvatarError(false);
  }, [profile?.avatarUrl]);

  // manual=true only for the TitleBar button click - the automatic check on
  // mount (below) must stay silent either way, or a flaky update server would
  // toast an error on every single app launch.
  const checkForUpdate = useCallback(async (manual = false) => {
    setCheckingUpdate(true);
    try {
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
        await relaunch();
      } else if (manual) {
        toast.message("You're up to date");
      }
    } catch (err) {
      console.error("update check failed", err);
      if (manual) {
        toast.error("Couldn't check for updates. Try again later.");
      }
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
  // A paused session reports status "idle" server-side (see handlePause), so
  // `tracking` alone can't tell "on a break" apart from "no session at all" -
  // this keeps the session's own UI (dropdowns, Start vs Pause/Resume) aware
  // one is still open without letting active-time effects that key off
  // `tracking` keep crediting active seconds through the break.
  const sessionOpen = tracking || paused;

  const refresh = useCallback(async () => {
    const [nextProfile, nextLink, nextSession, nextConnection, nextNotice, nextPaused] = await Promise.all([
      invoke<ProfileInfo>("get_profile"),
      invoke<LinkStatus>("get_link_status"),
      invoke<SessionInfo>("get_session").catch(() => null),
      invoke<ConnectionState>("get_connection_state").catch<ConnectionState>(() => "connected"),
      // CF-2: same poll cadence as everything else here, so a capability
      // change server-side (which bumps the notice version) surfaces within
      // one cycle. A failed fetch leaves the previous value in place rather
      // than clearing it - a network blip must not be read as "acknowledged".
      invoke<MonitoringNoticeView | null>("get_monitoring_notice").catch(() => undefined),
      invoke<boolean>("is_session_paused").catch(() => false),
    ]);
    setProfile(nextProfile);
    setLink(nextLink);
    setConnection(nextConnection);
    setPaused(nextPaused);
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

  const refreshAssignedTasks = useCallback(async () => {
    if (!signedIn) {
      setAssignedTasks([]);
      return;
    }
    try {
      const next = await invoke<AgentTask[]>("list_tasks", { projectId: null });
      setAssignedTasks(next);
    } catch {
      setAssignedTasks([]);
    }
  }, [signedIn]);

  // Same 60s cache window the web dashboard itself uses for this payload
  // (general-dashboard-api.ts) - no point polling it any faster than the
  // source ever actually changes.
  const refreshDashboardSummary = useCallback(async () => {
    if (!signedIn) {
      setDashboardSummary(null);
      return;
    }
    try {
      const next = await invoke<DashboardSummary | null>("get_dashboard_summary");
      setDashboardSummary(next);
    } catch {
      setDashboardSummary(null);
    }
  }, [signedIn]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  // "This project has no task list", not "this project is type X" - the
  // server decides which types those are, so a new one needs no agent change.
  const isCallingProject = selectedProject ? selectedProject.hasTasks === false : false;
  // Normal projects require a task before tracking unless a manager turned
  // that off for this specific project. Calling projects never require one.
  const taskRequired = !isCallingProject && selectedProject?.requireTaskToTrack !== false;
  // "This session has no task in play" - always true for calling projects,
  // and true for a task-optional normal project until a task is picked. Every
  // task-anchored limit, stat and label below keys off this rather than the
  // project type, since none of them have a task to work with either way.
  const taskLessSession = isCallingProject || (!taskRequired && !selectedTaskId);

  const refreshTasks = useCallback(async () => {
    if (!signedIn || !selectedProjectId || isCallingProject) {
      setTasks([]);
      setSelectedTaskId("");
      return;
    }
    try {
      const rawTasks = await invoke<AgentTask[]>("list_tasks", {
        projectId: selectedProjectId,
      });

      // No per-task limit pre-check here anymore - that used to fire one
      // get_task_time_tracking call per task just to hide over-budget ones
      // from the picker (N+1 network round-trips on every project switch).
      // The actual gate already lives downstream: refreshTaskTracking polls
      // the *selected* task's tracking every 5s, and handleStart / the Start
      // button both already refuse an over-limit task using that same data
      // (see taskTracking?.limitReached below). Showing the task here and
      // explaining why it can't start is more honest than silently hiding it.
      setTasks(rawTasks);
      setSelectedTaskId((current) => {
        if (current && rawTasks.some((t) => t.id === current)) return current;
        return rawTasks[0]?.id || "";
      });
    } catch {
      setTasks([]);
      setSelectedTaskId("");
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
      toast.error("Couldn't refresh — check your connection.");
    } finally {
      setRefreshingData(false);
    }
  };

  // Guarded by an in-flight ref (usePolling handles this for the three
  // pollers below; refreshGuarded needs its own since it also fires from
  // focus/visibility/vt-status, not just its own timer). Without it, a slow
  // or stalled backend (sleep, fullscreen game, dead network) lets each 5s
  // tick queue another invocation that all fire at once on unblock - a 30s
  // stall used to enqueue roughly two dozen.
  const refreshInFlight = useRef(false);

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
    // Rust-side warnings the user should actually notice (e.g. the OS
    // credential store rejected a sign-in token, so it won't survive a
    // restart) - see AgentController::on_warning / lib.rs's vt-warning wiring.
    const onWarning = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail === "string" && detail) {
        toast.warning(detail);
      }
    };
    window.addEventListener("vt-status", onStatus);
    window.addEventListener("vt-warning", onWarning);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    const timer = window.setInterval(() => {
      void refreshGuarded().catch(console.error);
    }, 5000);
    return () => {
      window.removeEventListener("vt-status", onStatus);
      window.removeEventListener("vt-warning", onWarning);
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
    try {
      const next = await invoke<TaskTimeTracking | null>("get_task_time_tracking", {
        taskId: selectedTaskId,
      });
      setTaskTracking(next);
    } catch {
      setTaskTracking(null);
    }
  }, [selectedTaskId]);

  usePolling(true, 5000, refreshTaskTracking);

  // The personal daily/weekly cap, which is the *only* thing that limits a
  // calling-project timer. Polled on the home view too (not just the profile
  // view, as before) because "Remaining today" has to keep counting down
  // while the clock runs.
  const refreshMemberLimits = useCallback(async () => {
    if (!signedIn) return;
    try {
      setMemberLimits(await invoke<MemberLimits>("get_member_limits"));
    } catch {
      setMemberLimits(null);
    }
  }, [signedIn]);

  usePolling(view === "home" || view === "profile", 5000, refreshMemberLimits);

  // A project's own Hours-based budget (Budget tab, scope per-person or
  // shared) - independent of, and stacks with, a task's own estimate. Both
  // project types can carry one (a calling project has no task estimate at
  // all, so this may be its only cap besides the member's personal one).
  const refreshProjectBudget = useCallback(async () => {
    if (!signedIn || !selectedProjectId) {
      setProjectBudget(null);
      return;
    }
    try {
      setProjectBudget(
        await invoke<ProjectBudgetStatus | null>("get_project_budget_status", {
          projectId: selectedProjectId,
        }),
      );
    } catch {
      setProjectBudget(null);
    }
  }, [signedIn, selectedProjectId]);

  usePolling(view === "home" || view === "profile", 5000, refreshProjectBudget);

  // Projects used to be fetched only on sign-in and manual refresh, so a
  // manager toggling this project's settings (require a task to track,
  // require a stop note) wouldn't reach an already-open tracker until the
  // member restarted it - the timer would keep enforcing the old rules.
  // Slower than the 5s polls above because these settings change rarely and
  // this refetches the whole list.
  usePolling(view === "home" || view === "profile", 30000, refreshProjects);
  usePolling(view === "home" || view === "profile", 30000, refreshAssignedTasks);
  usePolling(view === "home" || view === "profile", 60000, refreshDashboardSummary);

  // P10 (PLAN-livesyncandagenttimer.md, case 45/46b) - the 5s polls above stay
  // as the fallback for whenever the live-sync WebSocket (Rust side:
  // agent/live_sync.rs) is down; this just shrinks the gap to sub-second when
  // it's up. Only task-assignments/tasks changes and scope changes matter
  // here - a manager assigning a new task, logging time from another device,
  // or reaching a limit are exactly the events "Assigned today" and the
  // running task-limit timer need to react to without waiting on the poll.
  useEffect(() => {
    const onLiveChanged = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      const frame = detail as { type?: unknown; resource?: unknown };
      const isRelevantChange =
        frame.type === "changed" && (frame.resource === "task-assignments" || frame.resource === "tasks");
      const isScopeChanged = frame.type === "scope-changed";
      if (!isRelevantChange && !isScopeChanged) return;
      void refreshTaskTracking();
      void refreshMemberLimits();
      void refreshProjectBudget();
      void refreshAssignedTasks();
    };
    window.addEventListener("vt-live-changed", onLiveChanged);
    return () => window.removeEventListener("vt-live-changed", onLiveChanged);
  }, [refreshTaskTracking, refreshMemberLimits, refreshProjectBudget, refreshAssignedTasks]);

  // The People-page member record never changes while the app is open - one
  // fetch per sign-in, no polling. Used to wait for the profile view to open,
  // but the footer identity card now shows the same email and role, so it
  // needs the record as soon as the sidebar itself is on screen.
  useEffect(() => {
    if (!signedIn) return;
    invoke<MemberProfile>("get_member_profile")
      .then(setMemberProfile)
      .catch(() => setMemberProfile(null));
  }, [signedIn]);

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

  // Same reconcile-then-tick pattern, applied to the task's cumulative total
  // (taskTracking.activeSeconds already spans every day the task's been
  // worked - see fetch_task_time_tracking - so no backend change needed).
  useEffect(() => {
    const next = taskTracking?.activeSeconds ?? 0;
    setLiveTaskActiveSeconds((s) => (tracking ? Math.max(s, next) : next));
  }, [taskTracking?.activeSeconds, tracking]);

  useEffect(() => {
    if (!tracking) return;
    const timer = window.setInterval(() => setLiveTaskActiveSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [tracking]);

  // A task-less session has no task-level total to switch to.
  useEffect(() => {
    if (taskLessSession) setTimerViewMode("day");
  }, [taskLessSession]);

  // Same reconcile-then-tick pattern as liveActiveSeconds above, applied to
  // "Today, all work" - it previously only ever showed the raw 5s-polled
  // memberLimits value, so it sat still for up to 20s (the server's own sync
  // interval) while the task clock beside it moved every second.
  //
  // idleRewindFromRef captures the on-screen value the instant idle escalates
  // to stage 3 (stopped). The next poll's lower workedTodaySeconds is then
  // animated down to instead of snapped to, so the correction reads as a
  // rewind rather than data loss - see animateWorkedTodayRewind above.
  const idleRewindFromRef = useRef<number | null>(null);
  useEffect(() => {
    const next = memberLimits?.workedTodaySeconds ?? 0;
    const rewindFrom = idleRewindFromRef.current;
    if (rewindFrom != null && !tracking) {
      idleRewindFromRef.current = null;
      if (next < rewindFrom) {
        animateWorkedTodayRewind(rewindFrom, next, setLiveWorkedTodaySeconds);
        return;
      }
    }
    setLiveWorkedTodaySeconds((s) => (tracking ? Math.max(s, next) : next));
  }, [memberLimits?.workedTodaySeconds, tracking]);

  useEffect(() => {
    // Only while actively working: ticking through an idle period would run
    // ahead of the backend's idle-time subtraction and produce a visible
    // rewind once the poll catches up (see the idle-stage banner below).
    if (!tracking || (session?.idleStage ?? 0) !== 0) return;
    const timer = window.setInterval(() => setLiveWorkedTodaySeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [tracking, session?.idleStage]);

  // Idle-stage toasts, fired once per transition into a higher stage - the
  // in-page banner (below, in the render body) already explains the current
  // stage, but a toast is what actually gets noticed since the agent mostly
  // runs in the tray. Stage 3 (stopped) is announced by the banner text and
  // by the rewind animation above; no extra toast needed there.
  const prevIdleStageRef = useRef(0);
  useEffect(() => {
    const stage = session?.idleStage ?? 0;
    const prevStage = prevIdleStageRef.current;
    if (stage === 1 && prevStage < 1) {
      toast.warning("You look idle — the timer will stop in 10 minutes if there's no activity.");
    } else if (stage === 2 && prevStage < 2) {
      toast.warning("Still idle — the timer stops in 5 minutes and this idle time will be removed.");
    } else if (stage === 3 && prevStage < 3) {
      idleRewindFromRef.current = liveWorkedTodaySeconds;
    }
    prevIdleStageRef.current = stage;
    // liveWorkedTodaySeconds is read at the moment of the transition only -
    // it must not retrigger this effect on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.idleStage]);

  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  useEffect(() => {
    void invoke<AppSettingsView>("get_app_settings")
      .then((s) => {
        if (s?.preferences?.theme) setThemePref(s.preferences.theme);
      })
      .catch(() => {
        /* Falls back to "system", which is also the stored default. */
      });
  }, []);

  const handleCycleTheme = useCallback((next: ThemePreference) => {
    // Painted first, persisted after - waiting on the round trip makes the
    // control feel broken.
    applyTheme(next);
    setThemePref(next);
    void invoke<AppSettingsView>("get_app_settings")
      .then((s) =>
        invoke("save_preferences", { preferences: { ...s.preferences, theme: next } }),
      )
      .catch(() => toast.error("Could not save your theme preference."));
  }, []);

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
    if (taskLessSession) {
      await startProjectSession();
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
  // Task-less start. Not calling-specific: start_project_session runs the
  // timer against the project itself, which is also what a task-optional
  // normal project needs when no task is picked.
  const startProjectSession = async () => {
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

  const handleStop = async (stopNote?: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await invoke<ActionResult>("stop_session", { stopNote: stopNote ?? null });
      if (!result.success) {
        const msg = result.error || "Could not stop session";
        setActionError(msg);
        toast.error(msg);
        // Deliberately leaves the prompt open with the draft intact - the
        // timer is still running, and discarding what they typed would mean
        // retyping it just to retry.
        return;
      }
      if (result.session) {
        setSession(result.session);
        toast.message("Tracking session paused");
      }
      setPaused(false);
      setStopNoteOpen(false);
      setStopNoteDraft("");
      await refresh();
    } catch {
      const msg = "Could not stop session";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  // The Stop button when the project asks for a note: opens the prompt
  // instead of stopping straight away. Automatic stops (idle rewind, limit
  // reached) deliberately bypass this - nobody is there to type anything, and
  // blocking on a dialog would leave the timer running.
  const handleStopClick = () => {
    if (selectedProject?.requireStopNote && tracking) {
      setStopNoteDraft("");
      setStopNoteOpen(true);
      return;
    }
    void handleStop();
  };

  // Break, not stop - the backend keeps the session's accumulated totals
  // (mirrors handleStop's "idle" action but never resets/re-baselines them),
  // and the tracker only credits idle time locally until handleResume.
  const handlePause = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await invoke<ActionResult>("pause_session");
      if (!result.success) {
        const msg = result.error || "Could not pause session";
        setActionError(msg);
        toast.error(msg);
      } else {
        setPaused(true);
        toast.message("On a break — time is now counting as idle");
      }
      await refresh();
    } catch {
      const msg = "Could not pause session";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await invoke<ActionResult>("resume_session");
      if (!result.success) {
        const msg = result.error || "Could not resume session";
        setActionError(msg);
        toast.error(msg);
      } else {
        setPaused(false);
        toast.success("Back to tracking");
      }
      await refresh();
    } catch {
      const msg = "Could not resume session";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  // T4 - the timer never stopped itself once a task's own limit was reached;
  // limitReached/allowedRemainingSeconds only ever gated *starting* a new
  // session (the task-list filter above and the disabled start button
  // below). P6 and P7 close that gap from two directions and share one guard
  // since both can notice the crossing close together - only one should
  // actually call handleStop.
  const limitStopTriggeredRef = useRef(false);
  useEffect(() => {
    if (!tracking) limitStopTriggeredRef.current = false;
  }, [tracking]);

  const stopForTaskLimit = (message?: string | null) => {
    if (limitStopTriggeredRef.current || !tracking) return;
    limitStopTriggeredRef.current = true;
    toast.warning(message || "Task limit reached — timer stopped. Your time is saved.");
    void handleStop();
  };

  // P7 - server-confirmed stop. Catches time logged against the same task
  // from another device or an admin adjustment - anything the local estimate
  // below can't see coming - the next time the 5s poll reports limitReached.
  useEffect(() => {
    if (!tracking || taskLessSession) return;
    if (taskTracking?.limitReached) {
      stopForTaskLimit(taskTracking.allowanceMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, taskLessSession, taskTracking?.limitReached, taskTracking?.allowanceMessage]);

  // P6 - local, to-the-second stop. allowedRemainingSeconds is known as of
  // the last poll; ticking it down locally between polls stops the timer at
  // the true limit instant ("once I finish 10 mins the timer stops") instead
  // of up to 5s late waiting for the next server confirmation.
  const localTaskRemainingRef = useRef<number | null>(null);
  useEffect(() => {
    localTaskRemainingRef.current =
      tracking && !taskLessSession ? taskTracking?.allowedRemainingSeconds ?? null : null;
  }, [taskTracking?.allowedRemainingSeconds, tracking, taskLessSession]);

  useEffect(() => {
    if (!tracking || taskLessSession) return;
    const timer = window.setInterval(() => {
      if (localTaskRemainingRef.current == null) return;
      localTaskRemainingRef.current -= 1;
      if (localTaskRemainingRef.current <= 0) {
        localTaskRemainingRef.current = null;
        stopForTaskLimit(null);
      }
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, taskLessSession]);

  // Task-less counterpart to P6/P7 above, for the project's own
  // per-person budget specifically. Task sessions don't need this
  // duplicated - computeTimerAllowance on the backend already folds the same
  // per-person budget into taskTracking.allowedRemainingSeconds, so the
  // task-scoped P6/P7 above already stops those on time.
  const localProjectBudgetRemainingRef = useRef<number | null>(null);
  useEffect(() => {
    localProjectBudgetRemainingRef.current =
      tracking && taskLessSession && projectBudget ? projectBudget.remainingSeconds : null;
  }, [projectBudget, tracking, taskLessSession]);

  useEffect(() => {
    if (!tracking || !taskLessSession) return;
    if (projectBudget && projectBudget.remainingSeconds <= 0) {
      stopForTaskLimit("This project's budget has been reached — timer stopped. Your time is saved.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, taskLessSession, projectBudget?.remainingSeconds]);

  useEffect(() => {
    if (!tracking || !taskLessSession) return;
    const timer = window.setInterval(() => {
      if (localProjectBudgetRemainingRef.current == null) return;
      localProjectBudgetRemainingRef.current -= 1;
      if (localProjectBudgetRemainingRef.current <= 0) {
        localProjectBudgetRemainingRef.current = null;
        stopForTaskLimit("This project's budget has been reached — timer stopped. Your time is saved.");
      }
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, taskLessSession]);

  const idleStage = session?.idleStage ?? 0;
  const displayName = loadingProfile ? "Loading…" : profile?.name || "Not signed in";
  // Full identity for the footer card - memberProfile (the People-page
  // record) is the richer source once it loads, profile (JWT claims) is
  // what's available immediately. Same fallback ProfilePanel already uses.
  const footerName = memberProfile?.name || displayName;
  const footerEmail = memberProfile?.email || profile?.email || "";
  const footerRole = memberProfile?.role || "";
  const selectedTask = tasks.find((t) => t.id === selectedTaskId);
  // A task-less session has no task title to show, so the project names the run.
  const trackingLabel = taskLessSession
    ? selectedProject?.name ?? ""
    : selectedTask?.title ?? "";

  // For the sidebar's cross-project task list - it only has a projectId per
  // row, never a project name of its own.
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  // Jumping to a task from that list re-picks its project first (a task from
  // a project that's gone missing client-side is simply not clickable), the
  // same two-step a person would do by hand with the dropdowns above.
  const jumpToAssignedTask = (task: AgentTask) => {
    if (busy || sessionOpen) return;
    if (task.projectId && task.projectId !== selectedProjectId) {
      setSelectedProjectId(task.projectId);
    }
    setSelectedTaskId(task.id);
  };

  // How many of the member's open tasks live in each project - lets the
  // project quick-switch below say "3 open" instead of just naming it.
  const openTaskCountByProject = new Map<string, number>();
  for (const task of assignedTasks) {
    if (!task.projectId) continue;
    openTaskCountByProject.set(task.projectId, (openTaskCountByProject.get(task.projectId) ?? 0) + 1);
  }
  const jumpToProject = (projectId: string) => {
    if (busy || sessionOpen || projectId === selectedProjectId) return;
    setSelectedProjectId(projectId);
  };
  // Same "Recent projects" progress the web dashboard's general view shows
  // for this member - keyed by id so the quick-switch list below can show
  // it next to a project without re-deriving it from anything client-side.
  const projectProgressById = new Map(
    (dashboardSummary?.recentProjects ?? []).map((p) => [p.id, p.progress]),
  );

  // The member's own daily cap, as a ceiling the day panel measures against
  // rather than a tile of its own - a static config value was being given the
  // same weight as "can I keep working".
  const dailyCapSeconds =
    memberLimits && !memberLimits.usesShifts && memberLimits.dailyHours > 0
      ? Math.floor(memberLimits.dailyHours * 3600)
      : 0;
  const dailyCapLabel = !memberLimits
    ? "—"
    : memberLimits.usesShifts
      ? "By shifts"
      : memberLimits.dailyHours > 0
        ? fmtLimitHours(memberLimits.dailyHours)
        : memberLimits.weeklyHours > 0
          ? `${fmtLimitHours(memberLimits.weeklyHours)}/wk`
          : "No hour limit";
  // What the day panel says opposite the headline when there is no wall-clock
  // projection to show (not tracking, no cap, or the cap already spent).
  const dailyCapLeftLabel = !memberLimits
    ? "—"
    : memberLimits.usesShifts || memberLimits.allowedRemainingSeconds == null
      ? "No cap"
      : memberLimits.limitReached
        ? "Limit reached"
        : fmtHours(memberLimits.allowedRemainingSeconds);
  const workedTodayLabel = memberLimits ? fmtHours(liveWorkedTodaySeconds) : "—";
  const dayUsedPercent =
    dailyCapSeconds > 0 ? Math.min(100, (liveWorkedTodaySeconds / dailyCapSeconds) * 100) : 0;
  const dayOverPercent =
    dailyCapSeconds > 0
      ? Math.min(100 - dayUsedPercent, (Math.max(0, liveWorkedTodaySeconds - dailyCapSeconds) / dailyCapSeconds) * 100)
      : 0;
  // Not a working day, or one only worked because of a flagged makeup day -
  // both already arrive on every poll and were never shown anywhere.
  const dayHint = !memberLimits
    ? ""
    : memberLimits.isMakeupDay
      ? "makeup day"
      : memberLimits.workingToday
        ? ""
        : "not a working day";

  // The measure the dashboard actually grades on (active / active+idle), which
  // the agent never showed - so the number someone is judged by was only
  // visible by opening the web app. Idle time is what the 5/10/15-minute
  // banners below warn about while it accrues; this is the running total.
  const activityToday = memberLimits?.todayActivity;
  const activityTrackedSeconds = activityToday
    ? activityToday.activeSeconds + activityToday.idleSeconds
    : 0;
  const activityPercent =
    activityTrackedSeconds > 0
      ? Math.round((activityToday!.activeSeconds / activityTrackedSeconds) * 100)
      : null;
  const activityLabel = activityPercent == null ? "—" : `${activityPercent}%`;
  // Ring geometry: r=26 in a 60x60 box, so the arc length is 2*pi*26.
  const ACTIVITY_RING_CIRCUMFERENCE = 2 * Math.PI * 26;
  const activityDash =
    activityPercent == null ? 0 : (activityPercent / 100) * ACTIVITY_RING_CIRCUMFERENCE;

  // The week's activity ring - same percentage as the web dashboard's own
  // "Weekly trends" widget, drawn with the exact ring math above so the
  // sidebar's two rings read as one family instead of two different charts.
  const weekActivityDash = dashboardSummary
    ? (dashboardSummary.activityWeekPercent / 100) * ACTIVITY_RING_CIRCUMFERENCE
    : 0;
  const weekActiveSeconds = (dashboardSummary?.weeklyActivity ?? []).reduce(
    (sum, day) => sum + day.activeHours * 3600,
    0,
  );
  const weekIdleSeconds = (dashboardSummary?.weeklyActivity ?? []).reduce(
    (sum, day) => sum + day.idleHours * 3600,
    0,
  );

  // Weekly cap holders were flying blind: weeklyHours only ever appeared as a
  // fallback label on the Daily cap card when no daily cap existed, so there
  // was no way to see where the week stood until it ran out.
  const weeklyCapSeconds =
    memberLimits && !memberLimits.usesShifts && memberLimits.weeklyHours > 0
      ? Math.floor(memberLimits.weeklyHours * 3600)
      : 0;
  const weekWorkedLabel = memberLimits ? fmtHours(memberLimits.workedWeekSeconds) : "—";
  const weekUsedPercent =
    weeklyCapSeconds > 0 && memberLimits
      ? Math.min(100, (memberLimits.workedWeekSeconds / weeklyCapSeconds) * 100)
      : 0;
  const weekOfLabel = weeklyCapSeconds > 0 && memberLimits ? `of ${fmtLimitHours(memberLimits.weeklyHours)}` : "";
  const weekFootLabel = !memberLimits
    ? ""
    : memberLimits.usesShifts
      ? "shift-based — no weekly cap"
      : weeklyCapSeconds > 0
        ? `${fmtHours(Math.max(0, weeklyCapSeconds - memberLimits.workedWeekSeconds))} left`
        : "no weekly cap";

  // "2h 15m left" makes you do the arithmetic; a wall-clock time doesn't.
  // Only meaningful while the timer is actually running toward the cap.
  const projectedCapTimeLabel = (() => {
    if (!memberLimits || memberLimits.usesShifts) return "";
    const remaining = memberLimits.allowedRemainingSeconds;
    if (remaining == null || remaining <= 0 || !tracking) return "";
    const at = new Date(Date.now() + remaining * 1000);
    return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  })();

  // T5 - "how much work is assigned to me today" (demandSeconds, including
  // rollover from earlier days), a different question from the cap above
  // ("how much am I still allowed to work"). Both matter; this is the one
  // that answers "1h task + 3h calling project = 4h before I select
  // anything."
  const assignedTodayLabel = !memberLimits
    ? "—"
    : fmtHours(memberLimits.assignedToday.demandSeconds);
  const assignedDemandSeconds = Math.max(1, memberLimits?.assignedToday.demandSeconds ?? 1);
  const assignedPlannedPercent = memberLimits
    ? Math.min(100, (memberLimits.assignedToday.plannedSeconds / assignedDemandSeconds) * 100)
    : 0;
  const assignedDeferredPercent = memberLimits
    ? Math.min(100 - assignedPlannedPercent, (memberLimits.assignedToday.deferredSeconds / assignedDemandSeconds) * 100)
    : 0;
  const assignedCarriedLabel =
    memberLimits && memberLimits.assignedToday.rolloverSeconds > 0
      ? `incl. ${fmtHours(memberLimits.assignedToday.rolloverSeconds)} carried`
      : "";
  const assignedTaskCountLabel = !memberLimits
    ? ""
    : memberLimits.assignedToday.taskCount === 1
      ? "1 task"
      : `${memberLimits.assignedToday.taskCount} tasks`;
  // byProjectType arrives on every poll and had no home in the old grid.
  const assignedSplitLabel = (() => {
    if (!memberLimits) return "";
    const { normal, calling } = memberLimits.assignedToday.byProjectType;
    if (normal > 0 && calling > 0) return `${fmtHours(normal)} on tasks · ${fmtHours(calling)} on calls`;
    return "";
  })();

  // Only rendered when the project actually has an Hours-based budget - no
  // dash-filled card cluttering the common case of no budget configured.
  const projectBudgetReached = projectBudget != null && projectBudget.remainingSeconds <= 0;
  const projectBudgetPercent =
    projectBudget && projectBudget.capSeconds > 0
      ? Math.min(100, (projectBudget.spentSeconds / projectBudget.capSeconds) * 100)
      : 0;

  /** The day as one gauge: worked, the cap it runs into, and when that lands. */
  const todayPanel = (
    <section className="stat-panel page-content-swap" style={{ animationDelay: "0.04s" }}>
      <div className="stat-panel-head">
        <h3 className="stat-panel-title">Today</h3>
        {dayHint ? <span className="stat-panel-hint">{dayHint}</span> : null}
      </div>

      <div className="stat-hero-row">
        <div className="stat-hero-value">
          <span className={`stat-hero-number${memberLimits?.limitReached ? " warn" : ""}`}>
            {workedTodayLabel}
          </span>
          <span className="stat-hero-of">
            {dailyCapSeconds > 0 ? `of ${dailyCapLabel}` : "across every project"}
          </span>
        </div>

        <div className="stat-hero-aside">
          {memberLimits?.limitReached ? (
            <span className="stat-hero-aside-value warn">Cap reached</span>
          ) : projectedCapTimeLabel ? (
            <>
              <div className="stat-hero-aside-value">{projectedCapTimeLabel}</div>
              <div className="stat-hero-aside-label">cap lands here</div>
            </>
          ) : (
            <>
              <div className="stat-hero-aside-value">{dailyCapLeftLabel}</div>
              <div className="stat-hero-aside-label">
                {dailyCapSeconds > 0 ? "still allowed" : "no daily cap"}
              </div>
            </>
          )}
        </div>
      </div>

      {dailyCapSeconds > 0 ? (
        <div style={{ marginTop: 11 }}>
          <div className="capacity-bar">
            <div
              className={`capacity-fill${memberLimits?.limitReached || dayUsedPercent > 90 ? " warn" : ""}`}
              style={{ width: `${dayUsedPercent}%` }}
            />
            {dayOverPercent > 0 ? (
              <div
                className="capacity-fill warn"
                style={{ left: `${dayUsedPercent}%`, right: "auto", width: `${dayOverPercent}%` }}
              />
            ) : null}
            {/* One tick per hour of the cap, so the bar reads as a gauge. */}
            {memberLimits && memberLimits.dailyHours > 0 && memberLimits.dailyHours <= 16 ? (
              <div className="capacity-ticks">
                {Array.from({ length: Math.round(memberLimits.dailyHours) }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
            ) : null}
          </div>
          <div className="capacity-scale">
            <span>start of day</span>
            <span>{dailyCapLabel} cap</span>
          </div>
        </div>
      ) : null}
    </section>
  );

  const activityTile = (
    <div className="stat-tile activity-tile">
      <div className="activity-ring">
        <svg viewBox="0 0 60 60" aria-hidden="true">
          <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(8,16,34,0.9)" strokeWidth="6" />
          <circle
            cx="30"
            cy="30"
            r="26"
            fill="none"
            stroke="#34d399"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${activityDash} ${ACTIVITY_RING_CIRCUMFERENCE}`}
          />
        </svg>
        <span className="activity-ring-value">{activityLabel}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <span className="stat-tile-label">Activity</span>
        {activityPercent == null ? (
          <div className="stat-tile-foot">nothing tracked yet</div>
        ) : (
          <div className="activity-legend">
            <span className="activity-legend-row">
              <i className="activity-dot active" />
              {fmtHours(activityToday!.activeSeconds)} <em>active</em>
            </span>
            <span className="activity-legend-row">
              <i className="activity-dot idle" />
              {fmtHours(activityToday!.idleSeconds)} <em>idle</em>
            </span>
          </div>
        )}
      </div>
    </div>
  );

  const weekTile = (
    <div className="stat-tile">
      <div className="stat-tile-head">
        <span className="stat-tile-label">This week</span>
      </div>
      <div className="stat-tile-value-row">
        <span className="stat-tile-value">{weekWorkedLabel}</span>
        {weekOfLabel ? <span className="stat-tile-of">{weekOfLabel}</span> : null}
      </div>
      {weeklyCapSeconds > 0 ? (
        <div style={{ marginTop: 9 }}>
          <div className="capacity-bar slim">
            <div
              className={`capacity-fill${weekUsedPercent > 90 ? " warn" : ""}`}
              style={{ width: `${weekUsedPercent}%` }}
            />
          </div>
        </div>
      ) : null}
      {weekFootLabel ? <span className="stat-tile-foot">{weekFootLabel}</span> : null}
    </div>
  );

  const projectBudgetTile = projectBudget ? (
    <div className="stat-tile">
      <div className="stat-tile-head">
        <span className="stat-tile-label">Project budget</span>
        <span className="stat-tile-note">{projectBudget.scope === "per_person" ? "yours" : "team"}</span>
      </div>
      <div className="stat-tile-value-row">
        <span className={`stat-tile-value${projectBudgetReached ? " warn" : ""}`}>
          {fmtHours(projectBudget.remainingSeconds)}
        </span>
        <span className="stat-tile-of">left of {fmtHours(projectBudget.capSeconds)}</span>
      </div>
      <div style={{ marginTop: 9 }}>
        <div className="capacity-bar slim">
          <div
            className={`capacity-fill${projectBudgetPercent > 90 ? " warn" : ""}`}
            style={{ width: `${projectBudgetPercent}%` }}
          />
        </div>
      </div>
    </div>
  ) : null;

  /** Assigned today: what fits under the cap vs what defers to a later day. */
  const assignedTile = (
    <div className="stat-tile">
      <div className="stat-tile-head">
        <span className="stat-tile-label">Assigned today</span>
        {assignedTaskCountLabel ? <span className="stat-tile-note">{assignedTaskCountLabel}</span> : null}
      </div>
      <div className="stat-tile-value-row">
        <span className="stat-tile-value">{assignedTodayLabel}</span>
        {assignedCarriedLabel ? <span className="stat-tile-of">{assignedCarriedLabel}</span> : null}
      </div>
      <div className="split-bar">
        <div className="split-bar-planned" style={{ width: `${assignedPlannedPercent}%` }} />
        <div className="split-bar-deferred" style={{ width: `${assignedDeferredPercent}%` }} />
      </div>
      <div className="split-legend">
        <span className="split-legend-row">
          <i className="split-dot" />
          {fmtHours(memberLimits?.assignedToday.plannedSeconds)} fits today
        </span>
        {memberLimits && memberLimits.assignedToday.deferredSeconds > 0 ? (
          <span className="split-legend-row deferred">
            <i className="split-dot deferred" />
            {fmtHours(memberLimits.assignedToday.deferredSeconds)} moves on
          </span>
        ) : null}
      </div>
      {assignedSplitLabel ? <div className="stat-tile-divider">{assignedSplitLabel}</div> : null}
    </div>
  );

  // Rendered under both project types. A project's own budget is independent
  // of, and stacks with, a task's own estimate - both can apply to the same
  // task-based session at once, so the budget tile takes the third slot and
  // pushes the workload tile onto its own row rather than displacing it.
  const hoursTodayCards = (
    <div className="stats-stack page-content-swap" style={{ animationDelay: "0.04s" }}>
      {todayPanel}
      <div className="stat-row-3">
        {activityTile}
        {weekTile}
        {projectBudgetTile ?? assignedTile}
      </div>
      {projectBudgetTile ? assignedTile : null}
    </div>
  );

  // Whole-task budget remaining, independent of whichever daily/weekly cap
  // "Remaining" above is currently bound by. activeSeconds here is the
  // cumulative total worked on this task across every day, so this decreases
  // by real time worked whether it came out of regular or overtime hours.
  const taskBudgetRemainingLabel = !taskTracking?.estimatedSeconds
    ? "—"
    : fmtHours(Math.max(0, taskTracking.estimatedSeconds - taskTracking.activeSeconds));

  // The estimate's own shape. overtimeSeconds is part of estimatedSeconds, so
  // a flat "16h" hid that 4h of it was overtime; drawing the two zones behind
  // the worked bar makes crossing into overtime visible as it happens.
  const taskEstimateSeconds = taskTracking?.estimatedSeconds ?? 0;
  const taskOvertimeSeconds = Math.max(0, taskTracking?.overtimeSeconds ?? 0);
  const taskRegularSeconds = Math.max(0, taskEstimateSeconds - taskOvertimeSeconds);
  const taskRegularPercent = taskEstimateSeconds > 0 ? (taskRegularSeconds / taskEstimateSeconds) * 100 : 0;
  const taskOvertimePercent = taskEstimateSeconds > 0 ? (taskOvertimeSeconds / taskEstimateSeconds) * 100 : 0;
  const taskWorkedPercent =
    taskEstimateSeconds > 0
      ? Math.min(100, ((taskTracking?.activeSeconds ?? 0) / taskEstimateSeconds) * 100)
      : 0;
  const taskIntoOvertime =
    taskEstimateSeconds > 0 && (taskTracking?.activeSeconds ?? 0) > taskRegularSeconds;
  const taskScheduleLabel = (() => {
    if (!taskTracking?.workingDays || !taskTracking?.hoursPerDay) return "";
    const base = `${taskTracking.workingDays}d × ${taskTracking.hoursPerDay}h`;
    return taskOvertimeSeconds > 0 ? `${base} + ${fmtHours(taskOvertimeSeconds)} OT` : base;
  })();

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
  if ((connection === "disconnected" || staleSession) && !sessionOpen && view === "home") {
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
        theme={themePref}
        onCycleTheme={handleCycleTheme}
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
        onCheckUpdate={() => void checkForUpdate(true)}
        checkingUpdate={checkingUpdate}
      />
    );
  }

  const isPanelView = view === "settings" || view === "profile";

  return (
    /* One shell for home, profile and settings. Each of the three used to
       return its own <main> from a different component, so React tore the
       whole tree down on every view change and replayed every mount
       animation - which read as the app reloading. */
    <main className="agent-tray">
      {/* The slide-in animation used to live on .agent-tray itself, back when
          each view was its own freshly-mounted <main>. Now that the shell is
          one persistent element (see above), a transform on .agent-tray would
          drag the title bar along with it - transform creates a new
          containing block, so the absolutely-positioned title bar moves with
          its animated ancestor. The animation now lives on this inner
          wrapper instead, so the window controls stay put and only the
          content underneath slides or fades. */}
      <TitleBar
        title={view === "settings" ? "Settings" : view === "profile" ? "Profile" : "Virtual Tracker"}
        onClose={() => void invoke("close_window")}
        onCheckUpdate={() => void checkForUpdate(true)}
        checkingUpdate={checkingUpdate}
        theme={themePref}
        onCycleTheme={handleCycleTheme}
      />

      <div
        key={isPanelView ? "panel" : "home"}
        className={`agent-view${isPanelView ? " settings-window view-settings" : " view-home"}`}
      >
      {view === "settings" ? (
        <SettingsPanel onBack={() => setView("home")} />
      ) : view === "profile" ? (
        <ProfilePanel
          profile={profile}
          memberProfile={memberProfile}
          memberLimits={memberLimits}
          onBack={() => setView("home")}
          onSignOut={() => void handleSignOut()}
          signingOut={signingOut}
        />
      ) : (
      <div className={`app-body${signedIn ? "" : " app-body-auth-only"}`}>
        <aside className="side-panel">
        {/* Everything above Start tracking can genuinely outgrow 680px -
            two 3-row lists plus the weekly ring plus the hero card is more
            content than a fixed-height window can always show at once.
            This region scrolls on its own so the primary action and the
            footer below never do - they're always on screen. */}
        <div className="side-panel-scroll">
          {/* Identity moved to the footer bar, which now carries the avatar,
              the name and the live status - it was duplicated here and there.
              What is left is the one thing that isn't repeated anywhere: what
              is happening right now. */}
          <section className="hero-card">
            <div className={`signal${tracking ? " live" : ""}`}>
              <p className="signal-text">
                {loadingProfile
                  ? "Checking your session…"
                  : paused
                    ? "On a break — time is counting as idle"
                    : tracking
                      ? trackingLabel || "Tracking"
                      : signedIn
                        ? !taskRequired
                          ? "Start when you're ready"
                          : "Select a task and start when you're ready"
                        : "Sign in to link this PC to your account"}
              </p>
            </div>
          </section>

          {/* Same weekly-activity percentage the web dashboard's own general
              view shows this member, drawn as a ring so it reads as one
              family with the Activity ring in the main pane instead of a
              second, differently-shaped chart. */}
          {signedIn && dashboardSummary ? (
            <section className="side-weekly side-panel-swap" style={{ animationDelay: "0.01s" }}>
              <div className="side-tasklist-head">
                <span className="stat-tile-label">Weekly activity</span>
              </div>
              <div className="side-weekly-ring-row">
                <div className="activity-ring side-weekly-ring">
                  <svg viewBox="0 0 60 60" aria-hidden="true">
                    <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(8,16,34,0.9)" strokeWidth="6" />
                    <circle
                      cx="30"
                      cy="30"
                      r="26"
                      fill="none"
                      stroke="#34d399"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${weekActivityDash} ${ACTIVITY_RING_CIRCUMFERENCE}`}
                    />
                  </svg>
                  <span className="activity-ring-value">{Math.round(dashboardSummary.activityWeekPercent)}%</span>
                </div>
                <div className="activity-legend">
                  <span className="activity-legend-row">
                    <i className="activity-dot active" />
                    {fmtHours(weekActiveSeconds)} <em>active</em>
                  </span>
                  <span className="activity-legend-row">
                    <i className="activity-dot idle" />
                    {fmtHours(weekIdleSeconds)} <em>idle</em>
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          {/* Every project the member can track against, as a quick-switch
              list rather than only the dropdown below - useful the moment
              there's more than one, and each row's open-task count is
              something the dropdown itself has no room to show. */}
          {signedIn && projects.length > 0 ? (
            <section className="side-tasklist side-panel-swap" style={{ animationDelay: "0.02s" }}>
              <div className="side-tasklist-head">
                <span className="stat-tile-label">Your projects</span>
                <span className="side-tasklist-count">{projects.length}</span>
              </div>
              <div className="side-tasklist-body">
                {projects.map((project) => {
                  const openCount = openTaskCountByProject.get(project.id) ?? 0;
                  const progress = projectProgressById.get(project.id);
                  return (
                    <button
                      key={project.id}
                      type="button"
                      className={`side-task-row${progress != null ? " has-progress" : ""}${project.id === selectedProjectId ? " active" : ""}`}
                      disabled={busy || sessionOpen}
                      onClick={() => jumpToProject(project.id)}
                    >
                      <span className="side-task-row-main">
                        <span className="side-task-row-top">
                          <span className="side-task-row-title">{project.name}</span>
                          {progress != null ? <span className="side-task-row-percent">{Math.round(progress)}%</span> : null}
                        </span>
                        {progress != null ? (
                          <span className="capacity-bar slim">
                            <span className="capacity-fill active" style={{ width: `${Math.round(progress)}%` }} />
                          </span>
                        ) : (
                          <span className="side-task-row-project">
                            {project.hasTasks ? `${openCount} open task${openCount === 1 ? "" : "s"}` : "Calling project"}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* Everything open and assigned to the member, across every
              project - not scoped to whichever one is currently picked.
              This is the task picker now, the same way the list above is
              the project picker: click a row to select it, no dropdown. */}
          {signedIn ? (
            <section className="side-tasklist side-panel-swap" style={{ animationDelay: "0.03s" }}>
              <div className="side-tasklist-head">
                <span className="stat-tile-label">Your tasks</span>
                {assignedTasks.length > 0 ? (
                  <span className="side-tasklist-count">{assignedTasks.length}</span>
                ) : null}
              </div>
              {assignedTasks.length > 0 ? (
                <div className="side-tasklist-body">
                  {assignedTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className={`side-task-row${task.id === selectedTaskId ? " active" : ""}`}
                      disabled={busy || sessionOpen}
                      onClick={() => jumpToAssignedTask(task)}
                    >
                      <span className="side-task-row-main">
                        <span className="side-task-row-title">{task.title}</span>
                        {task.projectId ? (
                          <span className="side-task-row-project">
                            {projectNameById.get(task.projectId) || "Unknown project"}
                          </span>
                        ) : null}
                      </span>
                      <span className={`badge ${taskStatusTone(task.status)}`}>{taskStatusLabel(task.status)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="side-tasklist-empty">
                  <Icon name="check-filled" />
                  Nothing open assigned to you right now
                </p>
              )}
            </section>
          ) : null}
        </div>

        {/* Pinned to the bottom, outside the scroll region above - Start
            tracking and the profile/settings footer stay reachable no
            matter how tall the lists above get. */}
        <div className="side-panel-pinned">
          {loadingProfile ? (
            <div className="side-skeleton side-panel-swap" aria-hidden="true">
              <span className="skeleton-bar skeleton-bar-lg" />
              <span className="skeleton-bar" />
            </div>
          ) : (
            <>
              {/* Project and task pickers are both gone - "Your projects"
                  and "Your tasks" above already do that job by clicking a
                  row, and a dropdown next to each was a second, redundant
                  control for the same choice. Only the "nothing to pick
                  from" fallback is left to show here. */}
              {projects.length === 0 ? (
                <p className="side-tasklist-empty side-panel-swap">
                  {projectsFailed ? "Couldn't load your projects" : "No projects to track against yet"}
                </p>
              ) : null}

              <nav className="actions side-panel-swap" style={{ animationDelay: "0.06s" }}>
                {paused ? (
                  <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void handleResume()}>
                    Resume tracking
                  </button>
                ) : tracking ? (
                  /* Pause and Stop are a pair, not two slabs in a stack. */
                  <div className="action-pair">
                    <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void handlePause()}>
                      Pause
                    </button>
                    <button className="btn btn-danger btn-compact" type="button" disabled={busy} onClick={handleStopClick}>
                      Stop
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={
                      busy ||
                      (taskRequired ? !selectedTaskId : !selectedProjectId) ||
                      Boolean(taskTracking?.limitReached)
                    }
                    title={taskTracking?.limitReached ? taskTracking.allowanceMessage || "Maximum allowed work time reached." : undefined}
                    onClick={() => void handleStart()}
                  >
                    Start tracking
                  </button>
                )}

                <button className="btn btn-secondary" type="button" onClick={() => void invoke("open_web_app")}>
                  Open dashboard
                  <Icon name="external" />
                </button>

                {/* Recovery, not a peer of Start. "Re-link account" was
                    internal jargon for signing in again on this PC. */}
                <button className="btn-quiet" type="button" onClick={() => void handleSignIn()}>
                  Sign in again
                </button>
              </nav>

              {/* Profile and Settings as peers in the flow. The gear used to
                  float at position:absolute bottom-left, detached from the
                  layout and the only route into Settings; the avatar was
                  secretly the only route into the profile. The card itself
                  is name + email + role, same as the People-page identity it
                  is drawn from - state lives on the dot alone (tracking /
                  paused / offline / ready) rather than repeating it as a
                  second line under a status pill up top. */}
              <div className="side-footer">
                <button
                  type="button"
                  className="side-footer-profile"
                  disabled={!signedIn}
                  title={signedIn ? "View profile" : undefined}
                  onClick={() => setView("profile")}
                >
                  <span className="side-footer-avatar">
                    {/* The circular clip lives on this inner span, not on
                        .side-footer-avatar itself - clipping the outer
                        element also clipped the status dot below to the
                        circle's own edge instead of letting it sit on the
                        rim. */}
                    <span className="side-footer-avatar-circle">
                      {profile?.avatarUrl && !avatarError ? (
                        <img
                          src={profile.avatarUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          draggable={false}
                          onError={() => setAvatarError(true)}
                        />
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
                    {signedIn && footerEmail ? (
                      <span className="side-footer-email">{footerEmail}</span>
                    ) : null}
                    {signedIn && footerRole ? (
                      <span className="badge neutral side-footer-badge">{footerRole}</span>
                    ) : null}
                  </span>
                </button>
                <button
                  className="icon-btn side-footer-settings"
                  type="button"
                  title="Settings"
                  aria-label="Settings"
                  onClick={() => setView("settings")}
                >
                  <Icon name="gear" />
                </button>
              </div>
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
        </div>

          {stopNoteOpen ? (
            <div className="stop-note-backdrop">
              <div className="stop-note-card" role="dialog" aria-modal="true" aria-label="What did you work on?">
                <h3 className="stop-note-title">What did you work on?</h3>
                <p className="stop-note-sub">
                  This project asks for a short note before the timer stops.
                </p>
                <textarea
                  className="stop-note-input"
                  autoFocus
                  rows={3}
                  maxLength={1000}
                  value={stopNoteDraft}
                  placeholder="e.g. Called 12 leads, 3 follow-ups booked"
                  onChange={(e) => setStopNoteDraft(e.target.value)}
                />
                <div className="stop-note-actions">
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setStopNoteOpen(false)}
                  >
                    Keep tracking
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={busy || !stopNoteDraft.trim()}
                    onClick={() => void handleStop(stopNoteDraft.trim())}
                  >
                    {busy ? "Stopping…" : "Stop tracking"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

        </aside>

        {signedIn ? (
          <section className="page-area">
            <div className="page-header">
              <div className="page-header-titles">
                <span className="page-eyebrow">Today</span>
                <h2 className="page-title">{trackingLabel || "Time Tracking"}</h2>
              </div>
              <button
                className="icon-btn"
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

            {signedIn && (selectedTaskId || (taskLessSession && selectedProjectId)) ? (
              <>
                <div className="page-clock page-content-swap">
                  <span className="page-clock-value">
                    {fmtClock(timerViewMode === "task" ? liveTaskActiveSeconds : liveActiveSeconds)}
                  </span>
                  <span className="page-clock-label">
                    {tracking ? "Elapsed · Tracking" : paused ? "On a break" : "Paused"}
                    {timerViewMode === "task" ? " · whole task" : ""}
                  </span>
                  {!taskLessSession && taskTracking ? (
                    <button
                      type="button"
                      className="icon-btn"
                      title={timerViewMode === "task" ? "Switch to today's time" : "Switch to whole-task time"}
                      aria-label={timerViewMode === "task" ? "Switch to today's time" : "Switch to whole-task time"}
                      style={{ marginLeft: "auto", alignSelf: "center" }}
                      onClick={() => setTimerViewMode((m) => (m === "task" ? "day" : "task"))}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-9 4a9 9 0 1 1 9 9 9 9 0 0 1-9-9Zm9-7a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>

                {/* Your own hours - the only cap a calling project has, and the
                    one the task section below folds invisibly into "left". */}
                {hoursTodayCards}

                {/* Task estimate, budget and progress are what performance is
                    measured from - a task-less session has none of it. */}
                {taskLessSession ? null : (
                  <section className="stat-panel page-content-swap" style={{ animationDelay: "0.08s" }}>
                    <div className="stat-panel-head">
                      <h3 className="stat-panel-title">This task</h3>
                      {taskTracking?.sharedBudget ? (
                        <span className="stat-panel-hint">shared across the team</span>
                      ) : null}
                    </div>

                    {/* No task title here - it is already the page heading. */}
                    <div className="task-budget-row" style={{ marginTop: 9 }}>
                      <span className="task-budget-number">{fmtHours(taskTracking?.activeSeconds)}</span>
                      <span className="task-budget-of">
                        {taskEstimateSeconds > 0 ? `of ${fmtHours(taskEstimateSeconds)} budget` : "no estimate set"}
                      </span>
                      <span className="task-budget-today">
                        {fmtHours(taskTracking?.workedTodayOnTaskSeconds)} today
                      </span>
                    </div>

                    {taskEstimateSeconds > 0 ? (
                      <div style={{ marginTop: 9 }}>
                        <div className="budget-track">
                          <div
                            className="budget-zone regular"
                            style={{ left: 0, width: `${taskRegularPercent}%` }}
                          />
                          {taskOvertimePercent > 0 ? (
                            <div
                              className="budget-zone overtime"
                              style={{ left: `${taskRegularPercent}%`, width: `${taskOvertimePercent}%` }}
                            />
                          ) : null}
                          <div
                            className={`budget-worked${taskIntoOvertime ? " overtime" : ""}`}
                            style={{ width: `${taskWorkedPercent}%` }}
                          />
                        </div>
                        <div className="budget-scale">
                          <span>{taskScheduleLabel}</span>
                          <span className={`right${taskIntoOvertime ? " overtime" : ""}`}>
                            {taskIntoOvertime ? "into overtime · " : ""}
                            {taskBudgetRemainingLabel} left
                          </span>
                        </div>
                      </div>
                    ) : null}

                    {taskTracking?.progressPercent != null ? (
                      <div className="task-progress-block">
                        <div className="task-progress-head">
                          <span className="label">Progress</span>
                          <span className="value">{Math.round(taskTracking.progressPercent)}%</span>
                        </div>
                        <div className="capacity-bar slim">
                          <div
                            className="capacity-fill active"
                            style={{ width: `${Math.min(100, Math.max(0, taskTracking.progressPercent))}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </section>
                )}

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
      )}
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
