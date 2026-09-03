import {
  getFetchPromise,
  getLastFetchTime,
  hasCachedData,
  invalidateCache,
  readCache,
  setFetchPromise,
  touchFetchTime,
  writeCache,
} from "@/shared/tables/hooks/list-cache-registry"
import { memberTreeCacheKey } from "@/features/members/hooks/use-member-tree-data"
import {
  getVisualMemberTree,
  type MemberTreeGraph,
} from "@/features/members/services/member-tree"

const TEAM_TREE_CACHE_KEY = memberTreeCacheKey("team")
const FETCH_DEBOUNCE_MS = 2000

export function memberIdsFromTeamGraph(graph: MemberTreeGraph, memberId: string): Set<string> {
  const ids = new Set(graph.nodes.map((node) => node.id))
  ids.add(memberId)
  return ids
}

export function readSharedTeamScopeMemberIds(memberId: string): Set<string> | null {
  const graph = readCache<MemberTreeGraph>(TEAM_TREE_CACHE_KEY)
  if (!graph) return null
  return memberIdsFromTeamGraph(graph, memberId)
}

export async function fetchSharedTeamTreeGraph(forceRefetch = false): Promise<MemberTreeGraph> {
  if (forceRefetch) {
    invalidateCache(TEAM_TREE_CACHE_KEY)
  } else if (hasCachedData(TEAM_TREE_CACHE_KEY)) {
    return readCache<MemberTreeGraph>(TEAM_TREE_CACHE_KEY)!
  }

  const pending = getFetchPromise(TEAM_TREE_CACHE_KEY)
  if (!forceRefetch && pending) {
    await pending
    if (hasCachedData(TEAM_TREE_CACHE_KEY)) {
      return readCache<MemberTreeGraph>(TEAM_TREE_CACHE_KEY)!
    }
  }

  const now = Date.now()
  if (
    !forceRefetch &&
    hasCachedData(TEAM_TREE_CACHE_KEY) &&
    now - getLastFetchTime(TEAM_TREE_CACHE_KEY) < FETCH_DEBOUNCE_MS
  ) {
    return readCache<MemberTreeGraph>(TEAM_TREE_CACHE_KEY)!
  }

  const fetchTask = getVisualMemberTree("team")
    .then((graph) => {
      writeCache(TEAM_TREE_CACHE_KEY, graph)
      return graph
    })
    .finally(() => {
      touchFetchTime(TEAM_TREE_CACHE_KEY)
      setFetchPromise(TEAM_TREE_CACHE_KEY, null)
    })

  setFetchPromise(
    TEAM_TREE_CACHE_KEY,
    fetchTask.then(
      () => undefined,
      () => undefined,
    ),
  )

  return fetchTask
}

export async function fetchSharedTeamScopeMemberIds(
  memberId: string,
  options: { forceRefetch?: boolean } = {},
): Promise<Set<string>> {
  const graph = await fetchSharedTeamTreeGraph(options.forceRefetch ?? false)
  return memberIdsFromTeamGraph(graph, memberId)
}

export function invalidateSharedTeamScope(): void {
  invalidateCache(TEAM_TREE_CACHE_KEY)
}
