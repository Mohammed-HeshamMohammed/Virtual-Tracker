type CacheSlot = {
  data: unknown | null
  lastFetchTime: number
  fetchPromise: Promise<void> | null
}

const slots = new Map<string, CacheSlot>()

function getSlot(key: string): CacheSlot {
  let slot = slots.get(key)
  if (!slot) {
    slot = { data: null, lastFetchTime: 0, fetchPromise: null }
    slots.set(key, slot)
  }
  return slot
}

export function readCache<T>(key: string): T | null {
  return (getSlot(key).data as T | null) ?? null
}

export function writeCache<T>(key: string, data: T): void {
  const slot = getSlot(key)
  slot.data = data
  slot.lastFetchTime = Date.now()
}

export function getLastFetchTime(key: string): number {
  return getSlot(key).lastFetchTime
}

export function getFetchPromise(key: string): Promise<void> | null {
  return getSlot(key).fetchPromise
}

export function setFetchPromise(key: string, promise: Promise<void> | null): void {
  getSlot(key).fetchPromise = promise
}

export function touchFetchTime(key: string): void {
  getSlot(key).lastFetchTime = Date.now()
}

export function hasCachedData(key: string): boolean {
  return getSlot(key).data !== null
}

/** Clears cached data for a key (e.g. after logout). Drops `data` to null,
 * which makes `hasCachedData` false - correct for a page that isn't
 * mounted (it should show its loading state on next visit), but a
 * currently-mounted page reading this key mid-render would flash a
 * skeleton before its background refetch repaints. For that case use
 * markStale below instead. */
export function invalidateCache(key: string): void {
  const slot = getSlot(key)
  slot.data = null
  slot.lastFetchTime = 0
  slot.fetchPromise = null
}

/** Marks a key due for refetch without clearing what's already on screen -
 * `hasCachedData` stays true, only staleness changes. The live-sync
 * dispatch path (change-events.ts) uses this as its default so a
 * currently-mounted page's background refetch can repaint in place
 * instead of dropping through a loading skeleton first. */
export function markStale(key: string): void {
  const slot = getSlot(key)
  slot.lastFetchTime = 0
}

/** Clears all cache keys with the given prefix. */
export function invalidateCachesByPrefix(prefix: string): void {
  for (const key of [...slots.keys()]) {
    if (key.startsWith(prefix)) invalidateCache(key)
  }
}

/** markStale, applied to every existing cache key with the given prefix. */
export function markStaleByPrefix(prefix: string): void {
  for (const key of [...slots.keys()]) {
    if (key.startsWith(prefix)) markStale(key)
  }
}

/** Reads members list from any field-scoped or legacy cache slot. */
export function readMembersListCache<T = unknown>(): T[] | null {
  const legacy = readCache<T[]>("people-members:members")
  if (legacy) return legacy
  for (const key of slots.keys()) {
    if (key.startsWith("people-members:members:")) {
      const data = readCache<T[]>(key)
      if (data) return data
    }
  }
  return null
}

/** Clears People › Members list caches (e.g. after role change or promotion). */
export function invalidatePeopleMemberCaches(memberId?: string): void {
  invalidateCache("people-members:members")
  invalidateCachesByPrefix("people-members:members:")
  invalidateCache("people-members:__members_meta__")
  invalidateCache("people-members:invites")
  invalidateCachesByPrefix("people-members:tree:")
  if (memberId) {
    invalidateCache(`hierarchy-scoped-${memberId}`)
    invalidateCache(`hierarchy-manageable-v2-${memberId}`)
    invalidateCache(`hierarchy-scope-v3-${memberId}`)
  }
}

/** Clears all in-memory list caches (members, projects, clients, member profiles, etc.). */
export function clearAllListCaches(): void {
  slots.clear()
}
