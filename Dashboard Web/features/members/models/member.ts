export type MemberStatus = "active" | "inactive" | "paused" | "banned"
export type MemberRole =
  | "Owner"
  | "Super Admin"
  | "Admin"
  | "Super Manager"
  | "Manager"
  | "Employee L2"
  | "Employee L1"
  | "Employee L0"
  | "Client"
  | "Viewer"
  | string
export type TrackingStatus = "online" | "idle" | "offline"
export type InviteStatus = "Pending" | "Expired" | "Joined" | "Awaiting signup" | "Pending sign-in"

export type InviteListKind = "invite" | "pending_account"

export interface Member {
  id: string
  /** Stable UUID for this member (FK for related rows). Assigned on create or first save. */
  memberUid?: string
  /** Firebase Auth UID when this member is linked to an auth user. */
  firebaseUid?: string
  /** Raw creator marker from backend (`created_by`). */
  createdBy?: string
  /** UID of the user who created this member/group entry when available. */
  createdByUid?: string
  name: string
  email: string
  /** Work email from members row; personal email when stored separately. */
  personalEmail?: string
  /** Phone / mobile from members row or member field data. */
  phone?: string
  /** True when the stored phone number has passed verification. */
  phoneVerified?: boolean
  /** Profile photo URL (Firebase Auth / Storage) when available. */
  avatarUrl?: string
  /** Last IP observed at sign-in (server-tracked; read-only in Info tab). */
  lastIp?: string
  avatar: string
  avatarColor: string
  status: MemberStatus
  role: MemberRole
  /** Canonical role from Backend `member_roles` / `roles` enrichment. */
  role_name?: string
  /** Optional product privileges stored on the member document. */
  privileges?: {
    manage_employee_teams?: boolean
  }
  /** Backend hierarchy placement status (`unassigned`, `assigned`, `hierarchy_assignment_required`). */
  hierarchy_status?: string
  projects: number
  payment: string
  limits: string
  trackingStatus: TrackingStatus
  dateAdded: string
  /** Number of teams this member belongs to (list view). */
  teams: number
  /** Team display names for manage modal / detail (from API `team_names`). */
  teamNames?: string[]
  /** Project IDs this member belongs to (from API `project_ids`). */
  projectIds?: string[]
  weeklyLimit: string
}

export interface Invite {
  id: string
  email: string
  role: MemberRole
  teams: string
  projects: number
  payment: string
  weeklyLimit: string
  status: InviteStatus
  /** Pre-provisioned Auth users (pending_auth_members) vs email/open-link rows in `invites`. */
  listKind?: InviteListKind
  inviteKind?: "email" | "open_link" | "preprovision"
  expiresAt?: string
  createdByUid?: string
}

export interface OnboardingMember {
  email: string
  createdAccount: boolean
  downloadedApp: boolean
  trackedTime: boolean
}

export type InviteFormRow = { email: string; payRate: string }
/** Sent to API (member display name). */
export type AccountFormRow = { name: string; email: string; payRate: string }
/** Local fields for create-account modal. */
export type AccountFormFields = { firstName: string; lastName: string; email: string; payRate: string }

export type AddMembersSubmission =
  | {
      mode: "invites"
      rows: InviteFormRow[]
      role: MemberRole
    }
  | {
      mode: "accounts"
      rows: AccountFormRow[]
      role: MemberRole
      sendWelcomeEmail: boolean
    }

export type AddMembersResult =
  | {
      mode: "invites"
      count: number
      emailsSent: number
      emailsFailed: number
      inviteUrls: string[]
      emailConfigured: boolean
      emailChannel?: string
    }
  | {
      mode: "accounts"
      email: string
      emailSent: boolean
      tempPassword?: string
    }

export type MemberPatchBody = {
  name?: string
  email?: string
  payRate?: number
  weeklyLimit?: string
  role?: MemberRole
  status?: MemberStatus
  trackingStatus?: TrackingStatus
  lastIp?: string
}

export type MemberManageTab = "info" | "employment" | "roles" | "payBill" | "workLimits" | "settings"

export type MemberEntryAction =
  | "edit-info"
  | "edit-role"
  | "edit-payment"
  | "edit-limits"
  | "disable-tracking"
  | "reset-password"
  | "remove-from-tree"
  | "remove-member"

export type InvitePatchBody = { email?: string; payRate?: number; weeklyLimit?: string; role?: MemberRole }

export type InviteRowAction = "resend-email" | "copy-link" | "renew" | "edit" | "delete"
