"use client"

import { useEffect, useState } from "react"
import { getCookieConsent, setCookieConsent, type CookieConsentValue } from "@/lib/cookie-consent"

export default function CookieConsentBanner() {
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
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800 bg-slate-900/95 px-4 py-4 shadow-lg backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-300">
          We use cookies to keep you signed in and remember your preferences across Virtual Tracker.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => respond("declined")}
            className="rounded-full border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Necessary only
          </button>
          <button
            type="button"
            onClick={() => respond("accepted")}
            className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
