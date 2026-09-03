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

const CACHE_KEYS: Record<string, string[]> = {
  projects: ["pm-projects:projects", "pm-tasks:projects", "pm-clients:projects"],
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
  clients: ["pm-clients:"],
  hierarchy: ["hierarchy-", "people-members:tree:"],
}

let currentMemberId: string | null = null

export function setCurrentMemberId(id: string | null): void {
  currentMemberId = id
}

const pending = new Map<string, ReturnType<typeof setTimeout>>()

export function dispatchChanged(msg: ChangeFrame): void {
  if (msg.actor && msg.actor === currentMemberId) return

  if (msg.resource === "members") {
    invalidatePeopleMemberCaches(msg.id)
    invalidateCache("pm-clients:members")
    invalidateCachesByPrefix("people-members:profile:")
  }
  for (const key of CACHE_KEYS[msg.resource] ?? []) markStale(key)
  for (const prefix of PREFIXES[msg.resource] ?? []) markStaleByPrefix(prefix)

  if (pending.has(msg.resource)) return
  const timer = setTimeout(() => {
    pending.delete(msg.resource)
    if (typeof window !== "undefined" && !isBackendConnectionLost()) {
      window.dispatchEvent(new CustomEvent(changedEvent(msg.resource), { detail: msg }))
    }
  }, 400)
  pending.set(msg.resource, timer)
}

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

export async function handleScopeChanged(msg: ScopeChangedFrame): Promise<void> {
  const { clearAllListCaches } = await import("@/shared/tables/hooks/list-cache-registry")
  clearAllListCaches()
  dispatchAllResourceRefetch()
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SCOPE_CHANGED_EVENT, { detail: msg }))
  }
}

export function dispatchReconnectRefetch(): void {
  dispatchAllResourceRefetch()
}

if (typeof window !== "undefined") {
  window.addEventListener(BACKEND_CONNECTION_RESTORED, () => dispatchAllResourceRefetch())
}
