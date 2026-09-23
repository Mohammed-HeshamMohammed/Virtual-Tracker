import { apiFetch, extractApiError, readJsonSafe } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import type { NotificationItem } from "@/shared/ui/layout/components/topbar/notifications-bell"

/** The paged, filterable read behind the Notifications page. The bell keeps
 *  its own lighter list. */
export type NotificationsPageResult = {
  notifications: NotificationItem[]
  total: number
  types: string[]
  unreadCount: number
}

export async function fetchNotificationsPage(options: {
  limit?: number
  offset?: number
  unreadOnly?: boolean
  type?: string
}): Promise<NotificationsPageResult> {
  const params = new URLSearchParams()
  if (options.limit) params.set("limit", String(options.limit))
  if (options.offset) params.set("offset", String(options.offset))
  if (options.unreadOnly) params.set("unread", "true")
  if (options.type) params.set("type", options.type)
  const query = params.toString()

  const res = await apiFetch(apiPath(`/api/notifications/page${query ? `?${query}` : ""}`))
  const json = await readJsonSafe<Partial<NotificationsPageResult> & { success?: boolean; error?: string }>(res)
  if (!res.ok) throw extractApiError(res.status, "Failed to load notifications", json)
  if (!json?.success) throw new Error(json?.error || "Failed to load notifications")
  return {
    notifications: json.notifications ?? [],
    total: json.total ?? 0,
    types: json.types ?? [],
    unreadCount: json.unreadCount ?? 0,
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await apiFetch(apiPath("/api/notifications/read-all"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error("Failed to mark notifications read")
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/notifications/${encodeURIComponent(id)}/read`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error("Failed to mark the notification read")
}
