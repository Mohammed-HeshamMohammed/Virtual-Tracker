import { apiFetch, getApiAuthToken } from "@/infrastructure/api/http"
import { coalesceRequest } from "@/infrastructure/api/request-coalesce"
import { bearerAuthHeaders } from "@/features/auth/services/bearer-headers"
import { assertSecureFetchUrl } from "@/infrastructure/api/secure-transport"
import { apiPath } from "@/infrastructure/api/path"


export interface TreeNode {
  member_id: string
  level: number
  relationship_type: string
}

export interface MemberTree {
  member_id: string
  children: Array<{
    member_id: string
    relationship_type: string
    children?: MemberTree["children"]
  }>
}

export interface ConnectedMembers {
  root_id: string
  members: string[]
}

/**
 * Get all ancestors of a member (who added them, up the tree)
 */
async function getMemberAncestors(memberId: string): Promise<TreeNode[]> {
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/ancestors`))
  if (!res.ok) throw new Error(`Failed to fetch ancestors: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch ancestors")
  return json.data
}

/**
 * Get all descendants of a member (who they added, down the tree)
 */
async function getMemberDescendants(memberId: string, maxDepth?: number): Promise<TreeNode[]> {
  const params = maxDepth ? `?maxDepth=${maxDepth}` : ""
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/descendants${params}`))
  if (!res.ok) throw new Error(`Failed to fetch descendants: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch descendants")
  return json.data
}

/**
 * Get the full tree path from root to this member
 */
async function getMemberTreePath(memberId: string): Promise<string[]> {
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/tree-path`))
  if (!res.ok) throw new Error(`Failed to fetch tree path: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch tree path")
  return json.data
}

/**
 * Get the root (top-most ancestor) of a member's tree
 */
async function getMemberRoot(memberId: string): Promise<string | null> {
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/root`))
  if (!res.ok) throw new Error(`Failed to fetch root: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch root")
  return json.data?.root_id || null
}

export interface ScopedHierarchyMembers {
  member_id: string
  members: string[] | null
  /** Subset of members the viewer may edit/remove (excludes read-only upline in subtree). */
  manageable_members?: string[] | null
  /** Manager team picker: subtree + org-wide employees. */
  team_staffable_members?: string[] | null
  sees_all: boolean
}

export interface TeamStaffableMemberSummary {
  id: string
  first_name?: string
  last_name?: string
  work_email?: string
  role_name?: string
  avatar?: string
  avatar_color?: string
  avatar_url?: string
}

export interface TeamStaffableMembersResponse {
  member_id: string
  members: TeamStaffableMemberSummary[] | null
  sees_all: boolean
}

/**
 * Role-aware People scope for the signed-in member.
 * `members` = visible (includes read-only upline in subtree).
 * `manageable_members` = edit/remove scope (Managers / Super Managers).
 */
async function fetchScopedHierarchyMembers(forceToken = false): Promise<ScopedHierarchyMembers> {
  const url = apiPath("/api/member-relationships/scoped-members")
  assertSecureFetchUrl(url)
  const token = await getApiAuthToken(forceToken)
  if (!token) {
    throw new Error("Not authenticated — sign in to call this API.")
  }
  const res = await fetch(url, {
    headers: bearerAuthHeaders(token),
    cache: "no-store",
    credentials: "same-origin",
  })
  const json = (await res.json().catch(() => null)) as {
    success?: boolean
    data?: ScopedHierarchyMembers
    error?: string
  } | null
  if (res.status === 401 && !forceToken) {
    return fetchScopedHierarchyMembers(true)
  }
  if (!res.ok) throw new Error(`Failed to fetch scoped members: ${res.status}`)
  if (!json?.success || !json.data) {
    throw new Error(json?.error || "Failed to fetch scoped members")
  }
  return json.data
}

export async function getScopedHierarchyMembers(): Promise<ScopedHierarchyMembers> {
  return coalesceRequest("member-relationships:scoped-members", () => fetchScopedHierarchyMembers())
}

