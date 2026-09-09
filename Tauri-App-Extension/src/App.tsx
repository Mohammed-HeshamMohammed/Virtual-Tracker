import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
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
import { fmtClock, fmtHours, fmtWallClock, fmtWallDate } from "./utils/formatters";
import { computeHomeStats } from "./utils/homeStats";
import { TodayPanel } from "./components/stats/TodayPanel";
import { ActivityTile } from "./components/stats/ActivityTile";
import { WeekTile } from "./components/stats/WeekTile";
import { ProjectBudgetTile } from "./components/stats/ProjectBudgetTile";
import { AssignedTodayBadge, AssignedToMeBadge } from "./components/stats/AssignedTodayBadge";
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
import { ProjectDetailPanel } from "./components/stats/ProjectDetailPanel";
import { TitleBar } from "./components/common/TitleBar";
import { TimezonePicker } from "./components/common/TimezonePicker";
import { Icon } from "./components/common/Icon";
import { applyTheme } from "./utils/theme";
import { notify } from "./utils/notify";
import { SettingsPanel } from "./components/views/SettingsPanel";
import { ProfilePanel } from "./components/views/ProfilePanel";
import { WelcomeBackPanel } from "./components/views/WelcomeBackPanel";
import { MonitoringNoticePanel } from "./components/views/MonitoringNoticePanel";
import { SignInPanel } from "./components/views/SignInPanel";

const RECAP_MIN_SECONDS = 5 * 60;

