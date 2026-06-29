"use client"

/**
 * LauncherChrome — custom frameless titlebar for the Dashboard pywebview window.
 * Currently disabled: the Dashboard uses the native Windows titlebar (frameless=False).
 * Re-enable by removing the early return below and setting frameless=True in launcher.py.
 */
export function LauncherChrome() {
  return null
}

/*
import { useEffect, useState } from "react"
import { closeLauncherAppWindow, isLauncherHost, maximizeLauncherAppWindow, minimizeLauncherAppWindow } from "@/features/auth/services/launcher-runtime"

export function LauncherChromeComponent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isLauncherHost()) {
      setVisible(true)
      return
    }

    const handleReady = () => {
      if (isLauncherHost()) {
        setVisible(true)
      }
    }

    window.addEventListener("pywebviewready", handleReady)

    // Polling fallback to check every 200ms
    const interval = setInterval(() => {
      if (isLauncherHost()) {
        setVisible(true)
        clearInterval(interval)
      }
    }, 200)

    return () => {
      window.removeEventListener("pywebviewready", handleReady)
      clearInterval(interval)
    }
  }, [])

  if (!visible) return null

  return (
    <header className="launcher-chrome" role="banner">
      <div className="launcher-chrome-drag pywebview-drag-region">
        <img className="launcher-chrome-icon" src="/icon-dark-32x32.png" width={18} height={18} alt="" />
        <span className="launcher-chrome-title">Virtual Tracker</span>
      </div>
      <div className="launcher-chrome-controls">
        <button
          className="launcher-chrome-minimize"
          type="button"
          title="Minimize"
          aria-label="Minimize dashboard window"
          onClick={() => minimizeLauncherAppWindow()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="launcher-chrome-maximize"
          type="button"
          title="Maximize / Restore"
          aria-label="Maximize or restore dashboard window"
          onClick={() => maximizeLauncherAppWindow()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth={2} fill="none" />
          </svg>
        </button>
        <button
          className="launcher-chrome-close"
          type="button"
          title="Close dashboard"
          aria-label="Close dashboard and return to launcher"
          onClick={() => closeLauncherAppWindow()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  )
}
*/

