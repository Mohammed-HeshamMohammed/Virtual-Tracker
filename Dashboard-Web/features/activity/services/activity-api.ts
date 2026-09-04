import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import { coalesceRequest } from "@/infrastructure/api/request-coalesce"
import { ACTIVITY_FEED_DASHBOARD_CACHE_MS } from "@/infrastructure/config/firestore-throttle"


export type ActivitySessionAction = "start" | "idle" | "resume" | "stop" | "sync"

export interface ActivitySession {
  id: string
  memberId: string
  status: "active" | "idle" | "stopped"
  startedAt: string | null
  endedAt: string | null
  activeSeconds: number
  idleSeconds: number
  taskId?: string | null
  updatedAt: string | null
}

export type ActivityEvent =
  | { type: "screenshot"; imageData: string; appName: string; pageTitle: string; activityLevel: number }
  | { type: "app"; appName: string; durationSeconds: number }
  | { type: "url"; url: string; pageTitle: string; durationSeconds: number }

export interface ActivityFeedScope {
  viewerMemberId: string
  roleName: string
  canFilterByProject: boolean
  canSeeAllMembers: boolean
  projectScopeOnly: boolean
  members: { id: string; name: string; initials: string }[]
  defaultMemberId: string
}

export interface ActivityFeedQuery {
  type: "screenshots" | "apps" | "urls"
  memberId: string
  projectScopeOnly: boolean
  day?: string
  sort?: "newest" | "duration"
}

export async function fetchActivitySession(): Promise<ActivitySession | null> {
  return coalesceRequest("activity-session-get", async () => {
    try {
      const res = await apiFetch(apiPath("/api/activity/session"))
      if (!res.ok) return null
      const json = await res.json()
      return json.data ?? null
    } catch {
      return null
    }
  })
}

export type ActivitySessionPostResult = {
  session: ActivitySession | null
  error?: string
}