const OFFLINE_NOTICE_DELAY_MS = 30_000;

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
  const [assignedTasks, setAssignedTasks] = useState<AgentTask[]>([]);
  // Consecutive failed rounds, not a bare flag: one failed poll must not
  // repaint a working screen as broken (see refreshProjects/refreshAssignedTasks).
  const [assignedTasksFailCount, setAssignedTasksFailCount] = useState(0);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [assignedTasksLoaded, setAssignedTasksLoaded] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [workspace, setWorkspace] = useState<AgentWorkspace | null>(null);
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
  const [newTaskProject, setNewTaskProject] = useState<ProjectInfo | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskEstimateHours, setNewTaskEstimateHours] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [newTaskError, setNewTaskError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [paused, setPaused] = useState(false);
  const [taskTracking, setTaskTracking] = useState<TaskTimeTracking | null>(null);
  const [liveActiveSeconds, setLiveActiveSeconds] = useState(0);
  const [liveWorkedTodaySeconds, setLiveWorkedTodaySeconds] = useState(0);
  const [timerViewMode, setTimerViewMode] = useState<"day" | "task">("day");
  const [liveTaskActiveSeconds, setLiveTaskActiveSeconds] = useState(0);
  // The page header's own wall clock, not the elapsed-time stopwatch above -
  // minute resolution is all it needs, so a 30s tick (not liveActiveSeconds'
  // 1s one) is enough to never show a minute-stale reading.
  const [wallClockNow, setWallClockNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setWallClockNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingTimezone, setSavingTimezone] = useState(false);
  // Seeded from disk at startup (see get_app_settings below) so the picker
  // and header clock show the zone last chosen immediately - not this
  // machine's own zone - before get_member_profile resolves, or if it
  // fails. memberProfile.timezone wins the moment it loads; this is only
  // the bridge until then.
  const [cachedTimezone, setCachedTimezone] = useState("");
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
  const [projectsFailCount, setProjectsFailCount] = useState(0);
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  const projectsFailed = projectsFailCount > 0;
  const assignedTasksFailed = assignedTasksFailCount > 0;

  useEffect(() => {
    setAvatarError(false);
  }, [profile?.avatarUrl]);

  // U1 (PLAN-agent-auto-update H.2.6). Downloading and installing used to be
  // one call - downloadAndInstall() then relaunch() - which meant an update
  // arriving mid-shift restarted the agent while the timer was running.
  // relaunch() raises RunEvent::Exit, which calls controller.stop() and posts
  // "stop" to the API, so the session was closed server-side and did NOT
  // resume on restart: the employee silently lost tracked time and their
  // manager saw a gap.
  //
  // The two halves are now separate. Downloading is safe at any moment and
  // happens eagerly; installing waits for a point where restarting costs
  // nothing. An update that arrives while tracking simply sits staged until
  // the timer stops - including the stop that happens when the user quits.
  const pendingUpdateRef = useRef<Update | null>(null);
  const sessionOpenRef = useRef(false);

  // Read through a ref rather than a dependency: this is consulted from
  // callbacks that must see the *current* session, not the value captured when
  // the callback was created.
  const isSafeToApplyUpdate = useCallback(() => !sessionOpenRef.current, []);

  const applyStagedUpdate = useCallback(async () => {
    const staged = pendingUpdateRef.current;
    if (!staged || !isSafeToApplyUpdate()) return;
    pendingUpdateRef.current = null;
    try {
      await staged.install();
      await relaunch();
    } catch (err) {
      console.error("update install failed", err);
    }
  }, [isSafeToApplyUpdate]);

  const checkForUpdate = useCallback(
    async (manual = false) => {
      setCheckingUpdate(true);
      try {
        const update = pendingUpdateRef.current ?? (await check());
        if (!update) {
          if (manual) toast.message("You're up to date");
          return;
        }
        // Safe whatever the session state is: this only writes a verified
        // installer to disk. ponytail: staged in memory, so a restart before a
        // safe point just re-downloads ~4 MB - persisting it is H.2.4's job,
        // not U1's.
        if (pendingUpdateRef.current !== update) {
          await update.download();
          pendingUpdateRef.current = update;
        }
        if (isSafeToApplyUpdate()) {
          await applyStagedUpdate();
        } else if (manual) {
          toast.message("Update ready - it will install when you stop the timer");
        }
      } catch (err) {
        console.error("update check failed", err);
        if (manual) {
          toast.error("Couldn't check for updates. Try again later.");
        }
      } finally {
        setCheckingUpdate(false);
      }
    },
    [applyStagedUpdate, isSafeToApplyUpdate],
  );

  const signedIn = Boolean(profile?.signedIn);
  const staleSession = connection === "signedOut" && signedIn;
  const tracking =
    (session?.status || "").toLowerCase() === "active" ||
    (link?.status || "").toLowerCase().includes("active");
  const sessionOpen = tracking || paused;

  // Mirrors sessionOpen into the ref the update path reads, and applies a
  // staged update the moment the timer stops. A session that is *paused* still
  // counts as open: ending one mid-break looks exactly like the employee
  // stopped working.
  useEffect(() => {
    sessionOpenRef.current = sessionOpen;
    if (!sessionOpen) void applyStagedUpdate();
  }, [sessionOpen, applyStagedUpdate]);

  const refresh = useCallback(async () => {
    const [nextProfile, nextLink, nextSession, nextConnection, nextNotice, nextPaused] = await Promise.all([
      invoke<ProfileInfo>("get_profile"),
      invoke<LinkStatus>("get_link_status"),
      invoke<SessionInfo>("get_session").catch(() => null),
      invoke<ConnectionState>("get_connection_state").catch<ConnectionState>(() => "connected"),
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

  // usePolling below fires the very first list_projects/list_tasks call the
  // instant these mount - squarely inside the app's cold-start auth/session
  // setup, where a single lost race is common and self-resolves in a couple
  // seconds. Treating that first miss as final used to flip straight from
  // skeleton to "Couldn't load your X" with nothing recovering it until the
  // next 30s poll tick. These refs let a fail handler read the just-updated
  // count synchronously (a setState updater running the retry as a side
  // effect would get double-invoked under StrictMode) to decide: reveal the
  // failure only on a second consecutive miss, and in between, retry fast
  // instead of waiting out the full poll interval in silence.
  const projectsFailCountRef = useRef(0);
  const projectsQuickRetryRef = useRef(false);
  const assignedTasksFailCountRef = useRef(0);
  const assignedTasksQuickRetryRef = useRef(false);

  const refreshProjects = useCallback(async () => {
    if (!signedIn) {
      setProjects([]);
      setSelectedProjectId("");
      projectsFailCountRef.current = 0;
      setProjectsFailCount(0);
      return;
    }
    try {
      const next = await invoke<ProjectInfo[]>("list_projects");
      setProjects(next);
      projectsFailCountRef.current = 0;
      setProjectsFailCount(0);
      setProjectsLoaded(true);
      setSelectedProjectId((current) =>
        current && next.some((p) => p.id === current && !p.budgetExhausted) ? current : "",
      );
    } catch {
      // The list we already have is still the truest thing we know. Blanking it
      // turned every dropped poll into an empty sidebar with a "Couldn't load"
      // banner, which is exactly the flicker this avoids - the copy now only
      // appears once loaded, and loaded only flips on success or a second miss.
      projectsFailCountRef.current += 1;
      setProjectsFailCount(projectsFailCountRef.current);
      if (projectsFailCountRef.current >= 2) {
        setProjectsLoaded(true);
      } else if (!projectsQuickRetryRef.current) {
        projectsQuickRetryRef.current = true;
        window.setTimeout(() => {
          projectsQuickRetryRef.current = false;
          void refreshProjects();
        }, 3000);
      }
    }
  }, [signedIn]);

  const refreshAssignedTasks = useCallback(async () => {
    if (!signedIn) {
      setAssignedTasks([]);
      assignedTasksFailCountRef.current = 0;
      setAssignedTasksFailCount(0);
      return;
    }
    try {
      const next = await invoke<AgentTask[]>("list_tasks", { projectId: null });
      setAssignedTasks(next);
      assignedTasksFailCountRef.current = 0;
      setAssignedTasksFailCount(0);
      setAssignedTasksLoaded(true);
    } catch {
      assignedTasksFailCountRef.current += 1;
      setAssignedTasksFailCount(assignedTasksFailCountRef.current);
      if (assignedTasksFailCountRef.current >= 2) {
        setAssignedTasksLoaded(true);
      } else if (!assignedTasksQuickRetryRef.current) {
        assignedTasksQuickRetryRef.current = true;
        window.setTimeout(() => {
          assignedTasksQuickRetryRef.current = false;
          void refreshAssignedTasks();
        }, 3000);
      }
    }
  }, [signedIn]);

  const refreshDashboardSummary = useCallback(async () => {
    if (!signedIn) {
      setDashboardSummary(null);
      setDashboardLoaded(false);
      return;
    }
    try {
      const next = await invoke<DashboardSummary | null>("get_dashboard_summary");
      setDashboardSummary(next);
    } catch {
      /* Keeps the last summary on screen rather than collapsing the card. */
    } finally {
      setDashboardLoaded(true);
    }
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    if (!projectsLoaded || !assignedTasksLoaded) return;
    // Two consecutive failed rounds on both feeds, not one: a single dropped
    // request used to swap the whole window for the reconnect screen.
    if (projectsFailCount >= 2 && assignedTasksFailCount >= 2) {
      setConnection("disconnected");
    }
  }, [signedIn, projectsLoaded, assignedTasksLoaded, projectsFailCount, assignedTasksFailCount]);

  const refreshWorkspace = useCallback(async () => {
    if (!signedIn) {
      setWorkspace(null);
      return;
    }
    try {
      setWorkspace(await invoke<AgentWorkspace | null>("get_agent_workspace"));
    } catch {
      /* Holds the last workspace - see refreshProjects. */
    }
  }, [signedIn]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const isCallingProject = selectedProject ? selectedProject.hasTasks === false : false;
  const taskRequired = !isCallingProject && selectedProject?.requireTaskToTrack !== false;
  const taskLessSession = isCallingProject || (!taskRequired && !selectedTaskId);

  const tasks = useMemo(
    () =>
      !signedIn || !selectedProjectId || isCallingProject
        ? []
        : assignedTasks.filter((task) => task.projectId === selectedProjectId),
    [signedIn, selectedProjectId, isCallingProject, assignedTasks],
  );

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
    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      void refreshGuarded().catch(console.error);
    };
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
      /* Holds the last tracking figures - see refreshProjects. */
    }
  }, [selectedTaskId]);

  usePolling(true, 5000, refreshTaskTracking);

  const refreshMemberLimits = useCallback(async () => {
    if (!signedIn) return;
    try {
      setMemberLimits(
        await invoke<MemberLimits | null>("get_member_limits", {
          projectId: selectedProjectId || null,
        }),
      );
    } catch {
      /* Holds the last limits - see refreshProjects. */
    }
  }, [signedIn, selectedProjectId]);

  usePolling(view === "home" || view === "profile", 5000, refreshMemberLimits);

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
      /* Holds the last budget - see refreshProjects. */
    }
  }, [signedIn, selectedProjectId]);

  usePolling(view === "home" || view === "profile", 5000, refreshProjectBudget);

  usePolling(view === "home" || view === "profile", 30000, refreshProjects);
  usePolling(view === "home" || view === "profile", 30000, refreshAssignedTasks);
  usePolling(view === "home" || view === "profile", 60000, refreshDashboardSummary);
  usePolling(view === "home" || view === "profile", 60000, refreshWorkspace);

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
        taskId: null,
        date: logTimeDate,
        durationSeconds: Math.round(hours * 3600),
        description: logTimeDescription.trim(),
      });
      setLogTimeOpen(false);
      toast.success(`Logged ${fmtHours(Math.round(hours * 3600))}`);
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
      toast.error(err instanceof Error ? err.message : "Could not submit the timesheet");
    } finally {
      setSubmittingTimesheet(false);
    }
  };

  const refreshMemberProfile = useCallback(async () => {
    if (!signedIn) {
      setMemberProfile(null);
      return;
    }
    try {
      setMemberProfile(await invoke<MemberProfile | null>("get_member_profile"));
    } catch {
      // Keeps whatever was already loaded (including the timezone the
      // header clock and picker read) rather than blanking it on a dropped
      // request - same reasoning as refreshProjects/refreshAssignedTasks.
    }
  }, [signedIn]);

  useEffect(() => {
    void refreshMemberProfile();
  }, [refreshMemberProfile]);

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
    const next = taskTracking?.activeSeconds ?? 0;
    setLiveTaskActiveSeconds((s) => (tracking ? Math.max(s, next) : next));
  }, [taskTracking?.activeSeconds, tracking]);

  useEffect(() => {
    if (!tracking) return;
    const timer = window.setInterval(() => setLiveTaskActiveSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [tracking]);

  useEffect(() => {
    if (taskLessSession) setTimerViewMode("day");
  }, [taskLessSession]);

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
    if (!tracking || (session?.idleStage ?? 0) !== 0) return;
    const timer = window.setInterval(() => setLiveWorkedTodaySeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [tracking, session?.idleStage]);

  const prevIdleStageRef = useRef(0);
  useEffect(() => {
    const stage = session?.idleStage ?? 0;
    const prevStage = prevIdleStageRef.current;
    if (stage === 3 && prevStage < 3) {
      idleRewindFromRef.current = liveWorkedTodaySeconds;
      void notify(
        "Timer stopped",
        "Stopped after being idle longer than this project allows. The idle time was removed from your hours.",
      );
    }
    prevIdleStageRef.current = stage;
    // liveWorkedTodaySeconds is read at the moment of the transition only -
    // it must not retrigger this effect on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.idleStage]);

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
        if (s?.preferences?.memberTimezone) setCachedTimezone(s.preferences.memberTimezone);
      })
      .catch(() => {
        /* Falls back to "system", which is also the stored default. */
      });
  }, []);

  const handleCycleTheme = useCallback((next: ThemePreference) => {
    applyTheme(next);
    setThemePref(next);
    void invoke<AppSettingsView>("get_app_settings")
      .then((s) =>
        invoke("save_preferences", { preferences: { ...s.preferences, theme: next } }),
      )
      .catch(() => toast.error("Could not save your theme preference."));
  }, []);

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
      setSignInPassword("");
      setBusy(false);
    }
  };

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

  const handleStop = async (stopNote?: string, silent = false) => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await invoke<ActionResult>("stop_session", { stopNote: stopNote ?? null });
      if (!result.success) {
        const msg = result.error || "Could not stop session";
        setActionError(msg);
        toast.error(msg);
        return;
      }
      if (result.session) {
        setSession(result.session);
        toast.message("Tracking session paused");
      }
      setPaused(false);
      setStopNoteOpen(false);
      setStopNoteDraft("");
      if (!silent && liveWorkedTodaySeconds >= RECAP_MIN_SECONDS) {
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

  const handleStopClick = () => {
    if (selectedProject?.requireStopNote && tracking) {
      setStopNoteDraft("");
      setStopNoteOpen(true);
      return;
    }
    void handleStop();
  };

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
      if (result.selfAssigned) {
        toast.success(`"${result.task.title}" created`);
        jumpToAssignedTask(result.task);
      } else {
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

  useEffect(() => {
    if (!tracking || taskLessSession) return;
    if (taskTracking?.limitReached) {
      stopForTaskLimit(taskTracking.allowanceMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, taskLessSession, taskTracking?.limitReached, taskTracking?.allowanceMessage]);

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
  async function handleSelectTimezone(zone: string) {
    if (savingTimezone) return;
    setSavingTimezone(true);
    setActionError(null);
    try {
      await invoke("set_member_timezone", { timezone: zone });
      // The server accepted it (a rejected zone would have thrown above), so
      // this much is now safe to cache - unlike memberProfile.timezone
      // below, which still gets a real re-read rather than a local patch.
      setCachedTimezone(zone);
      // Re-read rather than patching locally: the server is what decides the
      // stored value, and a rejected zone must not leave the picker showing a
      // selection that was never saved.
      setMemberProfile(await invoke<MemberProfile | null>("get_member_profile"));
      // The zone decides when the daily/weekly allowance resets, so every cap
      // on screen is now stale. Pull them again instead of leaving the old
      // day's numbers up until the next poll ticks.
      await Promise.all([
        refreshMemberLimits(),
        refreshProjectBudget(),
        refreshTaskTracking(),
        refreshDashboardSummary(),
      ]);
    } catch (err) {
      setActionError(typeof err === "string" ? err : "Could not save your timezone.");
    } finally {
      setSavingTimezone(false);
    }
  }

  // The authoritative value the moment it loads; the cached one only bridges
  // the gap before that (or across a failed refresh) - see cachedTimezone.
  const displayTimezone = memberProfile?.timezone || cachedTimezone;
  const footerName = memberProfile?.name || displayName;
  const footerEmail = memberProfile?.email || profile?.email || "";
  const footerRole = memberProfile?.role || "";
  const selectedTask = tasks.find((t) => t.id === selectedTaskId);
  const trackingLabel = taskLessSession
    ? selectedProject?.name ?? ""
    : selectedTask?.title ?? "";

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

  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const jumpToAssignedTask = (task: AgentTask) => {
    if (busy || sessionOpen) return;
    if (task.projectId && task.projectId !== selectedProjectId) {
      setSelectedProjectId(task.projectId);
    }
    setSelectedTaskId(task.id);
  };

  const openTaskCountByProject = new Map<string, number>();
  for (const task of assignedTasks) {
    if (!task.projectId) continue;
    openTaskCountByProject.set(task.projectId, (openTaskCountByProject.get(task.projectId) ?? 0) + 1);
  }
  const jumpToProject = (project: ProjectInfo) => {
    if (busy || sessionOpen || project.budgetExhausted || project.id === selectedProjectId) return;
    setSelectedProjectId(project.id);
  };
  const projectProgressById = new Map(
    (dashboardSummary?.recentProjects ?? []).map((p) => [p.id, p.progress]),
  );
  for (const project of projects) {
    if (project.budgetSpentPercent != null) {
      projectProgressById.set(project.id, project.budgetSpentPercent);
    }
  }
  // recentProjects only covers whichever projects are "recent" by whatever
  // that means server-side - a project not in it simply has no entry here,
  // same tolerant-absence contract projectProgressById already has.
  const memberCountById = new Map(
    (dashboardSummary?.recentProjects ?? []).map((p) => [p.id, p.memberCount]),
  );

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
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    });
  }, [projects, projectSortRank]);

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
    assignedTotalLabel,
    assignedTotalDetail,
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

  const hoursTodayCards = (
    <div className="stats-stack page-content-swap" style={{ animationDelay: "0.04s" }}>
      {todayPanel}
      <div className={projectBudgetTile ? "stat-row-3" : "stat-row-3 stat-row-3-partial"}>
        {activityTile}
        {weekTile}
        {projectBudgetTile}
      </div>
    </div>
  );

  if (signedIn && monitoringNotice?.requiresAcknowledgement) {
    return (
      <MonitoringNoticePanel
        notice={monitoringNotice}
        busy={acceptingNotice}
        onAccept={() => void handleAcceptNotice()}
      />
    );
  }

  if ((connection === "disconnected" || staleSession) && !sessionOpen && view === "home") {
    return (
      <WelcomeBackPanel
        profile={profile}
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
    <main className="agent-tray">
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
        <div className="side-panel-scroll">
          <WeeklyActivityCard
            signedIn={signedIn}
            loading={!dashboardLoaded}
            dashboardSummary={dashboardSummary}
            weekActivityDash={weekActivityDash}
            weekActiveSeconds={weekActiveSeconds}
            weekIdleSeconds={weekIdleSeconds}
          />

          <TeamStatusCard team={workspace?.team ?? null} />

          <ManagementCard
            approvals={workspace?.approvals ?? null}
            pulse={workspace?.pulse ?? null}
            onOpenDashboard={() => void invoke("open_web_app")}
          />

          <ProjectsList
            signedIn={signedIn}
            loading={!projectsLoaded}
            projects={orderedProjects}
            selectedProjectId={selectedProjectId}
            busy={busy}
            sessionOpen={sessionOpen}
            openTaskCountByProject={openTaskCountByProject}
            projectProgressById={projectProgressById}
            memberCountById={memberCountById}
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

        <div className="side-panel-pinned">
          {loadingProfile ? (
            <div className="side-skeleton side-panel-swap" aria-hidden="true">
              <span className="skeleton-bar skeleton-bar-lg" />
              <span className="skeleton-bar" />
            </div>
          ) : (
            <>
              {/* The placeholder for this list lives in ProjectsList itself,
                  where the rows actually appear - it used to sit down here
                  next to the Start button, nowhere near what it stood in for. */}
              {projects.length === 0 && projectsLoaded ? (
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
                <span className="page-header-clock">
                  {fmtWallClock(wallClockNow, displayTimezone || undefined)}
                  <span className="page-header-date">{fmtWallDate(wallClockNow, displayTimezone || undefined)}</span>
                </span>
                <h2 className="page-title">{trackingLabel || "Time Tracking"}</h2>
              </div>
              <div className="page-header-actions">
                <AssignedTodayBadge
                  memberLimits={memberLimits}
                  assignedTodayLabel={assignedTodayLabel}
                  assignedTaskCountLabel={assignedTaskCountLabel}
                  assignedCarriedLabel={assignedCarriedLabel}
                />
                <AssignedToMeBadge
                  assignedTotalLabel={assignedTotalLabel}
                  assignedTotalDetail={assignedTotalDetail}
                />
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
                    {tracking ? "Elapsed · Tracking" : paused ? "On a break" : "Not tracking"}
                    {timerViewMode === "task" ? " · whole task" : ""}
                  </span>
                  {!taskLessSession && taskTracking ? (
                    <button
                      type="button"
                      className={`icon-btn${timerViewMode === "task" ? " active" : ""}`}
                      title={timerViewMode === "task" ? "Switch to today's time" : "Switch to whole-task time"}
                      aria-label={timerViewMode === "task" ? "Switch to today's time" : "Switch to whole-task time"}
                      aria-pressed={timerViewMode === "task"}
                      style={{ alignSelf: "center" }}
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
                  <TimezonePicker
                    value={displayTimezone}
                    onSelect={handleSelectTimezone}
                    saving={savingTimezone}
                  />
                </div>

                {hoursTodayCards}

                <TaskProgressPanel
                  taskLessSession={taskLessSession}
                  taskTracking={taskTracking}
                  taskPriority={taskDetail?.priority ?? ""}
                  taskEstimateSeconds={taskEstimateSeconds}
                  taskRegularPercent={taskRegularPercent}
                  taskOvertimePercent={taskOvertimePercent}
                  taskWorkedPercent={taskWorkedPercent}
                  taskIntoOvertime={taskIntoOvertime}
                  taskScheduleLabel={taskScheduleLabel}
                  taskBudgetRemainingLabel={taskBudgetRemainingLabel}
                />

                {taskLessSession ? (
                  <ProjectDetailPanel project={selectedProject} />
                ) : (
                  <TaskDetailPanel detail={taskDetail} />
                )}

                {idleStage >= 3 ? (
                  <p className={`page-idle-banner stage-${idleStage}`}>
                    Timer stopped after being idle longer than this project allows. The idle time was removed from your hours.
                  </p>
                ) : null}

                {taskTracking?.limitReached ? (
                  <p className="page-limit-banner">
                    {taskTracking.allowanceMessage || "Maximum allowed work time reached."}
                  </p>
                ) : null}
              </>
            ) : !projectsLoaded || !assignedTasksLoaded ? (
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
