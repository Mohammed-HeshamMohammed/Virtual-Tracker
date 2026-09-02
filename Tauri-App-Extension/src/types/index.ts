export type ProfileInfo = {
  signedIn: boolean;
  linkPending?: boolean;
  name: string;
  email?: string;
  avatarUrl: string;
  serverLabel: string;
};

export type LinkStatus = {
  connected: boolean;
  serverLabel: string;
  status: string;
};

export type SignInResult = {
  success: boolean;
  error?: string;
};

export type AuthView = "signin" | "signup" | "forgot";

export type SignUpFields = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export type SignUpState = SignUpFields & {
  busy: boolean;
  error: string | null;
  success: string | null;
};

export type ForgotState = {
  email: string;
  busy: boolean;
  error: string | null;
  success: string | null;
};

export type ThemePreference = "system" | "light" | "dark";

export type UserPreferences = {
  launchAtLogin: boolean;
  startHidden: boolean;
  autoSignIn: boolean;
  closeToTray: boolean;
  /** Internal bookkeeping, not user-facing: gates first-run visibility and the one-time tray notice. */
  hasLaunchedBefore: boolean;
  trayNoticeShown: boolean;
  /** Mirrors Dashboard-Web's light/dark/system. Stored server-side of the
   *  webview (Rust prefs) so it survives a reinstall like the rest. */
  theme: ThemePreference;
};

export type AppSettingsView = {
  version: string;
  preferences: UserPreferences;
  logPath: string;
};

export type AgentTask = {
  id: string;
  title: string;
  status: string;
  /** Empty for a task fetched already scoped to one project (the dropdown's
   *  own call). Populated when list_tasks is called with no project filter,
   *  which is how the sidebar's cross-project "Your tasks" list is built. */
  projectId: string;
};

export type ProjectInfo = {
  id: string;
  name: string;
  // Free-form on purpose: the backend owns the set of project types
  // (project-types.js) and the agent only cares whether this one has tasks,
  // which hasTasks answers directly. Pinning a union here meant every new
  // type needed an agent release just to be recognized.
  projectType: string;
  // Whether the project has a task list at all. False for calling/support,
  // where the timer runs against the project itself.
  hasTasks: boolean;
  // Per-project override: false lets a normal project track without picking
  // a task, the way a calling project already does.
  requireTaskToTrack: boolean;
  // Prompts for a short note when the member stops their timer.
  requireStopNote: boolean;
  // This project's Hours budget is spent - it stays in the list, shown as
  // unselectable with a reason, rather than silently vanishing.
  budgetExhausted: boolean;
  // Real spend / target as a 0-100+ percent. null when there's no budget
  // configured, or nothing to divide by - distinct from 0, a budget that's
  // real but genuinely untouched. Preferred over recentProjects' own
  // task-completion percent whenever present: that one reads 0% for any
  // project with no task marked done yet, indistinguishable from a project
  // nothing has happened on at all, even when its budget shows real spend.
  budgetSpentPercent: number | null;
  // Server-derived from viewerCanCreateProjectTasks (org admin, or this
  // member's own project_role = "manager" on this project) - gates the
  // "+ New task" row action so it only shows where the create call would
  // actually succeed, instead of every viewer seeing an affordance that
  // 403s for everyone but managers.
  canCreateTasks: boolean;
};

export type CreateTaskResult = {
  task: AgentTask;
  // False when the task was created but self-assignment failed (a separate,
  // stricter server-side gate - see create_task's own doc comment on the
  // Rust side). The task is real either way; this only says whether it will
  // show up in "Your tasks" without someone else assigning it first.
  selfAssigned: boolean;
};

