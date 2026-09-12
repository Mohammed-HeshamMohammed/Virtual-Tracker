"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Activity,
  Bell,
  BellOff,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  ClipboardCheck,
  Loader2,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useAuth } from "@/shared/providers/app"
import { apiPath } from "@/infrastructure/api/path"
import { fetchJsonWithRetry, getApiAuthToken } from "@/infrastructure/api/http"
import { clearCoalescedRequest, coalesceRequest } from "@/infrastructure/api/request-coalesce"
import { changedEvent } from "@/infrastructure/api/change-events"
import { NAV_SECTIONS } from "@/shared/ui/layout/config/nav-sections"

export type NotificationItem = {
  id: string
  recipient_id: string
  type: string
  title: string
  message: string
  link?: string
  read: boolean
  created_at: number | string | Date
}

/** Every page the shell can actually open. */
const KNOWN_PAGE_IDS = new Set<string>(
  NAV_SECTIONS.flatMap((section) => [
    ...(section.pages ?? []).map((page) => page.id),
    ...(section.subsections ?? []).flatMap((subsection) => subsection.items.map((item) => item.id)),
  ]),
)

/**
 * Notifications have stored their link in several shapes over time:
 * "/?page=pm-tasks", "/people/members", "people-members",
 * "pm-tasks?project=x". The link used to be handed to the navigator as if it
 * were already a page id, so "/?page=activity-screenshots" opened a blank page
 * by that name. Anything that resolves to a real page opens it; anything else
 * (an old link, or one to something the app has no page for) opens nothing.
 */
