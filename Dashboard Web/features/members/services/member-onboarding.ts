import { apiFetch, extractApiError, readJsonSafe, type ApiEnvelope } from "@/infrastructure/api/http"
import { getApiBaseUrl } from "@/infrastructure/api/url"

const API_BASE = getApiBaseUrl()

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

export async function getMemberOnboarding(): Promise<MemberOnboardingRow[]> {
  const res = await apiFetch(`${API_BASE}/api/member-onboarding`)
  const json = await readJsonSafe<ApiEnvelope<MemberOnboardingRow[]>>(res)
  if (!res.ok || json?.success !== true) {
    throw extractApiError(res.status, "Failed to fetch member onboarding", json)
  }
  return Array.isArray(json.data) ? json.data : []
}

export async function sendMemberOnboardingReminder(id: string, updatedBy?: string): Promise<MemberOnboardingRow> {
  const res = await apiFetch(`${API_BASE}/api/member-onboarding/${encodeURIComponent(id)}/reminder`, {
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
