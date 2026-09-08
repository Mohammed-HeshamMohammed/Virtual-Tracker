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
  hasLaunchedBefore: boolean;
  trayNoticeShown: boolean;
  theme: ThemePreference;
  memberTimezone: string;
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
  projectId: string;
};

export type ProjectInfo = {
  id: string;
  name: string;
  projectType: string;
  hasTasks: boolean;
  requireTaskToTrack: boolean;
  requireStopNote: boolean;
  budgetExhausted: boolean;
  budgetSpentPercent: number | null;
  canCreateTasks: boolean;
};

export type CreateTaskResult = {
  task: AgentTask;
  selfAssigned: boolean;
};

export type SessionInfo = {
  id?: string | null;
  status: string;
  taskId?: string | null;
  taskTitle?: string | null;
  projectId?: string | null;
  idleStage?: number;
  activeSeconds?: number;
  idleSeconds?: number;
};

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
  sharedBudget?: boolean;
};

export type ProjectBudgetStatus = {
  scope: "per_person" | "shared";
  capSeconds: number;
  spentSeconds: number;
  remainingSeconds: number;
};

export type AssignedToday = {
  demandSeconds: number;
  plannedSeconds: number;
  deferredSeconds: number;
  rolloverSeconds: number;
  taskCount: number;
  byProjectType: { normal: number; calling: number };
};

/** Everything open across every project - the un-scheduled counterpart to
 *  AssignedToday. workedSeconds is not clamped to the estimate, so it can
 *  exceed assignedSeconds on an overrun. */
export type AssignedTotal = {
  assignedSeconds: number;
  workedSeconds: number;
  remainingSeconds: number;
  taskCount: number;
  projectCount: number;
};

export type MemberLimits = {
  dailyHours: number;
  weeklyHours: number;
  usesShifts: boolean;
  workedTodaySeconds: number;
  workedWeekSeconds: number;
  allowedRemainingSeconds: number | null;
  limitReached: boolean;
  assignedToday: AssignedToday;
  assignedTotal: AssignedTotal;
  workingToday: boolean;
  isMakeupDay: boolean;
  todayActivity: TodayActivity;
  projectTodayActivity: TodayActivity | null;
};

export type TodayActivity = { activeSeconds: number; idleSeconds: number };


export type TimeOffBalance = {
  policyId: string;
  policyName: string;
  balanceDays: number;
  entitlementDays: number;
};

export type TimesheetStatus = {
  periodStart: string;
  periodEnd: string;
  status: string;
  totalHours: number;
};

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

export type WorkspaceTeam = {
  teamCount: number;
  members: TeamMemberStatus[];
  trackingNowCount: number;
  notStartedCount: number;
  totalActiveSecondsToday: number;
};

export type WorkspaceApprovals = { pendingCount: number };

export type WorkspacePulse = {
  totalActiveSecondsToday: number;
  trackingNowCount: number;
  membersWorkedTodayCount: number;
};

export type WorkspaceCapabilities = {
  canLogManualTime: boolean;
};

export type AgentWorkspace = {
  self: WorkspaceSelf;
  team: WorkspaceTeam | null;
  approvals: WorkspaceApprovals | null;
  pulse: WorkspacePulse | null;
  capabilities: WorkspaceCapabilities;
};

export type ScreenshotRef = {
  id: string;
  capturedAt: string | null;
};

export type TaskSubtask = {
  id: string;
  title: string;
  completed: boolean;
};

export type TaskDetail = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string;
  subtasks: TaskSubtask[];
};

export type MemberProfile = {
  name: string;
  email: string;
  avatarUrl: string;
  role: string;
  status: string;
  dateAdded: string;
  phone: string;
  teams: number;
  /** Member's own IANA zone (`members.timezone`); "" when never set. */
  timezone: string;
};

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
