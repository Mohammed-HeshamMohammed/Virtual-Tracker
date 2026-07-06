"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useCurrentUser } from "@/lib/auth/use-current-user"
import { apiFetch } from "@/lib/api/http"
import { getDashboardUrl, getSignInHref, getTrialHref } from "@/lib/site-urls"
import { PLATFORM_NAV_TABS, SOLUTIONS } from "@/lib/product-content"

type NotificationRow = { id: string; title: string; message: string; link?: string; read: boolean }
type ViewName = "menu" | "notifications" | "account" | "start" | null

const ICONS = {
  menu: "M4 6h16M4 12h16M4 18h16",
  bell: "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  home: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  user: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  bolt: "M13 10V3L4 14h7v7l9-11h-7z",
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

const panelItemClass = "block w-full rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"

export default function MobileBottomNav() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ViewName>(null)
  const { user, profile } = useCurrentUser()
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setView(null)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  useEffect(() => {
    if (view !== "notifications" || !user) return
    let cancelled = false
    void apiFetch("/api/notifications", { method: "GET" })
      .then((res) => res.json())
      .then((data: unknown) => {
        if (cancelled) return
        if (data && typeof data === "object" && (data as { success?: unknown }).success === true) {
          const list = (data as { data?: NotificationRow[] }).data
          if (Array.isArray(list)) setNotifications(list)
        }
      })
      .catch(() => {
        /* best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [view, user])

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0
  const toggle = (name: ViewName) => setView((prev) => (prev === name ? null : name))

  const panel = (() => {
    switch (view) {
      case "menu":
        return (
          <div className="space-y-0.5 p-1.5">
            {PLATFORM_NAV_TABS.map((tab) => (
              <Link key={tab.label} href={tab.href} className={panelItemClass} onClick={() => setView(null)}>
                {tab.label}
              </Link>
            ))}
            {SOLUTIONS.slice(0, 1).map((s) => (
              <Link key={s.href} href={s.href} className={panelItemClass} onClick={() => setView(null)}>
                Solutions
              </Link>
            ))}
            <Link href="/resources" className={panelItemClass} onClick={() => setView(null)}>
              Resources
            </Link>
            <Link href="/pricing" className={panelItemClass} onClick={() => setView(null)}>
              Pricing
            </Link>
            <Link href="/demo" className={panelItemClass} onClick={() => setView(null)}>
              Demo
            </Link>
            <Link href="/about" className={panelItemClass} onClick={() => setView(null)}>
              About
            </Link>
            <Link href="/contact" className={panelItemClass} onClick={() => setView(null)}>
              Contact
            </Link>
          </div>
        )

      case "notifications":
        return (
          <div className="min-w-[240px] max-w-[280px] space-y-0.5 p-1.5">
            {!user ? (
              <a href={getSignInHref()} className={panelItemClass} onClick={() => setView(null)}>
                Sign in to see notifications
              </a>
            ) : !notifications || notifications.length === 0 ? (
              <p className="px-3.5 py-3 text-sm text-slate-400">No notifications yet.</p>
            ) : (
              notifications.slice(0, 6).map((n) => (
                <a key={n.id} href={n.link || "#"} className={panelItemClass} onClick={() => setView(null)}>
                  <span className="block truncate">{n.title}</span>
                  <span className="block truncate text-xs font-normal text-slate-400">{n.message}</span>
                </a>
              ))
            )}
          </div>
        )

      case "account":
        return (
          <div className="min-w-[220px] space-y-0.5 p-1.5">
            {user ? (
              <>
                {profile?.displayName && (
                  <div className="truncate px-3.5 py-2 text-sm font-medium text-slate-900">{profile.displayName}</div>
                )}
                <Link href="/account/reports" className={panelItemClass} onClick={() => setView(null)}>
                  My Activity
                </Link>
                <Link href="/account/profile" className={panelItemClass} onClick={() => setView(null)}>
                  Profile
                </Link>
                <Link href="/account/subscription" className={panelItemClass} onClick={() => setView(null)}>
                  View Subscription
                </Link>
                <Link href="/account/settings" className={panelItemClass} onClick={() => setView(null)}>
                  Settings
                </Link>
                <div className="my-1 border-t border-slate-100" />
                <a href={getDashboardUrl() ?? "/"} className={panelItemClass} onClick={() => setView(null)}>
                  Open dashboard
                </a>
              </>
            ) : (
              <a href={getSignInHref()} className={panelItemClass} onClick={() => setView(null)}>
                Sign in / Create account
              </a>
            )}
          </div>
        )

      case "start":
        return (
          <div className="min-w-[220px] space-y-0.5 p-1.5">
            <a href={getTrialHref()} className={panelItemClass} onClick={() => setView(null)}>
              Start free trial
            </a>
            <Link href="/demo" className={panelItemClass} onClick={() => setView(null)}>
              View live demo
            </Link>
            <Link href="/pricing" className={panelItemClass} onClick={() => setView(null)}>
              View pricing
            </Link>
            <Link href="/contact" className={panelItemClass} onClick={() => setView(null)}>
              Talk to sales
            </Link>
          </div>
        )

      default:
        return null
    }
  })()

  return (
    <div ref={containerRef} className="fixed inset-x-0 bottom-0 z-50 flex justify-center pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      {view && (
        <div className="absolute bottom-[64px] max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-100 bg-white/95 shadow-xl backdrop-blur-xl">
          {panel}
        </div>
      )}

      <div className="flex items-center gap-1 rounded-full border border-slate-100 bg-white/95 p-1.5 shadow-lg backdrop-blur-xl">
        <button
          type="button"
          aria-label="Menu"
          onClick={() => toggle("menu")}
          className={`rounded-full p-3 transition-colors ${view === "menu" ? "bg-violet-50 text-violet-700" : "text-slate-500 hover:bg-slate-50"}`}
        >
          <NavIcon d={ICONS.menu} />
        </button>

        <button
          type="button"
          aria-label="Notifications"
          onClick={() => toggle("notifications")}
          className={`relative rounded-full p-3 transition-colors ${view === "notifications" ? "bg-violet-50 text-violet-700" : "text-slate-500 hover:bg-slate-50"}`}
        >
          <NavIcon d={ICONS.bell} />
          {unreadCount > 0 && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-red-500" />}
        </button>

        <Link
          href="/"
          aria-label="Home"
          onClick={() => setView(null)}
          className="rounded-full bg-violet-600 p-3 text-white shadow-md shadow-violet-200 transition-colors hover:bg-violet-700"
        >
          <NavIcon d={ICONS.home} />
        </Link>

        <button
          type="button"
          aria-label="Account"
          onClick={() => toggle("account")}
          className={`rounded-full p-3 transition-colors ${view === "account" ? "bg-violet-50 text-violet-700" : "text-slate-500 hover:bg-slate-50"}`}
        >
          <NavIcon d={ICONS.user} />
        </button>

        <button
          type="button"
          aria-label="Get started"
          onClick={() => toggle("start")}
          className={`rounded-full p-3 transition-colors ${view === "start" ? "bg-violet-50 text-violet-700" : "text-slate-500 hover:bg-slate-50"}`}
        >
          <NavIcon d={ICONS.bolt} />
        </button>
      </div>
    </div>
  )
}
