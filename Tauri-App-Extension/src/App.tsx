import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  AgentWorkspace,
  ScreenshotRef,
  TaskDetail,
  AuthView,
  ConnectionState,
  CreateTaskResult,
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
import { fmtClock, fmtHours } from "./utils/formatters";
import { computeHomeStats } from "./utils/homeStats";
import { TodayPanel } from "./components/stats/TodayPanel";
import { ActivityTile } from "./components/stats/ActivityTile";
import { WeekTile } from "./components/stats/WeekTile";
import { ProjectBudgetTile } from "./components/stats/ProjectBudgetTile";
import { AssignedTodayBadge } from "./components/stats/AssignedTodayBadge";
import { TaskProgressPanel } from "./components/stats/TaskProgressPanel";
import { WeeklyActivityCard } from "./components/sidebar/WeeklyActivityCard";
import { TeamStatusCard } from "./components/sidebar/TeamStatusCard";
import { ManagementCard } from "./components/sidebar/ManagementCard";
import { ProjectsList } from "./components/sidebar/ProjectsList";
import { TasksList } from "./components/sidebar/TasksList";
import { SidebarActions } from "./components/sidebar/SidebarActions";
import { SidebarFooter } from "./components/sidebar/SidebarFooter";
import { StopNoteModal } from "./components/StopNoteModal";
import { NewTaskModal } from "./components/NewTaskModal";
import { LogTimeModal } from "./components/LogTimeModal";
import { TimeOffRequestModal } from "./components/TimeOffRequestModal";
import { TaskDetailPanel } from "./components/stats/TaskDetailPanel";
import { TitleBar } from "./components/common/TitleBar";
import { Icon } from "./components/common/Icon";
import { applyTheme } from "./utils/theme";
import { notify } from "./utils/notify";
import { SettingsPanel } from "./components/views/SettingsPanel";
import { ProfilePanel } from "./components/views/ProfilePanel";
import { WelcomeBackPanel } from "./components/views/WelcomeBackPanel";
import { MonitoringNoticePanel } from "./components/views/MonitoringNoticePanel";
import { SignInPanel } from "./components/views/SignInPanel";

/** Below this, a stop isn't a day worth recapping - see handleStop. */
const RECAP_MIN_SECONDS = 5 * 60;

/** How long the connection has to stay down before it's worth interrupting
 *  someone about. A blip shorter than this heals before anyone could act. */
