"use client"

import { Info } from "lucide-react"
import { wasReclassifiedAfter } from "@/features/activity/utils/classification-freshness"

/**
 * Shown only when an app/site was re-classified *after* the day being viewed,
 * so the figures on screen reflect rules that were not in force at the time.
 * Silent otherwise - a banner that is always there is a banner nobody reads.
 */
export function ReclassificationNotice({
  classificationsUpdatedAt,
  dayKey,
}: {
  classificationsUpdatedAt: string | null | undefined
  dayKey: string | null | undefined
}) {
  if (!wasReclassifiedAfter(classificationsUpdatedAt, dayKey)) return null
  const changed = new Date(classificationsUpdatedAt as string).toLocaleDateString()
  return (
    <div className="flex items-start gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
      <span>
        Apps or sites were re-classified on {changed}, after this day. These figures use the
        current classifications, so they may differ from a report exported earlier.
      </span>
    </div>
  )
}
