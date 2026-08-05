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

export type UserPreferences = {
  launchAtLogin: boolean;
  startHidden: boolean;
  autoSignIn: boolean;
  closeToTray: boolean;
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
};

export type ProjectInfo = {
  id: string;
  name: string;
  // "calling" projects have no tasks — the timer runs against the project.
  projectType: "normal" | "calling";
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

export type DropdownOption = {
  id: string;
  label: string;
  disabled?: boolean;
};
