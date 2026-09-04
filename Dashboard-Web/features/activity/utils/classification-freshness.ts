/**
 * Categories are resolved at read time, not frozen when the activity was
 * recorded. That is correct - a classification is a statement about what an
 * app or site *is*, and applying it consistently is the point - but it means
 * re-classifying something changes what past periods report.
 *
 * The failure mode is not the retroactivity, it is the silence: a manager
 * exports a period, exports it again next month, and the numbers differ with
 * nothing explaining why. These helpers let the pages say so.
 */

/** Human-readable stamp for export footers: "Categories as of 4 Sep 2026, 14:32". */
export function classificationStamp(updatedAt: string | null | undefined): string {
  if (!updatedAt) return "No classifications set"
  const d = new Date(updatedAt)
  if (!Number.isFinite(d.getTime())) return "Unknown"
  return d.toLocaleString()
}

/**
 * True when a classification changed *after* the period being viewed, meaning
 * the figures on screen reflect rules that did not exist during that period.
 *
 * `dayKey` is the shell's selected day ("all" or YYYY-MM-DD). For "all days"
 * the period runs to now, so nothing can post-date it and this is always
 * false - which is right: there is nothing surprising to warn about.
 */
export function wasReclassifiedAfter(
  updatedAt: string | null | undefined,
  dayKey: string | null | undefined,
): boolean {
  if (!updatedAt || !dayKey || dayKey === "all") return false
  const changed = new Date(updatedAt)
  if (!Number.isFinite(changed.getTime())) return false
  // End of the viewed day, local time. A classification saved after that
  // moment was not in force while the activity happened.
  const endOfDay = new Date(`${dayKey}T23:59:59`)
  if (!Number.isFinite(endOfDay.getTime())) return false
  return changed.getTime() > endOfDay.getTime()
}