export async function postActivitySessionDetailed(
  action: ActivitySessionAction,
  counters?: { activeSeconds?: number; idleSeconds?: number; taskId?: string | null },
): Promise<ActivitySessionPostResult> {
  try {
    const res = await apiFetch(apiPath("/api/activity/session"), {
      method: "POST",
      body: JSON.stringify({
        action,
        activeSeconds: counters?.activeSeconds,
        idleSeconds: counters?.idleSeconds,
        taskId: counters?.taskId ?? null,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message =
        typeof json?.error === "string" && json.error.trim()
          ? json.error
          : "Failed to update activity session"
      return { session: null, error: message }
    }
    return { session: json.data ?? null }
  } catch {
    return { session: null, error: "Network error while updating activity session" }
  }
}

export async function postActivitySession(
  action: ActivitySessionAction,
  counters?: { activeSeconds?: number; idleSeconds?: number; taskId?: string | null },
): Promise<ActivitySession | null> {
  const result = await postActivitySessionDetailed(action, counters)
  return result.session
}

export async function postActivityEvents(sessionId: string, events: ActivityEvent[]): Promise<boolean> {
  if (events.length === 0) return false
  try {
    const res = await apiFetch(apiPath("/api/activity/events"), {
      method: "POST",
      body: JSON.stringify({ sessionId, events, source: "web" }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function registerWebCapture(): Promise<boolean> {
  try {
    const res = await apiFetch(apiPath("/api/activity/agent/register"), {
      method: "POST",
      body: JSON.stringify({ source: "web" }),
    })
    return res.ok
  } catch {
    return false
  }
}

export type ActivityCaptureMode = "agent" | "web"

export interface AgentStatus {
  captureMode: ActivityCaptureMode
  agentIngestEnabled: boolean
  webCaptureEnabled: boolean
  linkedAt: string | null
  agentSource: string | null
  authPort: number
  agentOnline: boolean
}

export async function fetchAgentStatus(): Promise<AgentStatus | null> {
  return coalesceRequest("activity-agent-status", async () => {
    try {
      const res = await apiFetch(apiPath("/api/activity/agent/status"))
      if (!res.ok) return null
      const json = await res.json()
      return json.data ?? null
    } catch {
      return null
    }
  })
}

export async function fetchActivityScope(projectScopeOnly: boolean): Promise<ActivityFeedScope | null> {
  const params = new URLSearchParams()
  if (projectScopeOnly) params.set("projectScopeOnly", "true")
  try {
    const res = await apiFetch(apiPath(`/api/activity/scope?${params}`))
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch {
    return null
  }
}

export interface ActivityFeedResult<T> {
  data: T
  members: { id: string; name: string; initials: string }[]
  /** When any app/site classification was last changed. Categories resolve at
   *  read time, so re-classifying changes what past periods report - this is
   *  what lets the UI say so rather than silently moving the numbers. */
  classificationsUpdatedAt?: string
  scope?: {
    roleName: string
    canFilterByProject: boolean
    projectScopeOnly: boolean
  }
  screenshotsEnabled?: boolean
  disabledReason?: string
}

export async function fetchActivityScreenshotImage(screenshotId: string): Promise<string | null> {
  if (!screenshotId) return null
  try {
    const res = await apiFetch(apiPath(`/api/activity/screenshot/${encodeURIComponent(screenshotId)}`))
    if (!res.ok) return null
    const json = await res.json()
    const imageData = json.data?.imageData
    return typeof imageData === "string" && imageData.length > 0 ? imageData : null
  } catch {
    return null
  }
}

export interface ScreenshotActivityUpdate {
  updated: number
  ids: string[]
  activityLevel: number
  runStart: string | null
  runEnd: string | null
}

/**
 * Correct a capture's activity level. By default the correction applies across
 * its capture run - the unbroken stretch of tracked work it belongs to, bounded
 * by idle gaps - because a wrong reading is rarely wrong for exactly one
 * screenshot. Pass applyToRun: false to change only this one.
 *
 * The original measurement is preserved server-side; this never destroys what
 * the agent recorded.
 */
export async function updateScreenshotActivityLevel(
  screenshotId: string,
  input: { activityLevel: number; applyToRun?: boolean; reason?: string },
): Promise<ScreenshotActivityUpdate> {
  if (!screenshotId) throw new Error("Screenshot id is required")
  const res = await apiFetch(
    apiPath(`/api/activity/screenshot/${encodeURIComponent(screenshotId)}/activity`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  )
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || "Failed to update activity level")
  return json.data as ScreenshotActivityUpdate
}

export async function deleteActivityScreenshot(screenshotId: string): Promise<void> {
  if (!screenshotId) throw new Error("Screenshot id is required")
  const res = await apiFetch(apiPath(`/api/activity/screenshot/${encodeURIComponent(screenshotId)}`), {
    method: "DELETE",
  })
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw new Error(json?.error || "Failed to delete screenshot")
  }
}

const FEED_TIMEOUT_MS = 90_000

type FeedCacheEntry = { at: number; value: ActivityFeedResult<unknown> }
const feedCache = new Map<string, FeedCacheEntry>()

export function clearActivityApiFeedCache(): void {
  feedCache.clear()
}

function feedCacheKey(query: ActivityFeedQuery): string {
  return [
    query.type,
    query.memberId,
    query.projectScopeOnly ? "1" : "0",
    query.day ?? "",
    query.sort ?? "newest",
  ].join(":")
}

export async function fetchActivityFeed<T>(query: ActivityFeedQuery): Promise<ActivityFeedResult<T> | null> {
  const cacheKey = feedCacheKey(query)
  const cached = feedCache.get(cacheKey)
  if (cached && Date.now() - cached.at < ACTIVITY_FEED_DASHBOARD_CACHE_MS) {
    return cached.value as ActivityFeedResult<T>
  }

  return coalesceRequest(`activity-feed:${cacheKey}`, async () => {
    const params = new URLSearchParams({ type: query.type })
    if (query.memberId && query.memberId !== "all") {
      params.set("memberId", query.memberId)
    } else {
      params.set("memberId", "all")
    }
    if (query.projectScopeOnly) params.set("projectScopeOnly", "true")
    if (query.day) params.set("day", query.day)
    params.set("sort", query.sort ?? "newest")
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
    try {
      const res = await apiFetch(apiPath(`/api/activity/feed?${params}`), {
        signal: controller.signal,
      })
      if (!res.ok) return null
      const json = await res.json()
      const members = json.members ?? []
      const meta = {
        members,
        scope: json.scope,
        screenshotsEnabled: json.screenshotsEnabled as boolean | undefined,
        disabledReason: typeof json.disabledReason === "string" ? json.disabledReason : undefined,
        classificationsUpdatedAt:
          typeof json.classificationsUpdatedAt === "string" ? json.classificationsUpdatedAt : undefined,
      }
      const result =
        query.type === "apps" && json.data?.apps
          ? ({ data: json.data as T, ...meta } as ActivityFeedResult<T>)
          : ({ data: (json.data ?? json) as T, ...meta } as ActivityFeedResult<T>)
      feedCache.set(cacheKey, { at: Date.now(), value: result as ActivityFeedResult<unknown> })
      return result
    } catch {
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  })
}
