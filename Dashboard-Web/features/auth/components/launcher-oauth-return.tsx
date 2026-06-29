"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/shared/providers/app"
import { broadcastAuthSessionReady } from "@/features/auth/services/auth-cross-tab-sync"
import { isLauncherHost } from "@/features/auth/services/launcher-runtime"

export function LauncherOAuthReturn() {
  const { isLoggedIn, sessionReady } = useAuth()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!isLauncherHost()) return
    if (window.pywebview?.api) return
    if (!isLoggedIn || !sessionReady) return

    setVisible(true)
    broadcastAuthSessionReady()
  }, [isLoggedIn, sessionReady])

  if (!visible) return null

  return (
    <div className="launcher-oauth-return" role="status" aria-live="polite">
      <div className="launcher-oauth-return-card">
        <p className="launcher-oauth-return-title">Google sign-in complete</p>
        <p className="launcher-oauth-return-body">
          Close this browser tab and return to the Virtual Tracker app window. If the app does not update
          automatically, click <strong>Sign in with Google</strong> once more in the app.
        </p>
      </div>
    </div>
  )
}
