"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/api/http"
import { isNotificationsBellEnabled } from "@/lib/notify-prefs"

type Notification = {
  id: string
  type: string
  title: string
  message: string
  link?: string
  read: boolean
  created_at: number | string
}

const POLL_MS = 30_000

export default function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setEnabled(isNotificationsBellEnabled())
  }, [])

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiFetch("/api/notifications", { method: "GET" })
      const data: unknown = await res.json().catch(() => null)
      if (res.ok && data && typeof data === "object" && (data as { success?: unknown }).success === true) {
        const list = (data as { data?: Notification[] }).data
        if (Array.isArray(list)) setNotifications(list)
      }
    } catch {
      /* leave existing state — best-effort */
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void fetchNotifications()
    const interval = window.setInterval(() => void fetchNotifications(), POLL_MS)
    return () => window.clearInterval(interval)
  }, [open, fetchNotifications])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  async function markAsRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: "POST" })
    } catch {
      /* best-effort */
    }
  }

  async function markAllRead() {
    if (markingAllRead) return
    setMarkingAllRead(true)
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    try {
      await apiFetch("/api/notifications/read-all", { method: "POST" })
    } catch {
      /* best-effort */
    } finally {
      setMarkingAllRead(false)
    }
  }

  const unreadCount = notifications.filter((n) => !n.read).length

  if (!enabled) return null

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 transition-colors"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-100 bg-white py-2 shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
            <span className="text-sm font-bold text-slate-900">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" onClick={() => void markAllRead()} className="text-xs font-semibold text-violet-600 hover:text-violet-800">
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">No notifications yet.</p>
          ) : (
            notifications.map((n) => (
              <a
                key={n.id}
                href={n.link || "#"}
                onClick={() => void markAsRead(n.id)}
                className={`block px-4 py-3 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0 ${!n.read ? "bg-violet-50/40" : ""}`}
              >
                <p className="font-semibold text-slate-800">{n.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{n.message}</p>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  )
}
