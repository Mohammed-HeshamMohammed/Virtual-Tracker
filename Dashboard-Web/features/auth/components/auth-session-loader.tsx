"use client"

import React, { useEffect, useRef } from "react"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { cn } from "@/shared/utils/utils"
import gsap from "gsap"
import { DashboardStatusShell } from "@/shared/ui/errors/dashboard-status-shell"
import { getDashboardStatusStyles } from "@/shared/ui/errors/dashboard-status-theme"
import { ConnectionErrorScreen } from "@/shared/ui/errors/connection-error-screen"

type AuthSessionLoaderProps = {
  message?: string
  error?: string | null
  onRetry?: () => void
  onCancel?: () => void
}

function SessionSpinner({ isDark }: { isDark: boolean }) {
  const t = getDashboardStatusStyles(isDark)
  const ring1Ref = useRef<SVGCircleElement>(null)
  const ring2Ref = useRef<SVGCircleElement>(null)
  const centerDotRef = useRef<SVGCircleElement>(null)

  useEffect(() => {
    const ring1 = ring1Ref.current
    const ring2 = ring2Ref.current
    const centerDot = centerDotRef.current
    if (!ring1 || !ring2 || !centerDot) return

    const rot1 = gsap.to(ring1, {
      rotation: 360,
      transformOrigin: "50% 50%",
      duration: 2,
      repeat: -1,
      ease: "none",
    })
    const rot2 = gsap.to(ring2, {
      rotation: -360,
      transformOrigin: "50% 50%",
      duration: 3,
      repeat: -1,
      ease: "none",
    })
    const pulse = gsap.to(centerDot, {
      scale: 1.4,
      transformOrigin: "50% 50%",
      opacity: 0.7,
      duration: 1.2,
      repeat: -1,
      yoyo: true,
      ease: "power1.inOut",
    })

    return () => {
      rot1.kill()
      rot2.kill()
      pulse.kill()
    }
  }, [])

  const ringTrack = isDark ? "rgba(75, 226, 119, 0.08)" : "rgba(37, 99, 235, 0.08)"
  const ringPrimary = isDark ? "#4be277" : "#2563eb"
  const ringSecondary = isDark ? "#22c55e" : "#1d4ed8"
  const ringInner = isDark ? "rgba(75, 226, 119, 0.05)" : "rgba(37, 99, 235, 0.05)"

  return (
    <div className={cn("mx-auto flex h-24 w-24 items-center justify-center rounded-2xl border", t.iconPanel)}>
      <svg className="h-16 w-16 select-none" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="45" stroke={ringTrack} strokeWidth="2.5" />
        <circle
          ref={ring1Ref}
          cx="50"
          cy="50"
          r="45"
          stroke={ringPrimary}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="70 210"
        />
        <circle cx="50" cy="50" r="28" stroke={ringInner} strokeWidth="2" />
        <circle
          ref={ring2Ref}
          cx="50"
          cy="50"
          r="28"
          stroke={ringSecondary}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="45 130"
        />
        <circle ref={centerDotRef} cx="50" cy="50" r="6" fill={ringPrimary} />
      </svg>
    </div>
  )
}

/** Session bootstrap / reconnect screen — styled like the signed-in dashboard shell. */
export function AuthSessionLoader({
  message = "Checking your session...",
  error,
  onRetry,
  onCancel,
}: AuthSessionLoaderProps) {
  const { isDark } = useTheme()
  const { backendReconnecting, loading } = useAuth()
  const t = getDashboardStatusStyles(isDark)
  const textRef = useRef<HTMLParagraphElement>(null)
  const lastMessageRef = useRef<string>("")

  const showConnectionError = Boolean(error)

  useEffect(() => {
    if (showConnectionError) return
    const textEl = textRef.current
    if (!textEl) return

    const currentText = message
    if (lastMessageRef.current === currentText) return
    lastMessageRef.current = currentText

    gsap.timeline()
      .to(textEl, {
        opacity: 0,
        y: -8,
        duration: 0.2,
        ease: "power2.in",
        onComplete: () => {
          textEl.textContent = currentText
        },
      })
      .to(textEl, {
        opacity: 1,
        y: 0,
        duration: 0.32,
        ease: "back.out(1.5)",
      })
  }, [message, showConnectionError])

  if (showConnectionError) {
    return (
      <ConnectionErrorScreen
        error={error!}
        isDark={isDark}
        isReconnecting={backendReconnecting || loading}
        onRetry={onRetry}
        variant="page"
      />
    )
  }

  return (
    <DashboardStatusShell isDark={isDark} mode="overlay" showBrand={false}>
      <SessionSpinner isDark={isDark} />
      <div className="space-y-2">
        <p className={cn("text-xs font-semibold uppercase tracking-wider", t.bodySub)}>Session</p>
        <p ref={textRef} className={cn("text-sm font-semibold leading-relaxed", t.body)}>
          {message}
        </p>
        {onCancel ? (
          <button
            type="button"
            className={cn(
              "mt-3 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors",
              isDark
                ? "border-slate-600 text-slate-200 hover:border-slate-500 hover:bg-slate-800/60"
                : "border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-100",
            )}
            onClick={onCancel}
          >
            Back to login
          </button>
        ) : null}
      </div>
    </DashboardStatusShell>
  )
}
