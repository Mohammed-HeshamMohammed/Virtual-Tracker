import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import { extractRoleFromRecord } from "@/features/auth/permissions/member-role-access"
import {
  AuthGateError,
  parseAuthSessionErrorCode,
  parseAuthSessionErrorMessage,
} from "@/features/auth/services/auth-session-errors"
import type { Member } from "@/features/members/models/member"

export type BootstrapPermissions = {
  canAccessAllSidebarTabs: boolean
  canManageProjects: boolean
  canManageClients: boolean
  canManageMembers: boolean
  canCreateTransferRequests?: boolean
  hierarchyAssignmentRequired?: boolean
  canAccessReviewCenter: boolean
  canSeePmTasksSection: boolean
  canCreateTasks: boolean
  isManagementRole: boolean
}

export type BootstrapPayload = {
  user: {
    uid: string
    email: string | null
    displayName: string | null
    mustChangePassword?: boolean
  }
  member: {
    id: string
    name: string
    email: string
    status: string
    role: string
    role_name: string
    hierarchy_status?: string
    firebaseUid?: string
  }
  role: {
    name: string
    normalized: string
    rank: number
  }
  permissions: BootstrapPermissions
  workspace: {
    displayName: string
    defaultNavItem: string
  }
  featureFlags: {
    progressiveDashboard: boolean
    backgroundBootstrap: boolean
  }
  dashboardSummary: {
    ready: boolean
    scoped: boolean
    projects: number
    tasks: number
    members: number | null
    teams: number
  }
}

function normalizeBootstrapMember(raw: BootstrapPayload["member"]): Member {
  const name = raw.name?.trim() || "Member"
  const email = raw.email?.trim() || ""
  const role = extractRoleFromRecord(raw as unknown as Record<string, unknown>)
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "??"
  return {
    id: raw.id,
    memberUid: raw.id,
    firebaseUid: raw.firebaseUid,
    name,
    email,
    avatar: initials,
    avatarColor: "#3b82f6",
    status: (raw.status as Member["status"]) || "active",
    role: role as Member["role"],
    role_name: role,
    hierarchy_status: typeof raw.hierarchy_status === "string" ? raw.hierarchy_status : undefined,
    projects: 0,
    payment: "$0/hr",
    limits: "No limit",
    trackingStatus: "offline",
    dateAdded: "",
    teams: 0,
    teamNames: [],
    createdBy: "",
    createdByUid: "",
    personalEmail: "",
    phone: "",
    avatarUrl: "",
    lastIp: "",
    weeklyLimit: "",
  }
}

export async function fetchBootstrapSession(): Promise<{
  payload: BootstrapPayload
  member: Member
}> {
  const res = await apiFetch(apiPath("/api/bootstrap"))
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean
    error?: string
    code?: string
    data?: BootstrapPayload
  }
  if (!res.ok || !json.success || !json.data?.member?.id) {
    const err = parseAuthSessionErrorMessage(json, json.error || `HTTP ${res.status}`)
    const code = parseAuthSessionErrorCode(json) ?? "BOOTSTRAP_FAILED"
    throw new AuthGateError(err, code)
  }
  const member = normalizeBootstrapMember(json.data.member)
  return { payload: json.data, member }
}
