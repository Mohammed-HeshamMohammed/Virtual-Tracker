import { apiFetch } from "@/infrastructure/api/http"
import { getApiBaseUrl } from "@/infrastructure/api/url"

export type BootstrapWarmPayload = {
  members: Record<string, unknown>[]
  projects: Record<string, unknown>[]
  projectBudgets: Record<string, unknown>[]
  projectMembers: Record<string, unknown>[]
  teamProjectLinks: Record<string, unknown>[]
  projectMemberLimits: Record<string, unknown>[]
  teams: Record<string, unknown>[]
  teamMembers: Record<string, unknown>[]
  teamProjects: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  invites: Record<string, unknown>[] | null
  scopedMembers: {
    member_id: string
    members: string[] | null
    sees_all: boolean
  }
}

export async function fetchBootstrapWarmBundle(): Promise<BootstrapWarmPayload> {
  const res = await apiFetch(`${getApiBaseUrl()}/api/bootstrap/warm`)
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean
    error?: string
    data?: BootstrapWarmPayload
  }
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json.error || `HTTP ${res.status}`)
  }
  return json.data
}