export function notificationPageId(link: string | null | undefined): string | null {
  const raw = (link ?? "").trim()
  if (!raw || raw === "/") return null
  const fromQuery = /[?&]page=([^&#]+)/.exec(raw)
  const candidate = fromQuery ? decodeURIComponent(fromQuery[1]) : raw.split(/[?#]/)[0]
  const pageId = candidate.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "-")
  return pageId && KNOWN_PAGE_IDS.has(pageId) ? pageId : null
}

type NotificationsBellProps = {
  onNavigate?: (pageId: string) => void
}

type ListResponse = { success: boolean; data: NotificationItem[]; unreadCount?: number }

/** The loaded page of notifications and the member's true unread total. */
export type NotificationsFeed = { items: NotificationItem[]; unread: number }

/** Everything the bell's panel needs; `useNotifications` is the real one. */
export type NotificationsController = {
  feed: NotificationsFeed
  busy: null | "read-all" | "clear"
  error: string | null
  refresh: () => void
  dismissError: () => void
  markRead: (ids: string[]) => void
  clear: (ids: string[]) => void
  markAllRead: () => Promise<void>
  clearRead: () => Promise<void>
  /** Resolves true once everything is gone. */
  clearAll: () => Promise<boolean>
}

type Entry = { kind: "single"; item: NotificationItem } | { kind: "group"; key: string; items: NotificationItem[] }

const NOTIFICATIONS_LIST_KEY = "notifications-list"
const EMPTY_FEED: NotificationsFeed = { items: [], unread: 0 }

const TONES = {
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  slate: "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-300",
} as const

/** Picked by type prefix, so a new notification type still gets a sensible icon. */
function visualFor(type: string): { icon: LucideIcon; tone: string } {
  const t = (type || "").toLowerCase()
  if (t === "activity_no_screenshot") return { icon: Camera, tone: TONES.amber }
  if (t.startsWith("activity")) return { icon: Activity, tone: TONES.amber }
  if (t.startsWith("task")) return { icon: ClipboardCheck, tone: TONES.blue }
  if (t.startsWith("transfer") || t.startsWith("hierarchy")) return { icon: Users, tone: TONES.violet }
  if (t.includes("budget")) return { icon: Wallet, tone: TONES.rose }
  if (t === "member_first_login") return { icon: UserPlus, tone: TONES.emerald }
  if (t.startsWith("account")) return { icon: ShieldAlert, tone: TONES.rose }
  return { icon: Bell, tone: TONES.slate }
}

function toMs(value: NotificationItem["created_at"]): number {
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

function relativeTime(ms: number, now: number): string {
  const seconds = Math.round((ms - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return "Just now"
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), "minute")
  if (abs < 86_400) return RELATIVE.format(Math.round(seconds / 3600), "hour")
  if (abs < 7 * 86_400) return RELATIVE.format(Math.round(seconds / 86_400), "day")
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(ms: number, now: number): string {
  if (dayKey(ms) === dayKey(now)) return "Today"
  if (dayKey(ms) === dayKey(now - 86_400_000)) return "Yesterday"
  return new Date(ms).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
}

/**
 * Sections by day, newest first. Within a day, alerts sharing a title fold
 * into one expandable group - ten members tripping the same low-activity
 * alert is one thing to act on, not ten.
 */
function buildSections(items: NotificationItem[], now: number) {
  const byDay = new Map<string, NotificationItem[]>()
  for (const item of items) {
    const key = dayKey(toMs(item.created_at))
    const day = byDay.get(key)
    if (day) day.push(item)
    else byDay.set(key, [item])
  }
  return [...byDay.entries()].map(([key, dayItems]) => {
    const byTitle = new Map<string, NotificationItem[]>()
    for (const item of dayItems) {
      const same = byTitle.get(item.title)
      if (same) same.push(item)
      else byTitle.set(item.title, [item])
    }
    const entries: Entry[] = []
    const grouped = new Set<string>()
    for (const item of dayItems) {
      const same = byTitle.get(item.title) ?? [item]
      if (same.length < 2) {
        entries.push({ kind: "single", item })
      } else if (!grouped.has(item.title)) {
        grouped.add(item.title)
        entries.push({ kind: "group", key: `${key}|${item.title}`, items: same })
      }
    }
    return { key, label: dayLabel(toMs(dayItems[0].created_at), now), entries }
  })
}

async function send(path: string, method: "POST" | "DELETE", body?: unknown): Promise<void> {
  const { res, json } = await fetchJsonWithRetry<{ success?: boolean }>(apiPath(path), {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })
  if (!res.ok || json?.success === false) throw new Error(`Notification request failed (${res.status})`)
}

/** The signed-in member's notifications, with optimistic read/clear that
 *  rolls back if the server refuses. */
function useNotifications(): NotificationsController {
  const { isLoggedIn, sessionReady, profile } = useAuth()
  const [feed, setFeed] = useState<NotificationsFeed>(EMPTY_FEED)
  const [busy, setBusy] = useState<NotificationsController["busy"]>(null)
  const [error, setError] = useState<string | null>(null)
  const fetchGenerationRef = useRef(0)
  const feedRef = useRef<NotificationsFeed>(EMPTY_FEED)

  useEffect(() => {
    feedRef.current = feed
  }, [feed])

  const canFetch = isLoggedIn && sessionReady && !profile?.mustChangePassword

  const fetchNotifications = useCallback(async () => {
    if (!canFetch) return
    const token = await getApiAuthToken()
    if (!token) return

    const generation = fetchGenerationRef.current

    try {
      const { res, json } = await coalesceRequest(NOTIFICATIONS_LIST_KEY, () =>
        fetchJsonWithRetry<ListResponse>(apiPath("/api/notifications"), {}, { retries: 2 }),
      )
      if (generation !== fetchGenerationRef.current) return
      if (res.ok && json?.success && Array.isArray(json.data)) {
        const loadedUnread = json.data.filter((n) => !n.read).length
        const next: NotificationsFeed = {
          items: json.data,
          unread: typeof json.unreadCount === "number" ? Math.max(json.unreadCount, loadedUnread) : loadedUnread,
        }
        feedRef.current = next
        setFeed(next)
      }
    } catch {
      // Network blips during login or backend restarts — the next change event refetches.
    }
  }, [canFetch])

  useEffect(() => {
    if (!canFetch) return

    void fetchNotifications()

    const handler = () => void fetchNotifications()
    window.addEventListener(changedEvent("notifications"), handler)
    return () => window.removeEventListener(changedEvent("notifications"), handler)
  }, [fetchNotifications, canFetch])

  const mutate = useCallback(
    async (
      update: (prev: NotificationsFeed) => NotificationsFeed,
      request: () => Promise<void>,
      refetch = false,
    ): Promise<boolean> => {
      fetchGenerationRef.current += 1
      clearCoalescedRequest(NOTIFICATIONS_LIST_KEY)
      const previous = feedRef.current
      const next = update(previous)
      feedRef.current = next
      setFeed(next)
      setError(null)
      try {
        await request()
        // Clearing frees room in the 30-item page; fill it from the server.
        if (refetch) await fetchNotifications()
        return true
      } catch (e) {
        fetchGenerationRef.current += 1
        feedRef.current = previous
        setFeed(previous)
        setError("Couldn't update your notifications. Please try again.")
        console.error("Notification update failed", e)
        return false
      }
    },
    [fetchNotifications],
  )

  const markRead = useCallback(
    (ids: string[]) => {
      const unreadIds = feedRef.current.items.filter((n) => ids.includes(n.id) && !n.read).map((n) => n.id)
      if (unreadIds.length === 0) return
      const target = new Set(unreadIds)
      void mutate(
        (prev) => ({
          items: prev.items.map((n) => (target.has(n.id) ? { ...n, read: true } : n)),
          unread: Math.max(0, prev.unread - unreadIds.length),
        }),
        () =>
          unreadIds.length === 1
            ? send(`/api/notifications/${unreadIds[0]}/read`, "POST")
            : send("/api/notifications/read", "POST", { ids: unreadIds }),
      )
    },
    [mutate],
  )

  const clear = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const target = new Set(ids)
      void mutate(
        (prev) => ({
          items: prev.items.filter((n) => !target.has(n.id)),
          unread: Math.max(0, prev.unread - prev.items.filter((n) => target.has(n.id) && !n.read).length),
        }),
        () => (ids.length === 1 ? send(`/api/notifications/${ids[0]}`, "DELETE") : send("/api/notifications/clear", "POST", { ids })),
        ids.length > 1,
      )
    },
    [mutate],
  )

  const markAllRead = useCallback(async () => {
    if (busy || feedRef.current.unread === 0) return
    setBusy("read-all")
    await mutate(
      (prev) => ({ items: prev.items.map((n) => ({ ...n, read: true })), unread: 0 }),
      () => send("/api/notifications/read-all", "POST"),
    )
    setBusy(null)
  }, [busy, mutate])

  const clearRead = useCallback(async () => {
    if (busy) return
    setBusy("clear")
    await mutate(
      (prev) => ({ items: prev.items.filter((n) => !n.read), unread: prev.unread }),
      () => send("/api/notifications/clear", "POST", { readOnly: true }),
      true,
    )
    setBusy(null)
  }, [busy, mutate])

  const clearAll = useCallback(async () => {
    if (busy) return false
    setBusy("clear")
    const ok = await mutate(() => EMPTY_FEED, () => send("/api/notifications/clear", "POST", { all: true }), true)
    setBusy(null)
    return ok
  }, [busy, mutate])

  return {
    feed,
    busy,
    error,
    refresh: () => void fetchNotifications(),
    dismissError: () => setError(null),
    markRead,
    clear,
    markAllRead,
    clearRead,
    clearAll,
  }
}

const ACCENT_TEXT = "text-[#6b38d4] dark:text-[#4be277]"
const UNREAD_DOT = "h-1.5 w-1.5 shrink-0 rounded-full bg-[#6b38d4] dark:bg-[#4be277]"
const ACTIONS =
  "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"

function ActionButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-white/5 [&_svg]:h-3.5 [&_svg]:w-3.5",
        danger ? "hover:text-rose-600 dark:hover:text-rose-400" : "hover:text-slate-700 dark:hover:text-slate-200",
      )}
    >
      {children}
    </button>
  )
}

