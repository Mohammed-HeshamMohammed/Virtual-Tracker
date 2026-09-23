"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Bell, Check, MessageSquare, Send } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { notificationTarget, type NotificationItem } from "@/shared/ui/layout/components/topbar/notifications-bell"
import {
  fetchNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/features/notifications/api/notifications-page-api"
import { MessageThreadsPanel } from "@/features/messages/components/message-threads-panel"
import type { NavigateHandler, NavigateParams } from "@/app/routes/types"

const PAGE_SIZE = 25

/**
 * The full Notifications page (PLAN-notifications-and-owner-messaging.md B3).
 * The bell shows the newest few; this is the history, with filters, and it is
 * also where Owner<->member conversations are read and replied to.
 */
export function NotificationsPage({
  onNavigate,
  pageParams,
}: {
  onNavigate?: NavigateHandler
  pageParams?: NavigateParams
}) {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  // A notification that links to a thread lands here with ?thread=..., so it
  // opens the conversation rather than just the page.
  const [tab, setTab] = useState<"notifications" | "messages">(pageParams?.thread ? "messages" : "notifications")

  const [items, setItems] = useState<NotificationItem[]>([])
  const [total, setTotal] = useState(0)
  const [types, setTypes] = useState<string[]>([])
  const [unread, setUnread] = useState(0)
  const [page, setPage] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [typeFilter, setTypeFilter] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (pageParams?.thread) setTab("messages")
  }, [pageParams?.thread])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const result = await fetchNotificationsPage({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        unreadOnly,
        type: typeFilter,
      })
      setItems(result.notifications)
      setTotal(result.total)
      setTypes(result.types)
      setUnread(result.unreadCount)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications")
    } finally {
      setLoading(false)
    }
  }, [page, unreadOnly, typeFilter])

  useEffect(() => {
    if (tab === "notifications") void load()
  }, [load, tab])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  async function open(item: NotificationItem) {
    if (!item.read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)))
      setUnread((n) => Math.max(0, n - 1))
      void markNotificationRead(item.id).catch(() => undefined)
    }
    const target = notificationTarget(item.link)
    if (target && onNavigate) onNavigate(target.pageId, target.params)
  }

  const label = useMemo(
    () => (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    [],
  )

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-2">
      <div className={cn("shrink-0 rounded-xl border p-5", t.tableBorder, t.tableBg)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Bell className={cn("h-5 w-5", isDark ? "text-[#4be277]" : "text-blue-600")} />
              <h2 className={cn("text-lg font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                Notifications
              </h2>
              {unread > 0 ? (
                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white dark:bg-emerald-600">
                  {unread}
                </span>
              ) : null}
            </div>
            <p className={cn("mt-0.5 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
              Everything you have been sent, and your conversations with the Owner.
            </p>
          </div>
          {tab === "notifications" && unread > 0 ? (
            <button
              type="button"
              onClick={async () => {
                await markAllNotificationsRead().catch(() => undefined)
                await load()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Check className="h-3.5 w-3.5" />
              Mark all read
            </button>
          ) : null}
        </div>

        <div className="mt-4 flex gap-1">
          {(["notifications", "messages"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors",
                tab === key
                  ? isDark
                    ? "border-[#4be277] text-[#dce1fb]"
                    : "border-blue-600 text-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200",
              )}
            >
              {key === "notifications" ? <Bell className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
              {key === "notifications" ? "Notifications" : "Messages"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-auto">
        {tab === "messages" ? (
          <MessageThreadsPanel initialThreadId={pageParams?.thread} />
        ) : (
          <div className={cn("rounded-xl border", t.tableBorder, t.tableBg)}>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 p-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setUnreadOnly((v) => !v)
                  setPage(0)
                }}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  unreadOnly
                    ? "bg-blue-600 text-white dark:bg-emerald-600"
                    : "border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300",
                )}
              >
                Unread only
              </button>
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value)
                  setPage(0)
                }}
                aria-label="Filter by type"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="">All types</option>
                {types.map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </div>

            {error ? <p className="p-4 text-sm text-red-500">{error}</p> : null}
            {loading ? (
              <p className="p-6 text-center text-sm text-slate-400">Loading…</p>
            ) : items.length === 0 ? (
              <p className="p-10 text-center text-sm text-slate-400">Nothing here yet.</p>
            ) : (
              <ul>
                {items.map((item) => {
                  const openable = Boolean(notificationTarget(item.link))
                  return (
                    <li key={item.id} className="border-b border-slate-200/60 last:border-0 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => void open(item)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60",
                          !openable && "cursor-default",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            item.read ? "bg-transparent" : "bg-blue-600 dark:bg-emerald-500",
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                            {item.title}
                          </span>
                          <span className={cn("mt-0.5 block text-xs", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                            {item.message}
                          </span>
                          <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">
                            {label(item.type)}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {pageCount > 1 ? (
              <div className="flex items-center justify-between p-3 text-xs">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40 dark:border-slate-700"
                >
                  Previous
                </button>
                <span className="text-slate-400">
                  Page {page + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40 dark:border-slate-700"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

export { Send }
