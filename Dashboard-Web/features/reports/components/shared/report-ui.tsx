"use client"

import type { ReactNode } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { reportCardFor } from "@/features/reports/catalog"


export function ReportCard({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-100 bg-white shadow-sm dark:border-white/10 dark:bg-[#151b2d]",
        className,
      )}
    >
      {children}
    </div>
  )
}

const reportHeadRow = "border-b border-slate-100 dark:border-white/10"
export function ReportTableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading report</span>
      <ReportCard className="overflow-hidden">
        <div className={cn("flex gap-4 px-4 py-3", reportHeadRow)}>
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="h-3 flex-1 animate-pulse rounded bg-slate-200/80 dark:bg-white/10" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className={cn("flex gap-4 px-4 py-4", reportHeadRow, "last:border-0")}>
            {Array.from({ length: columns }).map((_, i) => (
              <div
                key={i}
                className="h-3 flex-1 animate-pulse rounded bg-slate-100 dark:bg-white/5"
                style={{ animationDelay: `${(rowIndex * columns + i) * 25}ms` }}
              />
            ))}
          </div>
        ))}
      </ReportCard>
    </div>
  )
}

export function ReportSkeleton({
  tiles = 0,
  rows = 6,
  columns = 5,
}: {
  tiles?: number
  rows?: number
  columns?: number
}) {
  return (
    <div className="space-y-5">
      {tiles > 0 ? (
        <div className={cn("grid grid-cols-2 gap-3", tiles >= 4 ? "lg:grid-cols-4" : "sm:grid-cols-3")}>
          {Array.from({ length: tiles }).map((_, i) => (
            <ReportCard key={i} className="px-4 py-3">
              <div className="h-2.5 w-16 animate-pulse rounded bg-slate-200/80 dark:bg-white/10" />
              <div className="mt-2 h-5 w-24 animate-pulse rounded bg-slate-100 dark:bg-white/5" />
            </ReportCard>
          ))}
        </div>
      ) : null}
      <ReportTableSkeleton rows={rows} columns={columns} />
    </div>
  )
}

export function ReportErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <AlertCircle className="h-8 w-8 text-rose-500 dark:text-rose-400" aria-hidden />
      <p className="text-base font-semibold text-slate-800 dark:text-[#dce1fb]">Could not load this report</p>
      <p className="max-w-sm text-sm text-slate-500 dark:text-[#bccbb9]">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-[#dce1fb] dark:hover:bg-white/5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      ) : null}
    </div>
  )
}

export function ReportPageHeading({
  title,
  pageId,
  subtitle,
  className,
}: {
  title: string
  pageId?: string
  subtitle?: string
  className?: string
}) {
  const line = subtitle ?? (pageId ? reportCardFor(pageId)?.description : undefined)
  // Not painted - see the note in standard-report-layout.tsx. Kept in the
  // accessibility tree so each report page still has a heading.
  return (
    <div className={cn("sr-only", className)}>
      <h1>{title}</h1>
      {line ? <p>{line}</p> : null}
    </div>
  )
}

export function ReportOrgLine({ org, timezone }: { org: string; timezone: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-base font-semibold text-slate-900 dark:text-white/90">{org}</span>
      <span className="text-sm text-slate-400 dark:text-white/45">{timezone}</span>
    </div>
  )
}

/**
 * Every report caps how many rows it will read, and until now each one hit
 * that cap silently: the table simply showed a shorter total with nothing
 * saying so, which is worse than an error because it looks like an answer.
 */
export function ReportTruncationNotice({ what = "activity" }: { what?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        "border-amber-200 bg-amber-50 text-amber-800",
        "dark:border-amber-400/25 dark:bg-amber-400/8 dark:text-amber-200"
      )}
    >
      This range holds more {what} than the report will read, so these results are incomplete. Narrow the dates or the
      filters for a full picture.
    </div>
  )
}
