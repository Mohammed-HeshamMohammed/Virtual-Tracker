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

export function useMemberTreeData(scope: MemberTreeScope, onError?: (error: unknown) => void) {
  return useCachedList<MemberTreeGraph>({
    cacheKey: memberTreeCacheKey(scope),
    fetch: () => getVisualMemberTree(scope),
    initialData: EMPTY_MEMBER_TREE,
    staleMs: 300_000,
    minLoadingMs: 0,
    presencePingEvent: "vt-presence-ping",
    onError,
  })
}
