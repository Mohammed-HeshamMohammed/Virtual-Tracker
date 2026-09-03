"use client"

import React, { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { NotifyAlert, type NotifyAlertTone } from "@/shared/ui/alert-notify"

const AUTO_DISMISS_MS = 14_000

export interface NotifyToastHostProps {
  message: string | null
  onDismiss: () => void
  title?: string
  tone?: NotifyAlertTone
}

export function NotifyToastHost({ message, onDismiss, title = "Notice", tone = "error" }: NotifyToastHostProps): React.ReactElement | null {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => onDismiss(), AUTO_DISMISS_MS)
    return () => window.clearTimeout(t)
  }, [message, onDismiss])

  if (!mounted || typeof document === "undefined" || !message) {
    return null
  }

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-220 flex w-[min(calc(100vw-2rem),22rem)] flex-col"
      aria-live="polite"
    >
      <div className="pointer-events-auto">
        <NotifyAlert title={title} description={message} tone={tone} onDismiss={onDismiss} />
      </div>
    </div>,
    document.body,
  )
}
