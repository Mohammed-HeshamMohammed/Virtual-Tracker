"use client"

import type { ReactNode } from "react"
import { cn } from "@/shared/utils/utils"
import { getDashboardStatusStyles } from "@/shared/ui/errors/dashboard-status-theme"
import { DashboardStatusPanel } from "@/shared/ui/errors/dashboard-status-panel"

type DashboardStatusShellProps = {
  isDark: boolean
  children: ReactNode
  className?: string
  panelClassName?: string
  mode?: "page" | "overlay" | "embedded"
  showBrand?: boolean
}

export function DashboardStatusBrand({ isDark }: { isDark: boolean }) {
  const t = getDashboardStatusStyles(isDark)
  return (
    <div className="mb-6 text-center">
      <h1
        className={cn("text-[24px] leading-none tracking-tight", t.title)}
        style={{ fontFamily: "'Exo 2', system-ui, sans-serif", fontWeight: 500 }}
      >
        Virtual Tracker <span className="text-base font-semibold">OS</span>
      </h1>
      <p className={cn("mt-1 text-[9px] font-medium uppercase tracking-widest", t.bodySub)}>
        Productivity Suite
      </p>
    </div>
  )
}

function DashboardGlows({ isDark, compact = false }: { isDark: boolean; compact?: boolean }) {
  const t = getDashboardStatusStyles(isDark)
  const size = compact ? "h-64 w-64 blur-[90px]" : "h-72 w-72 blur-[100px]"
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className={cn("absolute left-0 top-0 -translate-x-1/4 -translate-y-1/4 rounded-full transition-colors duration-300", size, t.glowPrimary)} />
      <div className={cn("absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4 rounded-full transition-colors duration-300", size, t.glowSecondary)} />
    </div>
  )
}

export function DashboardStatusShell({
  isDark,
  children,
  className,
  panelClassName,
  mode = "page",
  showBrand = false,
}: DashboardStatusShellProps) {
  const t = getDashboardStatusStyles(isDark)

  if (mode === "embedded") {
    return (
      <div className={cn("flex h-full min-h-[50vh] w-full items-center justify-center p-4", className)}>
        {children}
      </div>
    )
  }

  if (mode === "page") {
    return (
      <div
        className={cn(
          "relative flex h-dvh max-h-dvh w-full flex-col overflow-hidden transition-colors duration-300",
          t.pageBg,
          className,
        )}
      >
        <DashboardGlows isDark={isDark} />
        <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4 sm:p-6 md:p-8">
          <div className="my-auto w-full max-w-2xl overflow-visible p-2 sm:p-3">
            {showBrand ? <DashboardStatusBrand isDark={isDark} /> : null}
            <DashboardStatusPanel isDark={isDark} className={panelClassName}>
              {children}
            </DashboardStatusPanel>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex h-dvh max-h-dvh w-full flex-col items-center justify-center overflow-hidden p-4 transition-colors duration-300 sm:p-6",
        t.pageBg,
        t.pageText,
        className,
      )}
    >
      <DashboardGlows isDark={isDark} compact />
      <div className="relative z-10 w-full max-w-md overflow-visible p-4">
        {showBrand ? <DashboardStatusBrand isDark={isDark} /> : null}
        <DashboardStatusPanel isDark={isDark} className={cn("text-center", panelClassName)}>
          {children}
        </DashboardStatusPanel>
      </div>
    </div>
  )
}