const OFFLINE_NOTICE_DELAY_MS = 30_000;

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
  const [selectedTaskId, setSelectedTaskId] = useState("");
  // Every open task assigned to the member, across every project - not
  // scoped to whichever project happens to be picked (that's `tasks`
  // above, which only exists to feed the task dropdown). This is the
  // sidebar's own "what else is on my plate" view.
  const [assignedTasks, setAssignedTasks] = useState<AgentTask[]>([]);
  const [assignedTasksFailed, setAssignedTasksFailed] = useState(false);
  // "Has the first pass finished", not "did it return anything" - these gate
  // the main pane's skeleton so it never flashes an empty state at someone
  // whose data is still in flight. Both stay true afterwards: later polls
  // refresh in place, and re-skeletoning a populated pane every 30s would be
  // worse than the stale second it replaces.
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [assignedTasksLoaded, setAssignedTasksLoaded] = useState(false);
  // The web dashboard's own "Weekly trends" + "Recent projects" widgets,
  // reused rather than reinvented - null on an older backend without the
  // route yet, in which case those two sidebar cards just don't render.
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  // Per-role extras (own standing, plus team/approvals/pulse when entitled).
  // null until loaded, or on a backend without the route - every panel it
  // feeds simply doesn't render in that case.
  const [workspace, setWorkspace] = useState<AgentWorkspace | null>(null);
  // Manual time entry - only reachable when the server says so
  // (workspace.capabilities.canLogManualTime, Manager and above).
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [logTimeMemberId, setLogTimeMemberId] = useState("");
  const [logTimeProjectId, setLogTimeProjectId] = useState("");
  const [logTimeDate, setLogTimeDate] = useState("");
  const [logTimeHours, setLogTimeHours] = useState("");
  const [logTimeDescription, setLogTimeDescription] = useState("");
  const [logTimeBusy, setLogTimeBusy] = useState(false);
  const [logTimeError, setLogTimeError] = useState<string | null>(null);
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  const [timeOffPolicyId, setTimeOffPolicyId] = useState("");
  const [timeOffStart, setTimeOffStart] = useState("");
  const [timeOffEnd, setTimeOffEnd] = useState("");
  const [timeOffNote, setTimeOffNote] = useState("");
  const [timeOffBusy, setTimeOffBusy] = useState(false);
  const [timeOffError, setTimeOffError] = useState<string | null>(null);
  const [submittingTimesheet, setSubmittingTimesheet] = useState(false);
  const [screenshots, setScreenshots] = useState<ScreenshotRef[]>([]);
  const [screenshotImages, setScreenshotImages] = useState<Record<string, string>>({});
  const [selectedScreenshotId, setSelectedScreenshotId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [stopNoteOpen, setStopNoteOpen] = useState(false);
  const [stopNoteDraft, setStopNoteDraft] = useState("");
  // Which project's "+" row action opened the dialog - null closes it. Kept
  // as the whole ProjectInfo (not just an id) so the dialog can show the
  // project's name without a lookup back into `projects`.
  const [newTaskProject, setNewTaskProject] = useState<ProjectInfo | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskEstimateHours, setNewTaskEstimateHours] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  // "medium" up front, matching the web wizard's own default (task-wizard-
  // modal.tsx) and the server's create-time fallback (tasks-postgres.
  // service.js) - the picker starting on a real, valid selection rather
  // than a blank one that has to be explicitly set to match.
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [newTaskError, setNewTaskError] = useState<string | null>(null);
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
      // A budget-exhausted project can't be tracked against, so it can't stay
      // selected either - it used to drop out of the list entirely, which
      // cleared the selection as a side effect. Same outcome, stated directly.
      setSelectedProjectId((current) =>
        current && next.some((p) => p.id === current && !p.budgetExhausted) ? current : "",
      );
    } catch {
      setProjects([]);
      setProjectsFailed(true);
    } finally {
      // Marks the first pass done whether it succeeded or failed - the
      // skeleton is for "still loading", not "loaded nothing", and a failed
      // fetch has its own error state to show.
      setProjectsLoaded(true);
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
      setAssignedTasksFailed(false);
    } catch {
      setAssignedTasks([]);
      // Without this, "Could not resolve your member profile" and a genuine
      // empty backlog both rendered as the same "Nothing assigned" state -
      // a hard failure reported as an all-clear.
      setAssignedTasksFailed(true);
    } finally {
      setAssignedTasksLoaded(true);
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

  // Projects and tasks are independent fetches against the same backend, so
  // one failing is a real per-resource error worth showing in place - but
  // both failing at the same moment is almost always the connection, not two
  // coincidental server errors. Showing two separate "Couldn't load" rows
  // there described the symptom and hid the cause; the reconnect view can
  // actually be acted on.
  //
  // Gated on both having completed a load, so the in-flight state (when both
  // are still false) never trips it.
  useEffect(() => {
    if (!signedIn) return;
    if (!projectsLoaded || !assignedTasksLoaded) return;
    if (projectsFailed && assignedTasksFailed) {
      setConnection("disconnected");
    }
  }, [signedIn, projectsLoaded, assignedTasksLoaded, projectsFailed, assignedTasksFailed]);

  // Time off, timesheet, earnings, and - per role, decided server-side -
  // team status, pending approvals and the org pulse, in one call. Same 60s
  // cadence as the dashboard summary above: none of it changes faster than
  // that, and it's four sections' worth of work per request.
  const refreshWorkspace = useCallback(async () => {
    if (!signedIn) {
      setWorkspace(null);
      return;
    }
    try {
      setWorkspace(await invoke<AgentWorkspace | null>("get_agent_workspace"));
    } catch {
      setWorkspace(null);
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

  // Derived, not fetched. list_tasks(projectId) and list_tasks(null) are the
  // same server query (GET /api/tasks?assigned_to=me) with and without a
  // project filter, so this project's tasks are exactly the subset of
  // assignedTasks already in hand - re-fetching them was a network round trip
  // that returned rows the app was holding the whole time, and it was what
  // made switching projects visibly pause. Deriving makes the switch
  // instant, and the existing 30s poll + live-sync refresh of assignedTasks
  // keeps every project's list warm rather than only the open one.
  //
  // No per-task limit pre-check here (nor in the fetch this replaced) - that
  // used to fire one get_task_time_tracking call per task just to hide
  // over-budget ones. The real gate lives downstream: refreshTaskTracking
  // polls the *selected* task every 5s and handleStart refuses an over-limit
  // task from that same data, which is more honest than hiding it.
  const tasks = useMemo(
    () =>
      !signedIn || !selectedProjectId || isCallingProject
        ? []
        : assignedTasks.filter((task) => task.projectId === selectedProjectId),
    [signedIn, selectedProjectId, isCallingProject, assignedTasks],
  );

  // Clears the selection when it's no longer valid (project switch, or a
  // poll that removed the open task) - but never invents a new one. This
  // used to fall back to `tasks[0]`, silently picking a task nobody chose
  // the moment its project was selected: "This task" and the whole
  // task-scoped main pane would appear for a task the member never clicked,
  // just from picking a project that happened to have one. Picking a task is
  // now always an explicit act - the "Your tasks" list in the sidebar (or
  // jumpToAssignedTask from anywhere else) - same as picking a project
  // never used to imply picking a task in the first place.
  useEffect(() => {
    setSelectedTaskId((current) => (current && tasks.some((t) => t.id === current) ? current : ""));
  }, [tasks]);

  const handleManualRefresh = async () => {
    if (refreshingData) return;
    setRefreshingData(true);
    try {
      await Promise.all([refresh(), refreshProjects(), refreshAssignedTasks()]);
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
      setMemberLimits(
        await invoke<MemberLimits | null>("get_member_limits", {
          projectId: selectedProjectId || null,
        }),
      );
    } catch {
      setMemberLimits(null);
    }
  }, [signedIn, selectedProjectId]);

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
  usePolling(view === "home" || view === "profile", 60000, refreshWorkspace);

  // The open task's own detail. Only refetched when the task actually
  // changes - unlike tracking numbers, a task's description and checklist
  // don't move second to second, so this is not on any poll.
  useEffect(() => {
    if (!signedIn || !selectedTaskId) {
      setTaskDetail(null);
      return;
    }
    let cancelled = false;
    void invoke<TaskDetail | null>("get_task_detail", { taskId: selectedTaskId })
      .then((detail) => {
        if (!cancelled) setTaskDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setTaskDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, selectedTaskId]);

  // Screenshots are only rendered on the Profile view, so they're fetched
  // when it opens rather than polled - the list is small and changes at the
  // capture cadence, not the UI's.
  useEffect(() => {
    if (!signedIn || view !== "profile") return;
    let cancelled = false;
    void invoke<ScreenshotRef[]>("get_my_screenshots", { limit: 12 })
      .then((shots) => {
        if (!cancelled) setScreenshots(shots);
      })
      .catch(() => {
        if (!cancelled) setScreenshots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, view]);

  // One image at a time, on click, cached by id - the list endpoint carries
  // no bytes on purpose, and pulling a dozen full screenshots up front to
  // show one would be wasteful.
  const handleSelectScreenshot = useCallback(
    (id: string) => {
      setSelectedScreenshotId(id);
      setScreenshotImages((current) => {
        if (current[id]) return current;
        void invoke<string>("get_screenshot_image", { screenshotId: id })
          .then((dataUrl) => {
            if (dataUrl) setScreenshotImages((prev) => ({ ...prev, [id]: dataUrl }));
          })
          .catch(() => {
            /* Leaves the placeholder in place - see ScreenshotsCard. */
          });
        return current;
      });
    },
    [],
  );

  function openLogTime() {
    setLogTimeMemberId("");
    setLogTimeProjectId(selectedProjectId || "");
    setLogTimeDate(new Date().toISOString().slice(0, 10));
    setLogTimeHours("");
    setLogTimeDescription("");
    setLogTimeError(null);
    setLogTimeOpen(true);
  }

  const handleLogTime = async () => {
    const hours = Number(logTimeHours);
    if (!logTimeProjectId || !logTimeDate || !Number.isFinite(hours) || hours <= 0 || logTimeBusy) return;
    setLogTimeBusy(true);
    setLogTimeError(null);
    try {
      await invoke("create_time_entry", {
        memberId: logTimeMemberId,
        projectId: logTimeProjectId,
        // The dialog collects a project and a duration, never a task - a
        // task-anchored manual entry would need the task picker too, and the
        // server treats task_id as optional.
        taskId: null,
        date: logTimeDate,
        durationSeconds: Math.round(hours * 3600),
        description: logTimeDescription.trim(),
      });
      setLogTimeOpen(false);
      toast.success(`Logged ${fmtHours(Math.round(hours * 3600))}`);
      // The entry counts toward the same caps the header reads, so refresh
      // rather than letting them drift until the next poll.
      await Promise.all([refreshMemberLimits(), refreshWorkspace()]);
    } catch (err) {
      setLogTimeError(err instanceof Error ? err.message : "Could not save the time entry");
    } finally {
      setLogTimeBusy(false);
    }
  };

  function openTimeOff() {
    const policies = workspace?.self.timeOff ?? [];
    setTimeOffPolicyId(policies.length === 1 ? policies[0].policyId : "");
    const today = new Date().toISOString().slice(0, 10);
    setTimeOffStart(today);
    setTimeOffEnd(today);
    setTimeOffNote("");
    setTimeOffError(null);
    setTimeOffOpen(true);
  }

  const handleRequestTimeOff = async () => {
    if (!timeOffPolicyId || !timeOffStart || !timeOffEnd || timeOffBusy) return;
    setTimeOffBusy(true);
    setTimeOffError(null);
    try {
      await invoke("request_time_off", {
        policyId: timeOffPolicyId,
        startDate: timeOffStart,
        endDate: timeOffEnd,
        note: timeOffNote.trim(),
      });
      setTimeOffOpen(false);
      toast.success("Time-off request sent");
      await refreshWorkspace();
    } catch (err) {
      setTimeOffError(err instanceof Error ? err.message : "Could not submit the request");
    } finally {
      setTimeOffBusy(false);
    }
  };

  const handleSubmitTimesheet = async () => {
    const sheet = workspace?.self.timesheet;
    if (!sheet || submittingTimesheet) return;
    setSubmittingTimesheet(true);
    try {
      await invoke("submit_timesheet", {
        periodStart: sheet.periodStart,
        periodEnd: sheet.periodEnd,
      });
      toast.success("Timesheet submitted");
      await refreshWorkspace();
    } catch (err) {
      // The server refuses an already-submitted/approved period with a
      // specific 409 message - worth showing verbatim rather than a generic
      // failure, since it explains itself.
      toast.error(err instanceof Error ? err.message : "Could not submit the timesheet");
    } finally {
      setSubmittingTimesheet(false);
    }
  };

  // The People-page member record (name, email, role) - fetched once per
  // sign-in, then re-pulled below whenever a scope-changed live-sync frame
  // says something about this member's own access changed (role edited on
  // the web, hierarchy move, ...). No polling: role edits are rare enough
  // that the live-sync push is the only trigger it needs.
  const refreshMemberProfile = useCallback(async () => {
    if (!signedIn) {
      setMemberProfile(null);
      return;
    }
    try {
      setMemberProfile(await invoke<MemberProfile | null>("get_member_profile"));
    } catch {
      setMemberProfile(null);
    }
  }, [signedIn]);

  useEffect(() => {
    void refreshMemberProfile();
  }, [refreshMemberProfile]);

  // P10 (PLAN-livesyncandagenttimer.md, case 45/46b) - the 5s polls above stay
  // as the fallback for whenever the live-sync WebSocket (Rust side:
  // agent/live_sync.rs) is down; this just shrinks the gap to sub-second when
  // it's up, but ONLY for whichever piece of state that specific frame could
  // plausibly have touched - a broadcastToAll frame (index.js's
  // subscribeChanges(() => broadcastToAll(...))) reaches every signed-in
  // client for every org-wide write, so calling all six refreshers on all of
  // them turned one save anywhere into a refetch storm here. The frame
  // itself already carries resource/id/action (change-bus.js's
  // publishChange), so this routes on those instead of re-fetching
  // everything and hoping something changed:
  //
  //  - "tasks" (a task's own row: title, estimate, status, ...) - only
  //    refreshAssignedTasks reads task rows now; the current project's own
  //    list is derived from it (see `tasks` above), so one refetch updates
  //    both. refreshTaskTracking only if the changed task is the one open.
  //  - "task-assignments" (who's on a task) - assignedToday demand
  //    (refreshMemberLimits) and the assigned-to-me list are what actually
  //    read that table; same open-task-only rule for refreshTaskTracking.
  //  - scope-changed reason "role" - only the profile record carries role
  //    text (see compat/routes.js's sendToMember(..., { reason: "role" })
  //    on the member-update path).
  //  - scope-changed reason "project-access" - only the project list
  //    (visibility/budget-exhausted flags) reads that.
  //  - any other scope-changed reason (e.g. "hierarchy") - workload figures
  //    are the one thing a hierarchy move could plausibly shift; kept as a
  //    conservative catch-all rather than a guess at every possible cause.
  useEffect(() => {
    const onLiveChanged = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      const frame = detail as { type?: unknown; resource?: unknown; reason?: unknown; id?: unknown };
      const touchesOpenTask = typeof frame.id === "string" && frame.id === selectedTaskId;

      if (frame.type === "changed" && frame.resource === "tasks") {
        void refreshAssignedTasks();
        if (touchesOpenTask) void refreshTaskTracking();
        return;
      }
      if (frame.type === "changed" && frame.resource === "task-assignments") {
        void refreshAssignedTasks();
        void refreshMemberLimits();
        if (touchesOpenTask) void refreshTaskTracking();
        return;
      }
      if (frame.type === "scope-changed") {
        const reason = typeof frame.reason === "string" ? frame.reason : "";
        if (reason === "role") {
          void refreshMemberProfile();
        } else if (reason === "project-access") {
          void refreshProjects();
        } else {
          void refreshMemberLimits();
          void refreshProjectBudget();
        }
      }
    };
    window.addEventListener("vt-live-changed", onLiveChanged);
    return () => window.removeEventListener("vt-live-changed", onLiveChanged);
  }, [
    selectedTaskId,
    refreshTaskTracking,
    refreshMemberLimits,
    refreshProjectBudget,
    refreshAssignedTasks,
    refreshProjects,
    refreshMemberProfile,
  ]);

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
  // stage, and the toast used to be considered enough on its own on the
  // (wrong) assumption someone would see it - the agent mostly runs
  // minimized to the tray, where neither the toast nor the banner is ever
  // on screen. notify() is the one that actually reaches someone there.
  // Stage 3 (stopped, idle time removed) gets its own native notification
  // even though it never had a toast - it's the stage with a real
  // consequence (lost time), so it's the last one that should go unnoticed
  // just because the window was hidden.
  const prevIdleStageRef = useRef(0);
  useEffect(() => {
    const stage = session?.idleStage ?? 0;
    const prevStage = prevIdleStageRef.current;
    if (stage === 1 && prevStage < 1) {
      const msg = "You look idle — the timer will stop in 10 minutes if there's no activity.";
      toast.warning(msg);
      void notify("You look idle", msg);
    } else if (stage === 2 && prevStage < 2) {
      const msg = "Still idle — the timer stops in 5 minutes and this idle time will be removed.";
      toast.warning(msg);
      void notify("Still idle", msg);
    } else if (stage === 3 && prevStage < 3) {
      idleRewindFromRef.current = liveWorkedTodaySeconds;
      void notify(
        "Timer stopped",
        "Stopped after 15 minutes idle. The idle time was removed from your hours.",
      );
    }
    prevIdleStageRef.current = stage;
    // liveWorkedTodaySeconds is read at the moment of the transition only -
    // it must not retrigger this effect on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.idleStage]);

  // Connection lost/restored - the in-page reconnect banner (rendered below)
  // is invisible while minimized to the tray, and a lost connection means
  // time is only being counted locally until it resolves.
  //
  // Held for a grace period rather than fired on the transition: a blip that
  // heals in a few seconds resolves itself, and announcing it (then
  // immediately announcing the recovery) produced the back-to-back
  // lost/restored pair with nothing for anyone to do in between. The effect's
  // own cleanup cancels the pending notice when the connection changes
  // again, so a blip shorter than the grace period says nothing at all.
  //
  // "Restored" is gated on having actually announced the loss - otherwise a
  // recovery from a blip nobody was told about announces itself out of
  // nowhere.
  const offlineNoticeSentRef = useRef(false);
  useEffect(() => {
    if (connection === "disconnected") {
      const timer = window.setTimeout(() => {
        offlineNoticeSentRef.current = true;
        void notify("Connection lost", "Time is still being counted locally. Reconnecting…");
      }, OFFLINE_NOTICE_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
    if (connection === "connected" && offlineNoticeSentRef.current) {
      offlineNoticeSentRef.current = false;
      void notify("Connection restored", "Back online — your time is syncing again.");
    }
  }, [connection]);

  // "Forgot to start tracking" - the idle-stage notifications above catch
  // forgetting to stop; nothing caught the opposite, more common mistake of
  // settling into work and never hitting Start at all, which leaves nothing
  // tracked to even notice later. Fires once per stretch of "should be
  // working, nothing open" - resets the moment a session opens, so it can
  // only ever nag about the gap that's actually still open right now.
  const neverStartedSinceRef = useRef<number | null>(null);
  const neverStartedNotifiedRef = useRef(false);
  useEffect(() => {
    const shouldBeTracking = signedIn && Boolean(memberLimits?.workingToday) && !sessionOpen;
    if (!shouldBeTracking) {
      neverStartedSinceRef.current = null;
      neverStartedNotifiedRef.current = false;
      return;
    }
    if (neverStartedSinceRef.current == null) {
      neverStartedSinceRef.current = Date.now();
    }
    const timer = window.setInterval(() => {
      const since = neverStartedSinceRef.current;
      if (neverStartedNotifiedRef.current || since == null) return;
      if (Date.now() - since >= 20 * 60_000) {
        neverStartedNotifiedRef.current = true;
        void notify("Still working?", "You haven't started tracking yet today.");
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [signedIn, memberLimits?.workingToday, sessionOpen]);

  // Long-unbroken-session nudge - a pacing/wellness signal, not a limit.
  // liveActiveSeconds already excludes paused/idle time by construction (see
  // its own sync effect above), so this only ever measures genuinely
  // continuous active work, not wall-clock time with breaks folded in.
  // Fires once per session (keyed on session?.id, not just `tracking`, so
  // stop-then-restart on the same task still gets its own fresh countdown).
  const longSessionNotifiedForRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!tracking || liveActiveSeconds < 2 * 3600) return;
    const sessionKey = session?.id ?? null;
    if (longSessionNotifiedForRef.current === sessionKey) return;
    longSessionNotifiedForRef.current = sessionKey;
    void notify("Still going?", "You've been tracking for 2 hours straight — consider a short break.");
  }, [tracking, liveActiveSeconds, session?.id]);

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
        await refreshAssignedTasks();
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

  // silent skips the "Today: X tracked" recap notification - only for
  // stopForTaskLimit below, which already sends its own "Task limit
  // reached" notification for the same stop; a manual Stop click (the only
  // other caller) always wants the recap.
  const handleStop = async (stopNote?: string, silent = false) => {
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
      // A recap is worth interrupting someone for only once there's a day
      // worth recapping - stopping a two-second session and being told
      // "Today: 2s tracked" is noise, not a summary. Below the threshold the
      // in-app toast above still confirms the stop.
      if (!silent && liveWorkedTodaySeconds >= RECAP_MIN_SECONDS) {
        // todayActivity (member-wide, every project) rather than the main
        // pane's own activityToday, which is scoped to whichever project
        // was just stopped - a day's-end recap should cover the whole day.
        const dayActivity = memberLimits?.todayActivity;
        const dayActivitySeconds = dayActivity ? dayActivity.activeSeconds + dayActivity.idleSeconds : 0;
        const activityPct =
          dayActivitySeconds > 0 ? Math.round((dayActivity!.activeSeconds / dayActivitySeconds) * 100) : null;
        void notify(
          "Tracking stopped",
          `Today: ${fmtHours(liveWorkedTodaySeconds)} tracked${activityPct != null ? `, ${activityPct}% active` : ""}.`,
        );
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

  // "+ New task" from a ProjectsList row - see side-task-row-add. Only
  // rendered there when project.canCreateTasks is already true, but the
  // server re-checks regardless (viewerCanCreateProjectTasks), so a 403 here
  // is still a real, expected outcome (e.g. the viewer's own project-manager
  // role was revoked between page load and this click).
  const handleOpenNewTask = (project: ProjectInfo) => {
    setNewTaskProject(project);
    setNewTaskTitle("");
    setNewTaskEstimateHours("");
    setNewTaskDescription("");
    setNewTaskPriority("medium");
    setNewTaskDueDate("");
    setNewTaskError(null);
  };

  const handleCancelNewTask = () => {
    if (creatingTask) return;
    setNewTaskProject(null);
  };

  const handleCreateTask = async () => {
    const project = newTaskProject;
    const title = newTaskTitle.trim();
    if (!project || !title || creatingTask) return;
    // Blank stays blank (no estimate at all, same as skipping it on the
    // web) - a non-numeric or non-positive entry is treated the same way
    // rather than blocking creation over a field that was always optional.
    const parsedEstimate = Number(newTaskEstimateHours);
    const estimateHours =
      newTaskEstimateHours.trim() && Number.isFinite(parsedEstimate) && parsedEstimate > 0
        ? parsedEstimate
        : null;
    setCreatingTask(true);
    setNewTaskError(null);
    try {
      const result = await invoke<CreateTaskResult>("create_task", {
        projectId: project.id,
        title,
        estimateHours,
        description: newTaskDescription.trim() || null,
        priority: newTaskPriority,
        dueDate: newTaskDueDate || null,
      });
      setNewTaskProject(null);
      setNewTaskTitle("");
      setNewTaskEstimateHours("");
      setNewTaskDescription("");
      setNewTaskPriority("medium");
      setNewTaskDueDate("");
      // The task exists either way (create_task only throws if the create
      // step itself failed) - self-assignment is a separate, stricter gate
      // (see CreateTaskResult's own doc comment), so a false here isn't an
      // error, just a reason the new task won't show up in "Your tasks" on
      // its own yet.
      if (result.selfAssigned) {
        toast.success(`"${result.task.title}" created`);
        jumpToAssignedTask(result.task);
      } else {
        // Now that assign_task_to_self hits the endpoint that allows
        // the task's own creator, a failure here is no longer a
        // permissions gap (that copy used to say "ask a manager") - the
        // realistic cause is the creator already being at their own
        // work-hour limit, or a transient network hiccup on that second
        // call. The task is real either way; only the assignment failed.
        toast.message(
          `"${result.task.title}" created, but couldn't be assigned to you automatically — open it from the web app to assign it.`,
        );
      }
      await refreshAssignedTasks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create the task";
      setNewTaskError(msg);
    } finally {
      setCreatingTask(false);
    }
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
    const msg = message || "Task limit reached — timer stopped. Your time is saved.";
    toast.warning(msg);
    void notify("Task limit reached", msg);
    void handleStop(undefined, true);
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

  // Keeps the tray menu's status/Pause/Resume/Stop items in sync, on the
  // same cadence as the 5s session poll (session/paused/tracking above) -
  // no second poller on the Rust side (see TrayStatusItems's own doc
  // comment). session?.activeSeconds rather than the ticking
  // liveActiveSeconds, so this doesn't fire an IPC call every second.
  useEffect(() => {
    void invoke("set_tray_status", {
      label: sessionOpen
        ? `${trackingLabel || "Tracking"} — ${fmtHours(session?.activeSeconds ?? 0)}`
        : "Not tracking",
      tracking,
      paused,
      sessionOpen,
    }).catch(() => {
      /* Tray may not exist yet (early startup) or at all (Linux) - the
         command itself already no-ops there; nothing to recover from here. */
    });
  }, [sessionOpen, tracking, paused, trackingLabel, session?.activeSeconds]);

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
  const jumpToProject = (project: ProjectInfo) => {
    if (busy || sessionOpen || project.budgetExhausted || project.id === selectedProjectId) return;
    setSelectedProjectId(project.id);
  };
  // Same "Recent projects" progress the web dashboard's general view shows
  // for this member - keyed by id so the quick-switch list below can show
  // it next to a project without re-deriving it from anything client-side.
  //
  // Overridden per-project by budgetSpentPercent when the project actually
  // has one: recentProjects' own number is task-completion (done/total),
  // which reads a flat 0% for any project with no task marked "done" yet -
  // indistinguishable from a project nothing has happened on at all, even
  // when real budget spend says otherwise. A project's own budget is the
  // more honest number whenever one exists.
  const projectProgressById = new Map(
    (dashboardSummary?.recentProjects ?? []).map((p) => [p.id, p.progress]),
  );
  for (const project of projects) {
    if (project.budgetSpentPercent != null) {
      projectProgressById.set(project.id, project.budgetSpentPercent);
    }
  }

  // The same payload is already ordered most-recently-touched first
  // (general-dashboard-service.js sorts by updatedMs and takes the top 5) -
  // only its `progress` was ever read, so the ordering signal was fetched
  // every 60s and thrown away.
  //
  // Using it matters most for Owner/Admin/Super Admin, where
  // getViewerProjectIds returns null and "Your projects" is therefore every
  // project in the org: alphabetical order buries whatever they actually
  // work on. Applied to everyone rather than branching on role - a short
  // list fits on screen either way, so it costs nothing there.
  const projectSortRank = useMemo(() => {
    const rank = new Map<string, number>();
    (dashboardSummary?.recentProjects ?? []).forEach((p, i) => rank.set(p.id, i));
    return rank;
  }, [dashboardSummary?.recentProjects]);

  const orderedProjects = useMemo(() => {
    const NOT_RECENT = Number.MAX_SAFE_INTEGER;
    return [...projects].sort((a, b) => {
      const ra = projectSortRank.get(a.id) ?? NOT_RECENT;
      const rb = projectSortRank.get(b.id) ?? NOT_RECENT;
      // Recent ones first in their own recency order, then everything else
      // alphabetically - a stable, predictable tail rather than an arbitrary
      // one that shuffles as the 60s poll lands.
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    });
  }, [projects, projectSortRank]);

  // Every label/percent/dash-array the Today panel, the three stat tiles, the
  // sidebar's Weekly activity ring, and the This-task panel display - see
  // utils/homeStats.ts (pure, unit-tested) for the derivation of each.
  const {
    dailyCapSeconds,
    dailyCapLabel,
    dailyCapLeftLabel,
    workedTodayLabel,
    dayUsedPercent,
    dayOverPercent,
    dayHint,
    activityToday,
    activityPercent,
    activityLabel,
    activityDash,
    weekActivityDash,
    weekActiveSeconds,
    weekIdleSeconds,
    weeklyCapSeconds,
    weekWorkedLabel,
    weekUsedPercent,
    weekOfLabel,
    weekFootLabel,
    projectedCapTimeLabel,
    assignedTodayLabel,
    assignedCarriedLabel,
    assignedTaskCountLabel,
    projectBudgetReached,
    projectBudgetPercent,
    taskBudgetRemainingLabel,
    taskEstimateSeconds,
    taskRegularPercent,
    taskOvertimePercent,
    taskWorkedPercent,
    taskIntoOvertime,
    taskScheduleLabel,
  } = computeHomeStats({
    memberLimits,
    dashboardSummary,
    projectBudget,
    taskTracking,
    liveWorkedTodaySeconds,
    tracking,
  });

  const todayPanel = (
    <TodayPanel
      dayHint={dayHint}
      memberLimits={memberLimits}
      workedTodayLabel={workedTodayLabel}
      dailyCapSeconds={dailyCapSeconds}
      dailyCapLabel={dailyCapLabel}
      projectedCapTimeLabel={projectedCapTimeLabel}
      dailyCapLeftLabel={dailyCapLeftLabel}
      dayUsedPercent={dayUsedPercent}
      dayOverPercent={dayOverPercent}
    />
  );

  const activityTile = (
    <ActivityTile
      activityDash={activityDash}
      activityLabel={activityLabel}
      activityPercent={activityPercent}
      activityToday={activityToday}
    />
  );

  const weekTile = (
    <WeekTile
      weekWorkedLabel={weekWorkedLabel}
      weekOfLabel={weekOfLabel}
      weeklyCapSeconds={weeklyCapSeconds}
      weekUsedPercent={weekUsedPercent}
      weekFootLabel={weekFootLabel}
    />
  );

  const projectBudgetTile = projectBudget ? (
    <ProjectBudgetTile
      projectBudget={projectBudget}
      projectBudgetReached={projectBudgetReached}
      projectBudgetPercent={projectBudgetPercent}
    />
  ) : null;

  // Rendered under both project types. A project's own budget is independent
  // of, and stacks with, a task's own estimate - both can apply to the same
  // task-based session at once, so the budget tile takes the third slot when
  // one exists; otherwise the row simply has two tiles. Assigned-today used
  // to fill this slot as a full stat-tile - it's member-wide, not scoped to
  // whichever project/task is open here, so it now lives as a small badge in
  // the header instead (see AssignedTodayBadge, next to Refresh).
  const hoursTodayCards = (
    <div className="stats-stack page-content-swap" style={{ animationDelay: "0.04s" }}>
      {todayPanel}
      {/* Two tiles reflow to fill the row on their own when there's no
          budget tile to take the third slot - a fixed 3-column grid would
          otherwise leave a visible blank cell where assignedTile used to
          sit. */}
      <div className={projectBudgetTile ? "stat-row-3" : "stat-row-3 stat-row-3-partial"}>
        {activityTile}
        {weekTile}
        {projectBudgetTile}
      </div>
    </div>
  );

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
        // "Link this device again" routes through handleSignIn, the same
        // function SignInPanel uses - and its failures land in actionError,
        // not reconnectMessage. Without this fallback, a failed relink here
        // showed a toast (easy to miss - the agent mostly runs in the tray)
        // and then reset to the same generic text with no persistent
        // explanation, leaving the same button to click again with no visible
        // change. reconnectMessage still wins when both are set - it's the
        // more specific one, from reconnect()/reauth actually running.
        message={reconnectMessage ?? actionError}
        busy={reconnecting || busy}
        needsRelink={needsRelink || staleSession}
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
          workspace={workspace}
          screenshots={screenshots}
          screenshotImages={screenshotImages}
          selectedScreenshotId={selectedScreenshotId}
          onSelectScreenshot={handleSelectScreenshot}
          onRequestTimeOff={openTimeOff}
          onSubmitTimesheet={() => void handleSubmitTimesheet()}
          submittingTimesheet={submittingTimesheet}
          onBack={() => setView("home")}
          onSignOut={() => void handleSignOut()}
          signingOut={signingOut}
        />
      ) : (
      <div className={`app-body${signedIn ? "" : " app-body-auth-only"}`}>
        <aside className="side-panel">
        {/* Everything above Start tracking can genuinely outgrow 680px -
            two 3-row lists plus the weekly ring is more content than a
            fixed-height window can always show at once. This region scrolls
            on its own so the primary action and the footer below never do -
            they're always on screen. */}
        <div className="side-panel-scroll">
          {/* The hero "signal" card that used to open this column is gone: a
              tall card whose whole job was restating status that's already on
              screen twice - the main pane's own title and clock label carry
              the task name and tracking/break state, and the footer's status
              dot carries tracking/paused/offline. Its remaining branches were
              instructions ("Select a task and start when you're ready") that
              cost more vertical space in a 680px window than they were worth,
              and a signed-out line that could never render at all, since
              !signedIn on the home view returns SignInPanel long before
              this. */}
          <WeeklyActivityCard
            signedIn={signedIn}
            dashboardSummary={dashboardSummary}
            weekActivityDash={weekActivityDash}
            weekActiveSeconds={weekActiveSeconds}
            weekIdleSeconds={weekIdleSeconds}
          />

          {/* Both render only when the backend actually sent their section -
              a lead gets the team roster, a management role gets the
              approvals queue, an org admin also gets the pulse. Entitlement
              is decided server-side (workspace.service.js), never here. */}
          <TeamStatusCard team={workspace?.team ?? null} />

          <ManagementCard
            approvals={workspace?.approvals ?? null}
            pulse={workspace?.pulse ?? null}
            onOpenDashboard={() => void invoke("open_web_app")}
          />

          <ProjectsList
            signedIn={signedIn}
            projects={orderedProjects}
            selectedProjectId={selectedProjectId}
            busy={busy}
            sessionOpen={sessionOpen}
            openTaskCountByProject={openTaskCountByProject}
            projectProgressById={projectProgressById}
            onSelectProject={jumpToProject}
            onCreateTask={handleOpenNewTask}
            /* Recently-touched first - see orderedProjects above. */
          />

          <TasksList
            signedIn={signedIn}
            loading={!assignedTasksLoaded}
            assignedTasks={assignedTasks}
            assignedTasksFailed={assignedTasksFailed}
            selectedTaskId={selectedTaskId}
            busy={busy}
            sessionOpen={sessionOpen}
            projectNameById={projectNameById}
            onSelectTask={jumpToAssignedTask}
          />
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
              {/* Skeleton while the first load is still in flight - "Couldn't
                  load your projects" was shown for the in-flight case too,
                  so a slow network read as a hard failure. The error text is
                  now reachable only once a load has actually finished and
                  failed, and even then only when tasks loaded fine: both
                  failing together is a connection problem, handled by the
                  reconnect view rather than by two error rows. */}
              {projects.length === 0 && !projectsLoaded ? (
                <div className="side-skeleton" aria-hidden="true">
                  <span className="skeleton-bar" />
                  <span className="skeleton-bar" />
                </div>
              ) : projects.length === 0 ? (
                <p className={`side-tasklist-empty side-panel-swap${projectsFailed ? " bad" : ""}`}>
                  <Icon name={projectsFailed ? "warn" : "info"} />
                  {projectsFailed ? "Couldn't load your projects" : "No projects to track against yet"}
                </p>
              ) : null}

              <SidebarActions
                paused={paused}
                tracking={tracking}
                busy={busy}
                taskRequired={taskRequired}
                selectedTaskId={selectedTaskId}
                selectedProjectId={selectedProjectId}
                taskTracking={taskTracking}
                onResume={() => void handleResume()}
                onPause={() => void handlePause()}
                onStopClick={handleStopClick}
                onStart={() => void handleStart()}
                onOpenDashboard={() => void invoke("open_web_app")}
                onSignInAgain={() => void handleSignIn()}
              />

              <SidebarFooter
                signedIn={signedIn}
                avatarUrl={profile?.avatarUrl}
                avatarError={avatarError}
                onAvatarError={() => setAvatarError(true)}
                displayName={displayName}
                footerName={footerName}
                footerEmail={footerEmail}
                footerRole={footerRole}
                loadingProfile={loadingProfile}
                connection={connection}
                tracking={tracking}
                paused={paused}
                onViewProfile={() => setView("profile")}
                onViewSettings={() => setView("settings")}
              />
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

          <StopNoteModal
            open={stopNoteOpen}
            draft={stopNoteDraft}
            busy={busy}
            onDraftChange={setStopNoteDraft}
            onKeepTracking={() => setStopNoteOpen(false)}
            onStop={() => void handleStop(stopNoteDraft.trim())}
          />

          <LogTimeModal
            open={logTimeOpen}
            projects={orderedProjects}
            /* Only offered when the viewer actually leads a team - the
               roster is the one set of members the agent already holds. */
            teammates={workspace?.team?.members ?? []}
            memberId={logTimeMemberId}
            projectId={logTimeProjectId}
            date={logTimeDate}
            hours={logTimeHours}
            description={logTimeDescription}
            busy={logTimeBusy}
            error={logTimeError}
            onMemberIdChange={setLogTimeMemberId}
            onProjectIdChange={setLogTimeProjectId}
            onDateChange={setLogTimeDate}
            onHoursChange={setLogTimeHours}
            onDescriptionChange={setLogTimeDescription}
            onCancel={() => setLogTimeOpen(false)}
            onSave={() => void handleLogTime()}
          />

          <TimeOffRequestModal
            open={timeOffOpen}
            policies={workspace?.self.timeOff ?? []}
            policyId={timeOffPolicyId}
            startDate={timeOffStart}
            endDate={timeOffEnd}
            note={timeOffNote}
            busy={timeOffBusy}
            error={timeOffError}
            onPolicyIdChange={setTimeOffPolicyId}
            onStartDateChange={setTimeOffStart}
            onEndDateChange={setTimeOffEnd}
            onNoteChange={setTimeOffNote}
            onCancel={() => setTimeOffOpen(false)}
            onSubmit={() => void handleRequestTimeOff()}
          />

          <NewTaskModal
            open={newTaskProject != null}
            projectName={newTaskProject?.name ?? ""}
            title={newTaskTitle}
            estimateHours={newTaskEstimateHours}
            description={newTaskDescription}
            priority={newTaskPriority}
            dueDate={newTaskDueDate}
            onDescriptionChange={setNewTaskDescription}
            onPriorityChange={setNewTaskPriority}
            onDueDateChange={setNewTaskDueDate}
            busy={creatingTask}
            error={newTaskError}
            onTitleChange={setNewTaskTitle}
            onEstimateHoursChange={setNewTaskEstimateHours}
            onCancel={handleCancelNewTask}
            onCreate={() => void handleCreateTask()}
          />

        </aside>

        {signedIn ? (
          <section className="page-area">
            <div className="page-header">
              <div className="page-header-titles">
                <span className="page-eyebrow">Today</span>
                <h2 className="page-title">{trackingLabel || "Time Tracking"}</h2>
              </div>
              {/* Grouped so Assigned-today, manual time entry and Refresh sit
                  as one cluster on the right, separated as a whole from the
                  titles - not spread apart individually by the header's own
                  space-between. Assigned-today used to be a full-width card
                  in the main pane below; it's member-wide, not scoped to
                  whichever project/task is open here, so this small badge is
                  what it actually deserved. */}
              <div className="page-header-actions">
                <AssignedTodayBadge
                  memberLimits={memberLimits}
                  assignedTodayLabel={assignedTodayLabel}
                  assignedTaskCountLabel={assignedTaskCountLabel}
                  assignedCarriedLabel={assignedCarriedLabel}
                />
                {/* Manual time entry. Rendered purely from the server-decided
                    capability (Manager and above) - the agent holds no role
                    logic of its own for this, so a spoofed local role cannot
                    reveal the control. */}
                {workspace?.capabilities.canLogManualTime ? (
                  <button
                    className="icon-btn"
                    type="button"
                    title="Log time that wasn't tracked"
                    aria-label="Log time that wasn't tracked"
                    disabled={busy}
                    onClick={openLogTime}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm1-13h-2v6l5 3 1-1.73-4-2.37V7Z"
                      />
                    </svg>
                  </button>
                ) : null}
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
            </div>

            {signedIn && (selectedTaskId || (taskLessSession && selectedProjectId)) ? (
              <>
                <div className="page-clock page-content-swap">
                  <span className="page-clock-value">
                    {fmtClock(timerViewMode === "task" ? liveTaskActiveSeconds : liveActiveSeconds)}
                  </span>
                  <span className="page-clock-label">
                    {/* sessionOpen = tracking || paused - neither true means no
                        session exists at all (never started, or fully
                        stopped), which is a different condition from "on a
                        break" and was mislabeled the same as a real pause. */}
                    {tracking ? "Elapsed · Tracking" : paused ? "On a break" : "Not tracking"}
                    {timerViewMode === "task" ? " · whole task" : ""}
                  </span>
                  {!taskLessSession && taskTracking ? (
                    <button
                      type="button"
                      className={`icon-btn${timerViewMode === "task" ? " active" : ""}`}
                      title={timerViewMode === "task" ? "Switch to today's time" : "Switch to whole-task time"}
                      aria-label={timerViewMode === "task" ? "Switch to today's time" : "Switch to whole-task time"}
                      // A real toggle needs to look like one - the icon
                      // itself never changes between the two states, so
                      // without this the button appeared to have only one
                      // state no matter which view was actually showing.
                      aria-pressed={timerViewMode === "task"}
                      style={{ marginLeft: "auto", alignSelf: "center" }}
                      disabled={busy}
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
                <TaskProgressPanel
                  taskLessSession={taskLessSession}
                  taskTracking={taskTracking}
                  taskEstimateSeconds={taskEstimateSeconds}
                  taskRegularPercent={taskRegularPercent}
                  taskOvertimePercent={taskOvertimePercent}
                  taskWorkedPercent={taskWorkedPercent}
                  taskIntoOvertime={taskIntoOvertime}
                  taskScheduleLabel={taskScheduleLabel}
                  taskBudgetRemainingLabel={taskBudgetRemainingLabel}
                />

                {/* What the task actually asks for - renders nothing for a
                    task-less session or a task with no detail. */}
                {taskLessSession ? null : <TaskDetailPanel detail={taskDetail} />}

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
            ) : !projectsLoaded || !assignedTasksLoaded ? (
              /* Still loading, not empty. Without this the pane rendered
                 "No task selected" the moment it mounted - before the app
                 had any idea whether a project or task existed - which read
                 as a real answer rather than as a pending one. Shaped like
                 the layout it precedes, so nothing jumps when data lands. */
              <div className="page-skeleton page-content-swap" aria-hidden="true">
                <span className="skeleton-bar skeleton-bar-clock" />
                <span className="skeleton-bar skeleton-bar-panel" />
                <div className="page-skeleton-row">
                  <span className="skeleton-bar" />
                  <span className="skeleton-bar" />
                  <span className="skeleton-bar" />
                </div>
              </div>
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