function NotificationRow({
  item,
  now,
  nested,
  onOpen,
  onRead,
  onClear,
}: {
  item: NotificationItem
  now: number
  nested?: boolean
  onOpen: (item: NotificationItem) => void
  onRead: (ids: string[]) => void
  onClear: (ids: string[]) => void
}) {
  const { icon: Icon, tone } = visualFor(item.type)
  const ms = toMs(item.created_at)
  return (
    <li
      className={cn(
        "group relative flex items-start gap-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]",
        nested ? "py-2 pl-3 pr-4" : "px-4 py-3",
      )}
    >
      {nested ? null : (
        <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone)}>
          <Icon className="h-4 w-4" />
        </span>
      )}
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn("min-w-0 flex-1 text-left outline-hidden", !item.link && item.read && "cursor-default")}
      >
        {nested ? null : (
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm",
              item.read ? "font-medium text-slate-600 dark:text-slate-300" : "font-semibold text-slate-900 dark:text-[#dce1fb]",
            )}
          >
            {item.read ? null : <span aria-hidden className={UNREAD_DOT} />}
            <span className="truncate">{item.title}</span>
          </p>
        )}
        <p
          className={cn(
            "line-clamp-2 text-xs leading-relaxed",
            nested && !item.read ? "text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400",
            !nested && "mt-0.5",
          )}
        >
          {nested && !item.read ? <span aria-hidden className={cn(UNREAD_DOT, "mr-1.5 inline-block align-middle")} /> : null}
          {item.message}
        </p>
        <p className="mt-1 text-[11px] font-medium text-slate-400 dark:text-slate-500" title={new Date(ms).toLocaleString()}>
          {relativeTime(ms, now)}
        </p>
      </button>
      <div className={ACTIONS}>
        {item.read ? null : (
          <ActionButton label="Mark as read" onClick={() => onRead([item.id])}>
            <Check />
          </ActionButton>
        )}
        <ActionButton label="Clear" danger onClick={() => onClear([item.id])}>
          <X />
        </ActionButton>
      </div>
    </li>
  )
}

