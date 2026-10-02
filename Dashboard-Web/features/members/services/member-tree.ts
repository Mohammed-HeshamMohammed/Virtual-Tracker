import { apiFetch, extractApiError, readJsonSafe, type ApiEnvelope } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import { getFirebaseAuth } from "@/infrastructure/firebase/config"


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
  const res = await apiFetch(apiPath(`/api/member-relationships/visual-tree?${params}`), {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await readJsonSafe<ApiEnvelope<MemberTreeGraph>>(res)
  if (!res.ok || json?.success !== true || !json.data) {
    throw extractApiError(res.status, "Failed to load member tree", json)
  }
  return json.data
}

/**
 * Puts a member under a different manager. Owner and Super Admin only (the server enforces it and
 * every hierarchy rule); throws an Error with the server's own explanation when it refuses.
 */
export async function moveMemberInTree(memberId: string, newParentId: string): Promise<void> {
  const res = await apiFetch(apiPath("/api/member-relationships/move"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member_id: memberId, new_parent_id: newParentId }),
  })
  const json = await readJsonSafe<ApiEnvelope<unknown>>(res)
  if (!res.ok || json?.success !== true) {
    throw extractApiError(res.status, "Could not change the manager", json)
  }
}
