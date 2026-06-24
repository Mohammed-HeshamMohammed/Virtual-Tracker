import { apiFetch } from "@/infrastructure/api/http"
import { getApiBaseUrl } from "@/infrastructure/api/url"

export type MemberBanRecord = {
  id: string
  memberId: string
  memberName: string
  email: string
  reason: string
  ipAddress: string
  bannedAt: string | null
  bannedByMemberId: string
  bannedByName: string
  emailSent: boolean
}

type ApiListResponse = {
  success?: boolean
  data?: MemberBanRecord[]
  error?: string
}

type ApiBanResponse = {
  success?: boolean
  data?: MemberBanRecord
  error?: string
}

type ApiRevokeResponse = {
  success?: boolean
  data?: { id: string; memberId: string; revokedAt: string }
  error?: string
}

export async function fetchMemberBans(): Promise<MemberBanRecord[]> {
  const res = await apiFetch(`${getApiBaseUrl()}/api/member-bans`)
  const json = (await res.json().catch(() => ({}))) as ApiListResponse
  if (!res.ok || !json.success) {
    throw new Error(json.error || `Failed to load bans (HTTP ${res.status})`)
  }
  return Array.isArray(json.data) ? json.data : []
}

export async function banMember(input: { memberId: string; reason: string }): Promise<MemberBanRecord> {
  const res = await apiFetch(`${getApiBaseUrl()}/api/member-bans`, {
    method: "POST",
    body: JSON.stringify(input),
  })
  const json = (await res.json().catch(() => ({}))) as ApiBanResponse
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json.error || `Failed to ban member (HTTP ${res.status})`)
  }
  return json.data
}

export async function revokeMemberBan(banId: string): Promise<void> {
  const res = await apiFetch(`${getApiBaseUrl()}/api/member-bans/${encodeURIComponent(banId)}/revoke`, {
    method: "POST",
    body: JSON.stringify({}),
  })
  const json = (await res.json().catch(() => ({}))) as ApiRevokeResponse
  if (!res.ok || !json.success) {
    throw new Error(json.error || `Failed to revoke ban (HTTP ${res.status})`)
  }
}
