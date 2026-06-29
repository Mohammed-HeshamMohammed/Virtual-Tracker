"use client"

import { useEffect, useState } from "react"
import { isLauncherHost } from "@/features/auth/services/launcher-runtime"
import { LauncherChrome } from "@/features/auth/components/launcher-chrome"
import { LauncherOAuthReturn } from "@/features/auth/components/launcher-oauth-return"

export function LauncherShell({ children }: { children: React.ReactNode }) {
  const [inLauncher, setInLauncher] = useState(false)

  useEffect(() => {
    if (isLauncherHost()) {
      setInLauncher(true)

      const handleGlobalClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        const anchor = target.closest("a")
        if (anchor && anchor.getAttribute("target") === "_blank") {
          e.preventDefault()
          window.location.href = anchor.href
        }
      }

      document.addEventListener("click", handleGlobalClick)
      return () => {
        document.removeEventListener("click", handleGlobalClick)
      }
    }
  }, [])

  return (
    <div className={`launcher-shell ${inLauncher ? "in-launcher" : ""}`}>
      <LauncherChrome />
      <div className="launcher-shell-body">{children}</div>
      <LauncherOAuthReturn />
    </div>
  )
}