function NotificationGroup({
  items,
  expanded,
  onToggle,
  now,
  onOpen,
  onRead,
  onClear,
}: {
  items: NotificationItem[]
  expanded: boolean
  onToggle: () => void
  now: number
  onOpen: (item: NotificationItem) => void
  onRead: (ids: string[]) => void
  onClear: (ids: string[]) => void
}) {
  const first = items[0]
  const { icon: Icon, tone } = visualFor(first.type)
  const unread = items.filter((n) => !n.read).length
  const ids = items.map((n) => n.id)
  return (
    <li>
      <div className="group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]">
        <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone)}>
          <Icon className="h-4 w-4" />
        </span>
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="min-w-0 flex-1 text-left outline-hidden">
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm",
              unread ? "font-semibold text-slate-900 dark:text-[#dce1fb]" : "font-medium text-slate-600 dark:text-slate-300",
            )}
          >
            {unread ? <span aria-hidden className={UNREAD_DOT} /> : null}
            <span className="truncate">{first.title}</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold tabular-nums text-slate-600 dark:bg-white/10 dark:text-slate-300">
              {items.length}
            </span>
          </p>
          <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{first.message}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {relativeTime(toMs(first.created_at), now)}
            <span aria-hidden>·</span>
            {unread ? `${unread} unread` : "All read"}
            <span aria-hidden>·</span>
            <span className={ACCENT_TEXT}>{expanded ? "Hide" : "Show all"}</span>
            <ChevronDown className={cn("h-3 w-3 transition-transform", ACCENT_TEXT, expanded && "rotate-180")} />
          </p>
        </button>
        <div className={ACTIONS}>
          {unread ? (
            <ActionButton label={`Mark all ${items.length} as read`} onClick={() => onRead(ids)}>
              <CheckCheck />
            </ActionButton>
          ) : null}
          <ActionButton label={`Clear all ${items.length}`} danger onClick={() => onClear(ids)}>
            <Trash2 />
          </ActionButton>
        </div>
      </div>
      {expanded ? (
        <ul className="mb-2 ml-[3.75rem] border-l border-slate-200 dark:border-[#2e3447]">
          {items.map((item) => (
            <NotificationRow key={item.id} item={item} now={now} nested onOpen={onOpen} onRead={onRead} onClear={onClear} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function NotificationsBell({ onNavigate }: NotificationsBellProps) {
  const controller = useNotifications()
  return <NotificationsBellView controller={controller} onNavigate={onNavigate} />
}

/** The bell and its panel, drawn from a controller - see `useNotifications`. */
export function NotificationsBellView({
  controller,
  onNavigate,
}: {
  controller: NotificationsController
  onNavigate?: (pageId: string) => void
}) {
  const { feed, busy, error } = controller
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"all" | "unread">("all")
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const containerRef = useRef<HTMLDivElement>(null)
  const { dismissError } = controller

  const closePanel = useCallback(() => {
    setOpen(false)
    setConfirmClearAll(false)
    dismissError()
  }, [dismissError])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) closePanel()
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [closePanel])

  useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel()
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open, closePanel])

  function openItem(item: NotificationItem) {
    if (!item.read) controller.markRead([item.id])
    const pageId = notificationPageId(item.link)
    if (pageId && onNavigate) {
      onNavigate(pageId)
      closePanel()
    }
  }

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function togglePanel() {
    if (open) {
      closePanel()
      return
    }
    setNow(Date.now())
    setOpen(true)
    controller.refresh()
  }

  async function confirmAndClearAll() {
    if (await controller.clearAll()) setConfirmClearAll(false)
  }

  const visible = useMemo(() => (tab === "unread" ? feed.items.filter((n) => !n.read) : feed.items), [feed.items, tab])
  const sections = useMemo(() => buildSections(visible, now), [visible, now])
  const hasRead = feed.items.some((n) => n.read)
  const badge = feed.unread > 99 ? "99+" : String(feed.unread)

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={togglePanel}
        aria-label={feed.unread ? `Notifications, ${feed.unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-[#2e3447] dark:hover:text-[#bccbb9]"
      >
        <Bell className="h-5 w-5" />
        {feed.unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-[#151b2d]">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 flex max-h-[min(80vh,40rem)] w-[24rem] max-w-[calc(100vw-1.5rem)] origin-top-right flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#2e3447] dark:bg-[#191f31] dark:[color-scheme:dark]"
        >
          <div className="border-b border-slate-100 px-4 pb-2.5 pt-3.5 dark:border-[#2e3447]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-[#dce1fb]">Notifications</h3>
                {feed.unread > 0 ? (
                  <span className="rounded-full bg-[#6b38d4]/10 px-2 py-0.5 text-[11px] font-bold text-[#6b38d4] dark:bg-[#4be277]/10 dark:text-[#4be277]">
                    {feed.unread} new
                  </span>
                ) : null}
              </div>
              {feed.unread > 0 ? (
                <button
                  type="button"
                  onClick={() => void controller.markAllRead()}
                  disabled={busy !== null}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5",
                    ACCENT_TEXT,
                  )}
                >
                  {busy === "read-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                  Mark all read
                </button>
              ) : null}
            </div>
            <div role="group" aria-label="Show" className="mt-2.5 inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-[#151b2d]">
              {(["all", "unread"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-pressed={tab === id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                    tab === id
                      ? "bg-white text-slate-900 shadow-sm dark:bg-[#2e3447] dark:text-white"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                  )}
                >
                  {id === "all" ? "All" : "Unread"}
                  {id === "unread" && feed.unread > 0 ? (
                    <span className="tabular-nums text-slate-400 dark:text-slate-500">{feed.unread}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300"
            >
              {error}
            </p>
          ) : null}

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <div className="mb-3 rounded-2xl bg-slate-50 p-3 dark:bg-[#2e3447]/60">
                  {tab === "unread" ? (
                    <CheckCheck className="h-6 w-6 text-slate-400 dark:text-slate-500" />
                  ) : (
                    <BellOff className="h-6 w-6 text-slate-400 dark:text-slate-500" />
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-800 dark:text-[#dce1fb]">
                  {tab === "unread" ? "No unread notifications" : "All caught up"}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {tab === "unread" ? "You've read everything." : "You don't have any notifications right now."}
                </p>
                {tab === "unread" && feed.items.length > 0 ? (
                  <button type="button" onClick={() => setTab("all")} className={cn("mt-3 text-xs font-semibold hover:underline", ACCENT_TEXT)}>
                    Show all notifications
                  </button>
                ) : null}
              </div>
            ) : (
              sections.map((section) => (
                <section key={section.key}>
                  <h4 className="sticky top-0 z-10 bg-white/95 px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur dark:bg-[#191f31]/95 dark:text-slate-500">
                    {section.label}
                  </h4>
                  <ul className="divide-y divide-slate-100 dark:divide-[#2e3447]/70">
                    {section.entries.map((entry) =>
                      entry.kind === "single" ? (
                        <NotificationRow
                          key={entry.item.id}
                          item={entry.item}
                          now={now}
                          onOpen={openItem}
                          onRead={controller.markRead}
                          onClear={controller.clear}
                        />
                      ) : (
                        <NotificationGroup
                          key={entry.key}
                          items={entry.items}
                          expanded={expanded.has(entry.key)}
                          onToggle={() => toggleGroup(entry.key)}
                          now={now}
                          onOpen={openItem}
                          onRead={controller.markRead}
                          onClear={controller.clear}
                        />
                      ),
                    )}
                  </ul>
                </section>
              ))
            )}
          </div>

          {feed.items.length > 0 ? (
            <div className="flex min-h-12 items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-[#2e3447] dark:bg-[#151b2d]/60">
              {confirmClearAll ? (
                <>
                  <span className="pl-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                    Clear all notifications? This can&apos;t be undone.
                  </span>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmClearAll(false)}
                      disabled={busy !== null}
                      className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmAndClearAll()}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                    >
                      {busy === "clear" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Clear all
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void controller.clearRead()}
                    disabled={busy !== null || !hasRead}
                    className="rounded-md px-2 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"
                  >
                    Clear read
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(true)}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear all
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
