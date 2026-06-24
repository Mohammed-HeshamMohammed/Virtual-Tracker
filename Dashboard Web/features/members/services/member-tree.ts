import { apiFetch, extractApiError, readJsonSafe, type ApiEnvelope } from "@/infrastructure/api/http"
import { getApiBaseUrl } from "@/infrastructure/api/url"
import { getFirebaseAuth } from "@/infrastructure/firebase/config"

const API_BASE = getApiBaseUrl()

export interface MemberTreeNode {
  id: string
  name: string
  email: string
  role: string
  hierarchy_status?: string
  firebase_uid?: string
  avatar_url?: string
}

export interface MemberTreeEdge {
  id: string
  parent_member_id: string
  child_member_id: string
  relationship_type: string
}

export type MemberTreeScope = "organization" | "team"

export interface MemberTreeGraph {
  nodes: MemberTreeNode[]
  edges: MemberTreeEdge[]
  scope?: MemberTreeScope
  orphan_member_ids?: string[]
  valid_root_member_ids?: string[]
}

export async function getVisualMemberTree(scope: MemberTreeScope = "organization"): Promise<MemberTreeGraph> {
  const auth = getFirebaseAuth()
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error("Not authenticated")

  const params = new URLSearchParams({ scope })
  const res = await apiFetch(`${API_BASE}/api/member-relationships/visual-tree?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await readJsonSafe<ApiEnvelope<MemberTreeGraph>>(res)
  if (!res.ok || json?.success !== true || !json.data) {
    throw extractApiError(res.status, "Failed to load member tree", json)
  }
  return json.data
}
