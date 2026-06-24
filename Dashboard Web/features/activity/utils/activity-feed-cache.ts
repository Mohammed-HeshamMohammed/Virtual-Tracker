import type { ActivityFeedQuery } from "@/features/activity/services/activity-api"
import type { ActivityMemberOption } from "@/features/activity/components/activity-feed-context"
import { ACTIVITY_FEED_DASHBOARD_CACHE_MS } from "@/infrastructure/config/firestore-throttle"

export type ActivityFeedCacheEntry = {
  data: unknown
  members: ActivityMemberOption[]
  disabledReason: string | null
  fetchedAt: number
}

const feedCache = new Map<string, ActivityFeedCacheEntry>()

export function buildActivityFeedCacheKey(
  viewerMemberId: string,
  query: ActivityFeedQuery,
  options?: { myTeamOnly?: boolean },
): string {
  const day = query.day ?? "all"
  const teamScope = options?.myTeamOnly ? "team" : "org"
  return `${viewerMemberId}:${teamScope}:${query.type}:${query.memberId}:${query.projectScopeOnly ? "projects" : "all"}:${day}`
}

export function readActivityFeedCache(key: string): ActivityFeedCacheEntry | undefined {
  return feedCache.get(key)
}

export function writeActivityFeedCache(key: string, entry: ActivityFeedCacheEntry): void {
  feedCache.set(key, entry)
}

export function deleteActivityFeedCache(key: string): void {
  feedCache.delete(key)
}

export function clearActivityFeedCache(): void {
  feedCache.clear()
}

export function isActivityFeedCacheFresh(
  fetchedAt: number,
  maxAgeMs: number = ACTIVITY_FEED_DASHBOARD_CACHE_MS,
): boolean {
  return Date.now() - fetchedAt < maxAgeMs
}
