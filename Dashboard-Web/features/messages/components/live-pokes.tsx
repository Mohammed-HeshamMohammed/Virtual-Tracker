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
import { openBuzzWindow } from "@/features/messages/components/buzz-window"
import { playBuzzSound } from "@/features/messages/components/buzz-sound"

/**
 * How long a nudge card stays up if it is not closed - counted only while the tab is on screen,
 * so a buzz that arrives in a background tab is still there when they come back. A blue screen
 * stays until closed.
 */
const NUDGE_VISIBLE_MS = 20_000

function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window
}

function tabInBackground(): boolean {
  return document.visibilityState === "hidden" || !document.hasFocus()
}

/**
 * A buzz that lands in a background tab would otherwise go unseen until they switch back, so
 * it also becomes a system notification - only when they have allowed notifications for the
 * dashboard (see NotifyMeButton), and only when the tab is not in front, where the card itself
 * already shows. Clicking it brings the dashboard forward.
 */
function notifyInBackground(buzz: LiveBuzzMessage) {
  if (!notificationsSupported() || Notification.permission !== "granted" || !tabInBackground()) return
  try {
    const notification = new Notification(`Buzz from ${buzz.from}`, {
      body: buzz.message,
      tag: "vt-buzz",
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch {
    /* Some browsers (Android Chrome) only allow notifications from a service worker. The card
       in the tab still shows. */
  }
}

const CORNER_CLASS: Record<LiveBuzzMessage["corner"], string> = {
  "top-right": "top-4 right-4",
  "top-left": "top-4 left-4",
  "bottom-right": "bottom-4 right-4",
  "bottom-left": "bottom-4 left-4",
}

/**
 * What the Owner or a Super Admin can send to this person's open dashboard, live:
 *  - a buzz, when their desktop tracker is not open to show it (a nudge or a joke blue screen),
 *    which they can always close at once. It opens in its own window on top (buzz-window.ts)
 *    when the browser allows pop-ups for the dashboard; otherwise it shows in this tab, with a
 *    notification when the tab is in the background and a hint on allowing pop-ups;
 *  - a request to reload the page, so it loads the latest release. It counts down first, says
 *    who asked, and offers to reload now.
 */
export function LivePokes() {
  const [buzz, setBuzz] = useState<LiveBuzzMessage | null>(null)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const [refresh, setRefresh] = useState<LiveRefreshPageMessage | null>(null)
  // Stable, so the buzz's own timer and focus are not reset on every render.
  const closeBuzz = useCallback(() => setBuzz(null), [])

  useEffect(() => {
    const onBuzz = (e: Event) => {
      const detail = (e as CustomEvent<LiveBuzzMessage>).detail
      // From this tab, not the buzz window: a new window has no click on it yet, so the
      // browser would keep it silent.
      void playBuzzSound(detail)
      if (openBuzzWindow(detail)) {
        setBuzz(null)
        return
      }
      setPopupBlocked(true)
      setBuzz(detail)
      notifyInBackground(detail)
    }
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
      {buzz ? <BuzzView key={buzz.at} buzz={buzz} popupBlocked={popupBlocked} onClose={closeBuzz} /> : null}
      {refresh ? <RefreshCountdown key={refresh.at} request={refresh} /> : null}
    </>
  )
}

function BuzzView({
  buzz,
  popupBlocked,
  onClose,
}: {
  buzz: LiveBuzzMessage
  popupBlocked: boolean
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // A nudge hides itself after NUDGE_VISIBLE_MS on screen; the clock only runs while the tab is
  // visible, so one that arrived in a background tab waits for them.
  useEffect(() => {
    if (buzz.style !== "nudge") return
    let timer: ReturnType<typeof setTimeout> | null = null
    const sync = () => {
      if (document.visibilityState === "visible") {
        if (!timer) timer = setTimeout(onClose, NUDGE_VISIBLE_MS)
      } else if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    sync()
    document.addEventListener("visibilitychange", sync)
    return () => {
      document.removeEventListener("visibilitychange", sync)
      if (timer) clearTimeout(timer)
    }
  }, [buzz.style, onClose])

  // While the tab is in the background its title says there is a buzz, so it shows in the tab
  // strip even without notifications. Put back when they look, or when the buzz closes.
  useEffect(() => {
    const original = document.title
    const alertTitle = `⚡ Buzz from ${buzz.from}`
    const sync = () => {
      if (document.visibilityState === "hidden") document.title = alertTitle
      else if (document.title === alertTitle) document.title = original
    }
    sync()
    document.addEventListener("visibilitychange", sync)
    return () => {
      document.removeEventListener("visibilitychange", sync)
      if (document.title === alertTitle) document.title = original
    }
  }, [buzz.from])

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
        <NotifyMeButton className="mt-4 text-white/80 hover:text-white" />
        {popupBlocked ? <PopupHint className="mt-3 text-white/80" /> : null}
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
          <NotifyMeButton className="mt-2 text-blue-600 hover:text-blue-700 dark:text-emerald-400 dark:hover:text-emerald-300" />
          {popupBlocked ? <PopupHint className="mt-2 text-slate-500 dark:text-slate-400" /> : null}
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

/**
 * Asks once for permission to show buzzes as system notifications. Browsers only allow that
 * question from a click, so it is offered on the buzz itself - the moment the person has just
 * seen what it is for. Hidden once they have answered (or when the browser has no
 * notifications).
 */
function NotifyMeButton({ className }: { className?: string }) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    notificationsSupported() ? Notification.permission : "unsupported",
  )
  if (permission !== "default") return null
  return (
    <button
      type="button"
      onClick={() => {
        void Notification.requestPermission()
          .then(setPermission)
          .catch(() => setPermission("denied"))
      }}
      className={cn("block text-left text-xs font-semibold underline underline-offset-2", className)}
    >
      Also notify me when this tab is in the background
    </button>
  )
}

/** Shown on a buzz the browser would not open in its own window. */
function PopupHint({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] leading-snug", className)}>
      Your browser blocked this buzz from opening in its own window. To allow it, click the pop-up
      icon at the right of the address bar and choose to always allow pop-ups from this site.
    </p>
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
