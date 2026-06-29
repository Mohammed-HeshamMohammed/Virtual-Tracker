/* eslint-disable react-doctor/no-initialize-state */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bell } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useAuth } from "@/shared/providers/app"
import { apiPath } from "@/infrastructure/api/path"
import { fetchJsonWithRetry, getApiAuthToken } from "@/infrastructure/api/http"
import { clearCoalescedRequest, coalesceRequest } from "@/infrastructure/api/request-coalesce"

type Notification = {
  id: string
  recipient_id: string
  type: string
  title: string
  message: string
  link?: string
  read: boolean
  created_at: number | string | Date
}

type NotificationsBellProps = {
  onNavigate?: (pageId: string) => void
}

const NOTIFICATIONS_LIST_KEY = "notifications-list"

export function NotificationsBell({ onNavigate }: NotificationsBellProps) {
  const { isLoggedIn, sessionReady, profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fetchGenerationRef = useRef(0)

  const applyNotifications = useCallback((items: Notification[], generation: number) => {
    if (generation !== fetchGenerationRef.current) return
    setNotifications(items)
    setUnreadCount(items.filter((n) => !n.read).length)
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (!isLoggedIn || !sessionReady || profile?.mustChangePassword) return
    const token = await getApiAuthToken()
    if (!token) return

    const generation = fetchGenerationRef.current

    try {
      const { res, json } = await coalesceRequest(NOTIFICATIONS_LIST_KEY, () =>
        fetchJsonWithRetry<{ success: boolean; data: Notification[] }>(
          apiPath("/api/notifications"),
          {},
          { retries: 2 },
        ),
      )
      if (res.ok && json?.success && json.data) {
        applyNotifications(json.data, generation)
      }
    } catch {
      // Network blips during login or backend restarts — bell retries on interval.
    }
  }, [applyNotifications, isLoggedIn, sessionReady, profile?.mustChangePassword])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    if (!open || !isLoggedIn || !sessionReady || profile?.mustChangePassword) return

    void fetchNotifications()

    const interval = window.setInterval(() => {
      void fetchNotifications()
    }, 30000)

    return () => {
      window.clearInterval(interval)
    }
  }, [open, fetchNotifications, isLoggedIn, sessionReady, profile?.mustChangePassword])

  async function markAsRead(id: string) {
    fetchGenerationRef.current += 1
    clearCoalescedRequest(NOTIFICATIONS_LIST_KEY)

    const previousNotifications = notifications
    const previousUnread = unreadCount

    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    setUnreadCount((prev) => Math.max(0, prev - 1))

    try {
      const { res, json } = await fetchJsonWithRetry<{ success?: boolean }>(
        apiPath(`/api/notifications/${id}/read`),
        { method: "POST" },
      )
      if (!res.ok || json?.success === false) {
        throw new Error("Failed to mark notification as read")
      }
    } catch (e) {
      fetchGenerationRef.current += 1
      setNotifications(previousNotifications)
      setUnreadCount(previousUnread)
      console.error("Failed to mark as read", e)
    }
  }

  async function markAllAsRead() {
    if (markingAllRead || unreadCount === 0) return

    setMarkingAllRead(true)
    fetchGenerationRef.current += 1
    clearCoalescedRequest(NOTIFICATIONS_LIST_KEY)

    const previousNotifications = notifications
    const previousUnread = unreadCount

    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)

    try {
      const { res, json } = await fetchJsonWithRetry<{ success?: boolean }>(
        apiPath("/api/notifications/read-all"),
        { method: "POST" },
      )
      if (!res.ok || json?.success === false) {
        throw new Error("Failed to mark all notifications as read")
      }

      clearCoalescedRequest(NOTIFICATIONS_LIST_KEY)
      const generation = fetchGenerationRef.current
      const { res: listRes, json: listJson } = await coalesceRequest(NOTIFICATIONS_LIST_KEY, () =>
        fetchJsonWithRetry<{ success: boolean; data: Notification[] }>(
          apiPath("/api/notifications"),
          {},
          { retries: 2 },
        ),
      )
      if (listRes.ok && listJson?.success && listJson.data) {
        applyNotifications(listJson.data, generation)
      }
    } catch (e) {
      fetchGenerationRef.current += 1
      setNotifications(previousNotifications)
      setUnreadCount(previousUnread)
      console.error("Failed to mark all as read", e)
    } finally {
      setMarkingAllRead(false)
    }
  }

  async function handleNotificationClick(notification: Notification) {
    if (!notification.read) {
      await markAsRead(notification.id)
    }
    const link = notification.link?.trim()
    if (link && onNavigate) {
      onNavigate(link)
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-[#2e3447] dark:hover:text-[#bccbb9] transition-colors" type="button"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-2 top-2 flex h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-[#161a27]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 origin-top-right overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#1e2335] z-50 flex flex-col max-h-[85vh]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <h3 className="font-semibold text-slate-800 dark:text-[#dce1fb]">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => void markAllAsRead()}
                disabled={markingAllRead}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-400 dark:hover:text-blue-300 transition-colors" type="button"
              >
                {markingAllRead ? "Marking…" : "Mark all read"}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="rounded-full bg-slate-50 p-3 mb-3 dark:bg-[#2e3447]">
                  <Bell className="h-6 w-6 text-slate-400 dark:text-slate-500" />
                </div>
                <p className="text-sm font-medium text-slate-800 dark:text-[#dce1fb]">All caught up!</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">You don't have any notifications right now.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {notifications.map(n => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => void handleNotificationClick(n)}
                    className={cn(
                      "group flex w-full gap-3 p-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-[#2e3447]/50",
                      !n.read ? "bg-blue-50/50 dark:bg-blue-900/10" : "",
                      n.link ? "cursor-pointer" : "cursor-default",
                    )}
                  >
                    {!n.read && (
                      <div className="mt-1.5 flex h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    )}
                    <div className={cn("flex-1 space-y-1", n.read && "pl-5")}>
                      <p className={cn("text-sm font-medium", !n.read ? "text-slate-900 dark:text-[#dce1fb]" : "text-slate-700 dark:text-[#bccbb9]")}>
                        {n.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                        {n.message}
                      </p>
                      <div className="flex items-center gap-4 pt-1">
                        <span className="text-[10px] font-medium text-slate-400">
                          {new Date(n.created_at).toLocaleDateString()}
                        </span>
                        {!n.read && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation()
                              void markAsRead(n.id)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                e.stopPropagation()
                                void markAsRead(n.id)
                              }
                            }}
                            className="text-[10px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            Mark as read
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
