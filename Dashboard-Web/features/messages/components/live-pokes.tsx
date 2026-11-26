"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw, X, Zap } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  VT_LIVE_BUZZ,
  VT_LIVE_REFRESH_PAGE,
  type LiveBuzzMessage,
  type LiveRefreshPageMessage,
} from "@/features/auth/services/presence-ws"

/** How long a nudge card stays up if it is not closed. A blue screen stays until closed. */
const NUDGE_VISIBLE_MS = 20_000

const CORNER_CLASS: Record<LiveBuzzMessage["corner"], string> = {
  "top-right": "top-4 right-4",
  "top-left": "top-4 left-4",
  "bottom-right": "bottom-4 right-4",
  "bottom-left": "bottom-4 left-4",
}

/**
 * What the Owner or a Super Admin can send to this person's open dashboard, live:
 *  - a buzz, when their desktop tracker is not open to show it (a nudge card in a corner, or a
 *    joke blue screen), which they can always close at once;
 *  - a request to reload the page, so it loads the latest release. It counts down first, says
 *    who asked, and offers to reload now.
 */
export function LivePokes() {
  const [buzz, setBuzz] = useState<LiveBuzzMessage | null>(null)
  const [refresh, setRefresh] = useState<LiveRefreshPageMessage | null>(null)
  // Stable, so the buzz's own timer and focus are not reset on every render.
  const closeBuzz = useCallback(() => setBuzz(null), [])

  useEffect(() => {
    const onBuzz = (e: Event) => setBuzz((e as CustomEvent<LiveBuzzMessage>).detail)
    const onRefresh = (e: Event) => setRefresh((e as CustomEvent<LiveRefreshPageMessage>).detail)
    window.addEventListener(VT_LIVE_BUZZ, onBuzz)
    window.addEventListener(VT_LIVE_REFRESH_PAGE, onRefresh)
    return () => {
      window.removeEventListener(VT_LIVE_BUZZ, onBuzz)
      window.removeEventListener(VT_LIVE_REFRESH_PAGE, onRefresh)
    }
  }, [])

  return (
    <>
      {buzz ? <BuzzView key={buzz.at} buzz={buzz} onClose={closeBuzz} /> : null}
      {refresh ? <RefreshCountdown key={refresh.at} request={refresh} /> : null}
    </>
  )
}

function BuzzView({ buzz, onClose }: { buzz: LiveBuzzMessage; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    const timer = buzz.style === "nudge" ? setTimeout(onClose, NUDGE_VISIBLE_MS) : null
    return () => {
      window.removeEventListener("keydown", onKey)
      if (timer) clearTimeout(timer)
    }
  }, [buzz.style, onClose])

  if (buzz.style === "bluescreen") {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`Buzz from ${buzz.from}`}
        className="fixed inset-0 z-[200] flex flex-col justify-center bg-[#0078d7] px-8 text-white sm:px-24"
      >
        <p className="text-7xl font-light sm:text-9xl" aria-hidden="true">
          :(
        </p>
        <p className="mt-8 max-w-2xl text-xl leading-snug sm:text-2xl">
          Your PC ran into a problem and needs you to focus.
        </p>
        <p className="mt-6 max-w-2xl text-lg font-semibold sm:text-xl">{buzz.message}</p>
        <p className="mt-6 text-sm opacity-80">Buzz from {buzz.from}</p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-10 w-fit rounded-lg border border-white/70 px-4 py-2 text-sm font-semibold hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Close this buzz
        </button>
      </div>
    )
  }

  return (
    <div
      role="alert"
      className={cn(
        "fixed z-[200] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-amber-200 bg-white p-4 shadow-2xl dark:border-amber-500/40 dark:bg-slate-900",
        CORNER_CLASS[buzz.corner] ?? CORNER_CLASS["top-right"],
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-amber-100 p-1.5 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300">
          <Zap className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Buzz from {buzz.from}
          </p>
          <p className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-100">{buzz.message}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close this buzz"
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function RefreshCountdown({ request }: { request: LiveRefreshPageMessage }) {
  const total = Math.max(1, Math.min(60, Math.round(request.delaySeconds) || 10))
  const [left, setLeft] = useState(total)

  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => {
      const remaining = total - Math.floor((Date.now() - started) / 1000)
      if (remaining <= 0) {
        clearInterval(timer)
        window.location.reload()
        return
      }
      setLeft(remaining)
    }, 250)
    return () => clearInterval(timer)
  }, [total])

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="This page is about to refresh"
      className="fixed bottom-4 left-1/2 z-[210] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-blue-200 bg-white p-4 shadow-2xl dark:border-emerald-500/40 dark:bg-slate-900"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-blue-100 p-1.5 text-blue-600 dark:bg-emerald-500/20 dark:text-emerald-300">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            This page will refresh in {left} {left === 1 ? "second" : "seconds"}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {request.from} refreshed your page so it loads the latest version of the dashboard.
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          autoFocus
          onClick={() => window.location.reload()}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          Refresh now
        </button>
      </div>
    </div>
  )
}
