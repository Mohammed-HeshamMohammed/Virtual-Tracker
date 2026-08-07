// Live-sync client dispatch (PLAN-livesyncandagenttimer.md §6.4). This is
// where Bug D dies: the handler below invalidates the registry key whether
// or not any component is currently mounted on it - unlike a hook's own
// refetch, which only ever fires while that page happens to be open. A
// stale key used to stay stale across every in-app route change, for the
// whole lifetime of the tab; this makes navigating back to a page always
// see fresh data, no full reload required.
import {
  invalidateCache,
  invalidateCachesByPrefix,
  invalidatePeopleMemberCaches,
  markStale,
  markStaleByPrefix,
} from "@/shared/tables/hooks/list-cache-registry"
import { BACKEND_CONNECTION_RESTORED, isBackendConnectionLost } from "@/infrastructure/api/backend-connection-events"

export type ChangeFrame = {
  type: "changed"
  resource: string
  id: string
  action: "created" | "updated" | "deleted"
  actor?: string
  at: number
}

export type ScopeChangedFrame = {
  type: "scope-changed"
  reason: "role" | "project-access" | "team" | "ban" | "hierarchy"
  at: number
}

export const changedEvent = (resource: string) => `vt-changed:${resource}`

/** One place mapping a backend resource to every client cache key derived
 * from it. Keep this the single source of truth - re-deriving the list a
 * second time elsewhere is how the two copies drift apart. */
const CACHE_KEYS: Record<string, string[]> = {
  projects: ["pm-projects:projects", "pm-tasks:projects", "pm-clients:projects"],
  // Budget/member-count changes show up as columns on the same project
  // rows, not as their own list - same keys as a plain project edit.
  "project-budgets": ["pm-projects:projects", "pm-tasks:projects", "pm-clients:projects"],
  "project-members": ["pm-projects:projects", "pm-tasks:projects", "pm-clients:projects"],
  tasks: ["pm-tasks:tasks"],
  "task-assignments": ["pm-tasks:tasks"],
  clients: ["pm-clients:clients"],
  teams: ["people:teams"],
  invites: ["people-members:invites"],
  "member-bans": ["people:member-bans"],
}

const PREFIXES: Record<string, string[]> = {
  // A client edit can move associated projects/members between namespaced
  // slots on the Clients page - safer to drop the whole pm-clients:*
  // namespace than enumerate every affected key by hand.
  clients: ["pm-clients:"],
  hierarchy: ["hierarchy-", "people-members:tree:"],
}

let currentMemberId: string | null = null

/** `currentMemberId` does not exist as a hook-readable value here -
 * change-events.ts is a plain module, not a component, so it cannot pull
 * it out of React context itself. Call this once from the auth provider,
 * next to where the presence socket already connects. Fails safe: if the
 * id is unset the actor check below is simply skipped, and the actor sees
 * one redundant refetch of their own change instead of a missed one. */
export function setCurrentMemberId(id: string | null): void {
  currentMemberId = id
}

const pending = new Map<string, ReturnType<typeof setTimeout>>()

/** Handles one "changed" broadcast frame. Cache invalidation is
 * unconditional and synchronous on every call (case 57/58: coalescing
 * only applies to the window event a mounted page reacts to, never to
 * whether stale data gets cleared). The window event itself is debounced
 * per resource so a batch operation triggers one refetch, not N. */
