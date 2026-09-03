"use client"

import type { LucideIcon } from "lucide-react"
import { Search } from "lucide-react"
import { ActivityEmptyState } from "@/features/activity/components/activity-empty-state"

export function ActivityDayEmptyState({
  icon: Icon,
  title,
  description,
  onShowAllDays,
}: {
  icon: LucideIcon
  title: string
  description?: string
  onShowAllDays?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 px-6 py-20 text-center">
      <Icon className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-700" strokeWidth={1.25} />
      <p className="text-base font-medium text-slate-600 dark:text-slate-300">{title}</p>
      <p className="mt-1 max-w-md text-sm text-slate-400 dark:text-slate-500">
        {description ?? "Try another day or switch to All days."}
      </p>
      {onShowAllDays ? (
        <button
          type="button"
          onClick={onShowAllDays}
          className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Show all days
        </button>
      ) : null}
    </div>
  )
}

export function ActivitySearchEmptyState({
  entityLabel,
  onClear,
}: {
  entityLabel: string
  onClear?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 px-6 py-14 text-center">
      <Search className="mb-3 h-9 w-9 text-slate-300 dark:text-slate-700" />
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No {entityLabel} match your search</p>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Clear search &amp; filters
        </button>
      ) : (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Clear the search box or adjust filters above.</p>
      )}
    </div>
  )
}

export function ActivityLoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/90 px-6 py-16 text-center shadow-sm">
      <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 dark:border-slate-700 border-t-emerald-500" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  )
}

export { ActivityEmptyState }
