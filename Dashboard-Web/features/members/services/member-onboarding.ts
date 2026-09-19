import { apiFetch, extractApiError, readJsonSafe, type ApiEnvelope } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"


export interface MemberOnboardingRow {
  id: string
  memberId: string | null
  inviteId: string | null
  email: string
  createdAccount: boolean
  downloadedApp: boolean
  trackedTime: boolean
  lastReminderSentAt: string | null
  source: "member" | "invite" | "unknown"
}

export type AgentVersionStatus = "latest" | "outdated" | "unknown" | "unrecognized"

export interface AgentVersionMember {
  memberId: string
  displayName: string
  email: string
  agentVersion: string | null
  agentPlatform: string | null
  agentLastOpenedAt: string | null
  status: AgentVersionStatus
  supportsAgentInbox: boolean
  canReceiveEmail: boolean
}

export interface AgentVersionGroup {
  key: string
  version: string | null
  status: AgentVersionStatus
  memberCount: number
  members: AgentVersionMember[]
}

export interface AgentVersionsResponse {
  latestVersion: string
  groups: AgentVersionGroup[]
}

export interface AgentReminderSummary {
  sent: number
  current: number
  duplicate: number
  unsupported: number
  missingEmail: number
  failed: number
}

export async function getMemberOnboarding(): Promise<MemberOnboardingRow[]> {
  const res = await apiFetch(apiPath("/api/member-onboarding"))
  const json = await readJsonSafe<ApiEnvelope<MemberOnboardingRow[]>>(res)
  if (!res.ok || json?.success !== true) {
    throw extractApiError(res.status, "Failed to fetch member onboarding", json)
  }
  return Array.isArray(json.data) ? json.data : []
}

export async function sendMemberOnboardingReminder(id: string, updatedBy?: string): Promise<MemberOnboardingRow> {
  const res = await apiFetch(apiPath(`/api/member-onboarding/${encodeURIComponent(id)}/reminder`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updatedBy }),
  })
  const json = await readJsonSafe<ApiEnvelope<MemberOnboardingRow>>(res)
  if (!res.ok || json?.success !== true || !json.data) {
    throw extractApiError(res.status, "Failed to send onboarding reminder", json)
  }
  return json.data
}

export async function getAgentVersions(): Promise<AgentVersionsResponse> {
  const res = await apiFetch(apiPath("/api/agent-versions"))
  const json = await readJsonSafe<{
    success?: boolean
    error?: string
    latestVersion?: string
    groups?: AgentVersionGroup[]
  }>(res)
  if (!res.ok || json?.success !== true || typeof json.latestVersion !== "string" || !Array.isArray(json.groups)) {
    throw extractApiError(res.status, "Failed to load tracker versions", json)
  }
  return { latestVersion: json.latestVersion, groups: json.groups }
}

export async function sendAgentUpdateReminder(
  memberId: string,
  channel: "app" | "email",
): Promise<{ status: string }> {
  const res = await apiFetch(apiPath(`/api/members/${encodeURIComponent(memberId)}/agent-update-reminders`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel }),
  })
  const json = await readJsonSafe<{ success?: boolean; error?: string; status?: string }>(res)
  if (!res.ok || json?.success !== true) {
    throw extractApiError(res.status, "Failed to send update reminder", json)
  }
  return { status: json.status || "sent" }
}

export async function sendAgentVersionReminders(
  version: string,
  channel: "app" | "email",
): Promise<AgentReminderSummary> {
  const res = await apiFetch(apiPath(`/api/agent-versions/${encodeURIComponent(version)}/reminders`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel }),
  })
  const json = await readJsonSafe<{ success?: boolean; error?: string; summary?: AgentReminderSummary }>(res)
  if (!res.ok || json?.success !== true || !json.summary) {
    throw extractApiError(res.status, "Failed to send version reminders", json)
  }
  return json.summary
}

export async function sendAgentInstallEmail(memberId: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/members/${encodeURIComponent(memberId)}/agent-install-email`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  const json = await readJsonSafe<{ success?: boolean; error?: string }>(res)
  if (!res.ok || json?.success !== true) {
    throw extractApiError(res.status, "Failed to send install instructions", json)
  }
}

export async function sendUnknownAgentInstallEmails(): Promise<AgentReminderSummary> {
  const res = await apiFetch(apiPath("/api/agent-versions/unknown/install-email"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  const json = await readJsonSafe<{ success?: boolean; error?: string; summary?: AgentReminderSummary }>(res)
  if (!res.ok || json?.success !== true || !json.summary) {
    throw extractApiError(res.status, "Failed to send install instructions", json)
  }
  return json.summary
}