async function fetchTeamStaffableMembers(forceToken = false): Promise<TeamStaffableMembersResponse> {
  const url = apiPath("/api/member-relationships/team-staffable-members")
  assertSecureFetchUrl(url)
  const token = await getApiAuthToken(forceToken)
  if (!token) {
    throw new Error("Not authenticated — sign in to call this API.")
  }
  const res = await fetch(url, {
    headers: bearerAuthHeaders(token),
    cache: "no-store",
    credentials: "same-origin",
  })
  const json = (await res.json().catch(() => null)) as {
    success?: boolean
    data?: TeamStaffableMembersResponse
    error?: string
  } | null
  if (res.status === 401 && !forceToken) {
    return fetchTeamStaffableMembers(true)
  }
  if (!res.ok) throw new Error(`Failed to fetch team staffable members: ${res.status}`)
  if (!json?.success || !json.data) {
    throw new Error(json?.error || "Failed to fetch team staffable members")
  }
  return json.data
}

export async function getTeamStaffableMembers(): Promise<TeamStaffableMembersResponse> {
  return coalesceRequest("member-relationships:team-staffable-members", () => fetchTeamStaffableMembers())
}

export interface TeamSubtreeMembers {
  member_id: string
  members: string[]
}

/**
 * Members in the viewer's hierarchy subtree (self + direct/indirect reports).
 * Prefer getScopedHierarchyMembers for People page manage scope.
 */
export async function getTeamSubtreeMembers(memberId: string): Promise<TeamSubtreeMembers> {
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/team-subtree`))
  if (!res.ok) throw new Error(`Failed to fetch team subtree: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch team subtree")
  return json.data
}

/**
 * Get all members connected in the same tree
 */
export async function getConnectedMembers(memberId: string): Promise<ConnectedMembers> {
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/connected`))
  if (!res.ok) throw new Error(`Failed to fetch connected members: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch connected members")
  return json.data
}

/**
 * Get the full nested tree structure starting from a member
 */
async function getMemberTree(memberId: string): Promise<MemberTree> {
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/tree`))
  if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch tree")
  return json.data
}

/**
 * Get the direct parent of a member
 */
async function getMemberParent(memberId: string): Promise<TreeNode | null> {
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/parent`))
  if (!res.ok) throw new Error(`Failed to fetch parent: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch parent")
  return json.data
}

/**
 * Get direct children of a member
 */
async function getMemberChildren(memberId: string): Promise<TreeNode[]> {
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/children`))
  if (!res.ok) throw new Error(`Failed to fetch children: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch children")
  return json.data
}

/**
 * Check if one member is an ancestor of another
 */
async function checkIsAncestor(ancestorId: string, descendantId: string): Promise<boolean> {
  const params = new URLSearchParams({ ancestor: ancestorId, descendant: descendantId })
  const res = await apiFetch(apiPath(`/api/member-relationships/check-ancestor?${params}`))
  if (!res.ok) throw new Error(`Failed to check ancestor: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to check ancestor")
  return json.data?.is_ancestor || false
}

/**
 * Get members who share projects with the given member (for client visibility)
 */
async function getMembersBySharedProjects(memberId: string): Promise<string[]> {
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/shared-projects`))
  if (!res.ok) throw new Error(`Failed to fetch shared projects: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch shared projects")
  return json.data?.members || []
}

export interface VisibleMembersForClient {
  root_id: string
  tree_members: string[]
  project_members: string[]
  all_visible: string[]
}

/**
 * Get all visible members for a client (tree + project-based visibility)
 */
export async function getVisibleMembersForClient(memberId: string): Promise<VisibleMembersForClient> {
  const res = await apiFetch(apiPath(`/api/member-relationships/${encodeURIComponent(memberId)}/visible`))
  if (!res.ok) throw new Error(`Failed to fetch visible members: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch visible members")
  return json.data
}

/**
 * Manually create a member relationship (admin use)
 */
async function createMemberRelationship(
  parentMemberId: string,
  childMemberId: string,
  relationshipType: "invite" | "preprovision" | "admin_create" | "self_signup",
  createdBy?: string
): Promise<{ id: string; parent_member_id: string; child_member_id: string; relationship_type: string }> {
  const res = await apiFetch(apiPath("/api/member-relationships"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parent_member_id: parentMemberId,
      child_member_id: childMemberId,
      relationship_type: relationshipType,
      created_by: createdBy || parentMemberId,
    }),
  })
  if (!res.ok) throw new Error(`Failed to create relationship: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to create relationship")
  return json.data
}