export function dispatchChanged(msg: ChangeFrame): void {
  if (msg.actor && msg.actor === currentMemberId) return // own write already applied locally

  if (msg.resource === "members") {
    // Already knows every member-derived key (people-members:members, its
    // field-scoped slots, __members_meta__, invites, tree, hierarchy-*) -
    // re-deriving that list here is how the two copies drift apart. Kept
    // as a hard invalidate (its existing, established behavior) rather
    // than switched to markStale below.
    invalidatePeopleMemberCaches(msg.id)
    invalidateCache("pm-clients:members") // the one slot it doesn't cover
    invalidateCachesByPrefix("people-members:profile:")
  }
  // markStale, not invalidateCache: a currently-mounted page's background
  // refetch (forced via presencePingEvent below) can then repaint in place
  // instead of dropping through a loading skeleton first, while a page
  // that isn't mounted still refetches fresh on its next mount (isStale
  // becomes true the moment lastFetchTime resets to 0).
  for (const key of CACHE_KEYS[msg.resource] ?? []) markStale(key)
  for (const prefix of PREFIXES[msg.resource] ?? []) markStaleByPrefix(prefix)

  if (pending.has(msg.resource)) return
  const timer = setTimeout(() => {
    pending.delete(msg.resource)
    // §6.10 - while the connection-lost banner is up, suppress the window
    // event (and therefore any toast/banner a listener would show for it -
    // useEntityLiveGuard, the modal notices). The cache is already marked
    // stale above regardless, so nothing is lost: BACKEND_CONNECTION_RESTORED
    // triggers dispatchReconnectRefetch, which re-fires for every resource
    // once it's actually safe to act on.
    if (typeof window !== "undefined" && !isBackendConnectionLost()) {
      window.dispatchEvent(new CustomEvent(changedEvent(msg.resource), { detail: msg }))
    }
  }, 400)
  pending.set(msg.resource, timer)
}

/** Shared by dispatchReconnectRefetch and handleScopeChanged: marks every
 * known resource's cache keys stale and fires its changedEvent, so any
 * currently-mounted page's presencePingEvent listener force-refetches.
 * Clearing the registry alone is not enough for a page that's already
 * mounted - its fetch hook only refetches reactively when this window
 * event actually arrives, not merely because a cache slot went stale. */
function dispatchAllResourceRefetch(): void {
  if (typeof window === "undefined") return
  for (const resource of new Set([...Object.keys(CACHE_KEYS), ...Object.keys(PREFIXES)])) {
    for (const key of CACHE_KEYS[resource] ?? []) markStale(key)
    for (const prefix of PREFIXES[resource] ?? []) markStaleByPrefix(prefix)
    window.dispatchEvent(
      new CustomEvent(changedEvent(resource), {
        detail: { type: "changed", resource, id: "*", action: "updated", at: Date.now() },
      }),
    )
  }
}

export const SCOPE_CHANGED_EVENT = "vt-scope-changed"

/** Targeted frame (§4.2): what changed is the viewer's own permissions,
 * which must never be broadcast. The nuclear response - clear everything,
 * refetch the current route - is deliberately the correct one here: a
 * scope change invalidates essentially every list at once. Dispatches
 * SCOPE_CHANGED_EVENT too, for the one thing cache invalidation can't do
 * on its own: re-evaluating route guards, which needs the router (this is
 * a plain module, so that part is left to a component-level listener). */
export async function handleScopeChanged(msg: ScopeChangedFrame): Promise<void> {
  const { clearAllListCaches } = await import("@/shared/tables/hooks/list-cache-registry")
  clearAllListCaches()
  dispatchAllResourceRefetch()
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SCOPE_CHANGED_EVENT, { detail: msg }))
  }
}

/** Called on WS reconnect (§6.10): frames missed while the socket was down
 * are gone - refetch, don't attempt replay. */
export function dispatchReconnectRefetch(): void {
  dispatchAllResourceRefetch()
}

// §6.10 - the HTTP outage/recovery signal (backend-connection-events.ts) is
// independent of the presence WebSocket: HTTP calls can fail and recover
// while the WS stays connected the whole time, in which case presence-ws.ts's
// own reconnect dispatch never fires. This is what catches that case -
// module-level because change-events.ts has no component lifecycle to hang
// it on, and it only needs to run once per page load.
if (typeof window !== "undefined") {
  window.addEventListener(BACKEND_CONNECTION_RESTORED, () => dispatchAllResourceRefetch())
}