export type SessionInfo = {
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
export type MonitoringNoticeView = {
  version: string;
  text: string;
  requiresAcknowledgement: boolean;
};

export type ConnectionState = "connected" | "disconnected" | "signedOut";

export type ReconnectResult = {
  success: boolean;
  needsRelink: boolean;
  error?: string;
};

export type ActionResult = {
  success: boolean;
  error?: string;
  session?: SessionInfo;
};

export type TaskTimeTracking = {
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
  /** When true, activeSeconds/estimatedSeconds above are the whole task's
   * pooled total across every assignee combined, not just this member's own. */
  sharedBudget?: boolean;
};

/** GET /api/projects/:id/budget-status - a project's Hours-based budget
 * remaining, resolved for the current viewer. `null` means no Hours-based
 * budget is configured on this project at all. */
export type ProjectBudgetStatus = {
  /** "per_person": remaining is this viewer's own allotment/spend.
   * "shared": remaining is the whole team's pooled allotment/spend. */
  scope: "per_person" | "shared";
  capSeconds: number;
  spentSeconds: number;
  remainingSeconds: number;
};

/** T5 (PLAN-livesyncandagenttimer.md §11) - "how much work is assigned to
 * me today", distinct from allowedRemainingSeconds's "how much am I still
 * allowed to work". demandSeconds includes rollover from earlier days;
 * plannedSeconds is what fits under the member's own cap; deferredSeconds
 * is what got pushed to later days - never dropped. */
export type AssignedToday = {
  demandSeconds: number;
  plannedSeconds: number;
  deferredSeconds: number;
  rolloverSeconds: number;
  taskCount: number;
  byProjectType: { normal: number; calling: number };
};

export type MemberLimits = {
  dailyHours: number;
  weeklyHours: number;
  usesShifts: boolean;
  workedTodaySeconds: number;
  workedWeekSeconds: number;
  /** null = no cap applies. Not the same as 0 seconds left. */
  allowedRemainingSeconds: number | null;
  limitReached: boolean;
  assignedToday: AssignedToday;
  /** Work Time & Limits > "Working days" - false blocks starting/resuming. */
  workingToday: boolean;
  /** True when today is only worked because of a flagged makeup day. */
  isMakeupDay: boolean;
  /** Today's active/idle split - the ratio the dashboard grades activity on.
   *  Both zero means nothing tracked today (or an older backend). */
  todayActivity: TodayActivity;
  /** Same split as todayActivity, scoped to whichever project_id was passed
   *  to get_member_limits - null when no project was asked about, or on an
   *  older backend without this field. Feeds the main pane's Activity ring
   *  ("current project"), separate from todayActivity's person-wide total. */
  projectTodayActivity: TodayActivity | null;
};

export type TodayActivity = { activeSeconds: number; idleSeconds: number };

// ── Agent workspace (GET /api/activity/workspace) ─────────────────────────
// Everything the agent shows beyond the timer itself, resolved per-role
// server-side. Every section but `self` is nullable: the backend omits
// whichever the viewer isn't entitled to, so the UI renders what arrived and
// carries no role logic of its own (and can't be tricked into showing a
// section by a spoofed local role).

export type TimeOffBalance = {
  /** What a request is filed against - travels with the balance so the
   *  request dialog needs no second fetch. */
  policyId: string;
  policyName: string;
  balanceDays: number;
  entitlementDays: number;
};

/** The member's most recent timesheet, whatever state it's in. */
export type TimesheetStatus = {
  periodStart: string;
  periodEnd: string;
  /** draft | submitted | approved | rejected */
  status: string;
  totalHours: number;
};

/** hourlyRate 0 = no rate configured (or not visible) - the UI hides the
 *  card rather than showing an authoritative-looking $0.00. */
export type EarningsSummary = {
  currency: string;
  hourlyRate: number;
  weekAmount: number;
  monthAmount: number;
};

export type WorkspaceSelf = {
  timeOff: TimeOffBalance[];
  timesheet: TimesheetStatus | null;
  earnings: EarningsSummary;
};

export type TeamMemberStatus = {
  memberId: string;
  name: string;
  trackingNow: boolean;
  onBreak: boolean;
  activeSecondsToday: number;
};

/** Present only for a viewer flagged `is_lead` on at least one team. */
export type WorkspaceTeam = {
  teamCount: number;
  members: TeamMemberStatus[];
  trackingNowCount: number;
  /** Worked nothing at all today and isn't tracking - the number a lead
   *  actually chases, distinct from "idle right now". */
  notStartedCount: number;
  totalActiveSecondsToday: number;
};

/** Present only for a management role. */
export type WorkspaceApprovals = { pendingCount: number };

/** Present only for an org-admin role (Super Manager and up). */
export type WorkspacePulse = {
  totalActiveSecondsToday: number;
  trackingNowCount: number;
  membersWorkedTodayCount: number;
};

/** Server-decided permissions for controls the agent renders. Decided there,
 *  not from the agent's own copy of the role, so a spoofed local role cannot
 *  reveal a control. */
export type WorkspaceCapabilities = {
  /** Manager and above only. */
  canLogManualTime: boolean;
};

export type AgentWorkspace = {
  self: WorkspaceSelf;
  team: WorkspaceTeam | null;
  approvals: WorkspaceApprovals | null;
  pulse: WorkspacePulse | null;
  capabilities: WorkspaceCapabilities;
};

/** One captured screenshot, without its bytes - the image is fetched one at
 *  a time via get_screenshot_image, which returns a ready `data:` URL. */
export type ScreenshotRef = {
  id: string;
  capturedAt: string | null;
};

export type TaskSubtask = {
  id: string;
  title: string;
  completed: boolean;
};

/** The open task's own detail - what you're actually meant to be doing. */
export type TaskDetail = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string;
  subtasks: TaskSubtask[];
};

// The viewer's own People-page member record - richer than what's in the
// Firebase JWT claims (role, status, date added, team count).
export type MemberProfile = {
  name: string;
  email: string;
  avatarUrl: string;
  role: string;
  status: string;
  dateAdded: string;
  phone: string;
  teams: number;
};

// The same GET /api/dashboard/general payload that feeds the web
// dashboard's own personal/general view - only its "me" slice ever reaches
// the agent (see Rust's DashboardSummary), so these widgets show exactly
// what the member already sees on the web, not a re-derived approximation.
export type WeeklyActivityDay = {
  key: string;
  label: string;
  activeHours: number;
  idleHours: number;
};

export type RecentProjectSummary = {
  id: string;
  name: string;
  progress: number;
  memberCount: number;
};

export type DashboardSummary = {
  activityWeekPercent: number;
  weeklyActivity: WeeklyActivityDay[];
  recentProjects: RecentProjectSummary[];
};

export type DropdownOption = {
  id: string;
  label: string;
  disabled?: boolean;
};
