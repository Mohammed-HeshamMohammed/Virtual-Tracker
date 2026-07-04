"use client"

import { useEffect, useRef, useState } from "react"
import AppCtaLink from "@/components/AppCtaLink"
import { getSignInHref, getDashboardUrl } from "@/lib/site-urls"
import { fetchSessionStatus, logoutSharedSession, type SessionStatus } from "@/lib/session-status"

type AuthNavActionProps = {
  isTransparent: boolean
  btnBg: string
}

function initialsOf(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""
  return `${first}${last}`.toUpperCase()
}

export default function AuthNavAction({ isTransparent, btnBg }: AuthNavActionProps) {
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void fetchSessionStatus().then((result) => {
      if (!cancelled) setStatus(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  if (!status?.signedIn) {
    return (
      <AppCtaLink
        href={getSignInHref()}
        className="relative flex items-center group cursor-pointer"
        style={{ filter: "url(#gooey-filter)" }}
      >
        <span
          className={`absolute right-0 px-3 rounded-full font-semibold text-sm transition-all duration-300 cursor-pointer h-10 flex items-center justify-center -translate-x-12 group-hover:-translate-x-[6.5rem] z-0 ${btnBg}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7V17" />
          </svg>
        </span>
        <span className={`px-8 py-2.5 rounded-full font-semibold text-sm transition-all duration-300 cursor-pointer h-10 flex items-center z-10 ${btnBg}`}>
          Sign in
        </span>
      </AppCtaLink>
    )
  }

  const dashboardUrl = getDashboardUrl() ?? "/"

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full ring-2 ring-violet-500/60 transition-shadow hover:ring-violet-500"
        aria-label="Account menu"
        aria-expanded={open}
      >
        {status.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={status.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className={`flex h-full w-full items-center justify-center text-sm font-semibold ${isTransparent ? "bg-white/20 text-white" : "bg-violet-100 text-violet-700"}`}>
            {initialsOf(status.displayName)}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-slate-100 bg-white py-2 shadow-xl z-50">
          {status.displayName && (
            <div className="px-4 py-2 text-sm font-medium text-slate-900 truncate border-b border-slate-100">
              {status.displayName}
            </div>
          )}
          <a
            href={dashboardUrl}
            className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Open dashboard
          </a>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void logoutSharedSession().then(() => setStatus({ signedIn: false, displayName: null, avatarUrl: null }))
            }}
            className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
