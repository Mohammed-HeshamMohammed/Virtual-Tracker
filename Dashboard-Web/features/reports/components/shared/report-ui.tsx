"use client"

import type { ReactNode } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { reportCardFor } from "@/features/reports/catalog"

/**
 * Shared surface, loading, error and heading primitives for report pages.
 *
 * Reports had grown their own versions of each of these: a centred "Loading…"
 * line that collapsed the page height, no error state at all on most pages
 * (a failed request fell through to "no data"), and three different title and
 * org-header treatments depending on which page you opened.
 *
 * These use `dark:` variants rather than the `useTheme()` / `isDark` ternary
 * the older pages use, so a plain class string is enough and a report body
 * does not need the theme hook just to draw a surface.
 */

/** Card surface: the standard container for a report table or panel. */
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
/**
 * Loading placeholder shaped like the table it replaces.
 *
 * Reports used to render a centred "Loading…" line, which collapses the page
 * height and then snaps back when rows arrive.
 */
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

/** Tiles + table skeleton, for reports that lead with a summary row. */
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

/**
 * A report that failed to load says so and offers a retry, rather than
 * rendering the same empty state a successful-but-empty report shows.
 */
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

/**
 * Title block for a report that builds its own header instead of using
 * StandardReportLayout. Renders exactly what the layout renders, so the four
 * hand-built report pages stop being visibly different from the seventeen
 * that use the layout - two of them had no page title at all, and the other
 * two set their own size and weight.
 */
export function ReportPageHeading({
  title,
  pageId,
  subtitle,
  className,
}: {
  title: string
  /** Supplies the subtitle from the report catalog. */
  pageId?: string
  /** Overrides the catalog description. */
  subtitle?: string
  className?: string
}) {
  const line = subtitle ?? (pageId ? reportCardFor(pageId)?.description : undefined)
  return (
    <div className={cn("min-w-0 max-w-xl", className)}>
      <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-[#dce1fb]">{title}</h1>
      {line ? <p className="mt-1 text-sm text-slate-500 dark:text-[#bccbb9]">{line}</p> : null}
    </div>
  )
}

/**
 * Org name + timezone, the same one line the layout shows. Report pages had
 * this at text-xl bold, text-2xl bold and text-base semibold depending on
 * which page you were on.
 */
export function ReportOrgLine({ org, timezone }: { org: string; timezone: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-base font-semibold text-slate-900 dark:text-white/90">{org}</span>
      <span className="text-sm text-slate-400 dark:text-white/45">{timezone}</span>
    </div>
  )
}
