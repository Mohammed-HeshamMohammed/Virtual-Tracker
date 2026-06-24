"use client"

import type { LucideIcon } from "lucide-react"
import { Search } from "lucide-react"
import { ActivityEmptyState } from "@/features/activity/components/activity-empty-state"

export function ActivityDayEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-20 text-center">
      <Icon className="mb-4 h-12 w-12 text-slate-300" strokeWidth={1.25} />
      <p className="text-base font-medium text-slate-600">{title}</p>
      <p className="mt-1 max-w-md text-sm text-slate-400">
        {description ?? "Try another day or switch to All days."}
      </p>
    </div>
  )
}

export function ActivitySearchEmptyState({ entityLabel }: { entityLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-14 text-center">
      <Search className="mb-3 h-9 w-9 text-slate-300" />
      <p className="text-sm font-medium text-slate-600">No {entityLabel} match your search</p>
      <p className="mt-1 text-xs text-slate-400">Clear the search box or adjust filters above.</p>
    </div>
  )
}

export function ActivityLoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-slate-100 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-500" />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  )
}

export { ActivityEmptyState }
