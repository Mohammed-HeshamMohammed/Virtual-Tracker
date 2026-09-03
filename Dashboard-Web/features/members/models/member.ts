export type MemberStatus = "active" | "inactive" | "paused" | "banned"
export type MemberRole =
  | "Owner"
  | "Super Admin"
  | "Admin"
  | "Super Manager"
  | "Manager"
  | "Team Lead"
  | "Employee"
  | "Intern"
  | "Client"
  | "Viewer"
  | string
export type TrackingStatus = "online" | "idle" | "offline"
export type InviteStatus = "Pending" | "Expired" | "Joined" | "Awaiting signup" | "Pending sign-in"

export type InviteListKind = "invite" | "pending_account"

export interface Member {
  id: string
  memberUid?: string
  firebaseUid?: string
  createdBy?: string
  createdByUid?: string
  name: string
  email: string
  personalEmail?: string
  phone?: string
  phoneVerified?: boolean
  avatarUrl?: string
  lastIp?: string
  avatar: string
  avatarColor: string
  status: MemberStatus
  role: MemberRole
  role_name?: string
  privileges?: {
    manage_employee_teams?: boolean
  }
  hierarchy_status?: string
  projects: number
  payment: string
  limits: string
  trackingStatus: TrackingStatus
  dateAdded: string
  teams: number
  teamNames?: string[]
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

export type InviteFormRow = { email: string; payRate: string; currency: string }
export type AccountFormRow = { name: string; email: string; payRate: string; currency: string }
export type AccountFormFields = { firstName: string; lastName: string; email: string; payRate: string; currency: string }

export type MigratableAuthUser = {
  uid: string
  email: string
  displayName: string
  phoneNumber: string
  creationTime: string | null
  avatarUrl?: string
  suggestedRole?: MemberRole
}

export type MigrateResultRow = { uid: string; success: boolean; memberId?: string; error?: string }

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
  | {
      mode: "migrate"
      migrations: { uid: string; role: MemberRole }[]
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
  | {
      mode: "migrate"
      results: MigrateResultRow[]
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

export type InvitePatchBody = { email?: string; payRate?: number; currency?: string; weeklyLimit?: string; role?: MemberRole }

export type InviteRowAction = "resend-email" | "copy-link" | "renew" | "edit" | "delete"
