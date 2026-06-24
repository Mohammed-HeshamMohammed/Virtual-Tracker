"use client"

import type { ReactNode } from "react"
import { cn } from "@/shared/utils/utils"

export type PaginatedTableShellProps = {
  isDark?: boolean
  fillsRemaining: boolean
  isEmpty: boolean
  emptyContent: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function PaginatedTableShell({
  isDark = false,
  fillsRemaining,
  isEmpty,
  emptyContent,
  children,
  footer,
  className,
}: PaginatedTableShellProps) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border shadow-sm",
        "flex-1",
        isDark ? "bg-[#151b2d] border-[#3d4a3d]/40" : "bg-white border-slate-100",
        className,
      )}
    >
      {isEmpty ? (
        <div
          className={cn(
            "flex flex-1 flex-col items-center justify-center text-sm",
            fillsRemaining ? "px-5" : "px-5 py-16",
            isDark ? "text-[#bccbb9]" : "text-slate-400",
          )}
        >
          {emptyContent}
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
          {footer}
        </>
      )}
    </div>
  )
}
