"use client"

import type { ReactNode } from "react"
import { cn } from "@/shared/utils/utils"
import { getDashboardStatusStyles } from "@/shared/ui/errors/dashboard-status-theme"

type DashboardStatusPanelProps = {
  isDark: boolean
  children: ReactNode
  className?: string
}

export function DashboardStatusPanel({ isDark, children, className }: DashboardStatusPanelProps) {
  const t = getDashboardStatusStyles(isDark)
  return (
    <div
      className={cn(
        "isolate w-full max-w-full overflow-hidden rounded-3xl border p-6 transition-colors duration-300 sm:p-8 md:p-10",
        t.panel,
        className,
      )}
    >
      {children}
    </div>
  )
}
