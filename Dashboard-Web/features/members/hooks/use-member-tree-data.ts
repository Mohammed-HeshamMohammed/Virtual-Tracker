"use client"

import { useCachedList } from "@/shared/tables/hooks/use-cached-list"
import {
  getVisualMemberTree,
  type MemberTreeGraph,
  type MemberTreeScope,
} from "@/features/members/services/member-tree"

export const EMPTY_MEMBER_TREE: MemberTreeGraph = {
  nodes: [],
  edges: [],
  valid_root_member_ids: [],
  orphan_member_ids: [],
}

export function memberTreeCacheKey(scope: MemberTreeScope): string {
  return `people-members:tree:${scope}`
}

/**
 * `allowed: false` skips the request entirely and returns an empty tree.
 * The tree page mounts both scopes at once (so switching is instant), but
 * only Owner/Super Admin/Admin may load the organization scope - for anyone
 * else that request was a guaranteed 403 on every visit, and its error
 * leaked into the scope they were actually looking at
 * (PLAN-bug-fixes-round-1.md item 15).
 */
export function useMemberTreeData(
  scope: MemberTreeScope,
  onError?: (error: unknown) => void,
  { allowed = true }: { allowed?: boolean } = {},
) {
  return useCachedList<MemberTreeGraph>({
    // A disabled scope gets its own key so its empty placeholder can never
    // be served from, or overwrite, a real cached tree for the same scope.
    cacheKey: allowed ? memberTreeCacheKey(scope) : `${memberTreeCacheKey(scope)}:disabled`,
    fetch: () => (allowed ? getVisualMemberTree(scope) : Promise.resolve(EMPTY_MEMBER_TREE)),
    initialData: EMPTY_MEMBER_TREE,
    staleMs: 300_000,
    minLoadingMs: 0,
    presencePingEvent: "vt-presence-ping",
    onError,
  })
}
