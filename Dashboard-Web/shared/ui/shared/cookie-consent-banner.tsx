"use client"

import { useEffect, useState } from "react"
import { getCookieConsent, setCookieConsent, type CookieConsentValue } from "@/shared/utils/cookie-consent"

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(getCookieConsent() === null)
  }, [])

  if (!visible) return null

  function respond(value: CookieConsentValue) {
    setCookieConsent(value)
    setVisible(false)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-4 py-4 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          We use cookies to keep you signed in and remember your preferences across Virtual Tracker.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => respond("declined")}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Necessary only
          </button>
          <button
            type="button"
            onClick={() => respond("accepted")}
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
