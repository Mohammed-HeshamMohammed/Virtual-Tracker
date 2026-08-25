/**
 * The productivity vocabulary, shared by the Apps and URLs pages and the
 * classify dialog. These four values are exactly what the backend's
 * `activity_categories.category` column accepts — the UI used to speak a
 * different dialect ("unproductive", and a hardcoded "neutral" for every row),
 * so anything an admin classified never showed up on either page.
 */
export const ACTIVITY_CATEGORIES = ["productive", "neutral", "distracting", "unclassified"] as const

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]

const LEGACY_ALIASES: Record<string, ActivityCategory> = {
  unproductive: "distracting",
  distracting: "distracting",
  productive: "productive",
  neutral: "neutral",
  unclassified: "unclassified",
  "": "unclassified",
}

/** Anything unrecognized reads as unclassified — never as a guess. */
export function normalizeActivityCategory(value: unknown): ActivityCategory {
  const key = typeof value === "string" ? value.trim().toLowerCase() : ""
  return LEGACY_ALIASES[key] ?? "unclassified"
}

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  productive: "Productive",
  neutral: "Neutral",
  distracting: "Not productive",
  unclassified: "Unclassified",
}

/** Solid fill — avatars, progress bars. */
export function activityCategoryColor(category: unknown): string {
  switch (normalizeActivityCategory(category)) {
    case "productive":
      return "bg-emerald-500"
    case "distracting":
      return "bg-rose-500"
    case "neutral":
      return "bg-slate-400"
    default:
      return "bg-slate-300 dark:bg-slate-600"
  }
}

/** Badge styling — the pill in the Category column. */
export function activityCategoryBadgeClass(category: unknown): string {
  switch (normalizeActivityCategory(category)) {
    case "productive":
      return "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80"
    case "distracting":
      return "bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/80"
    case "neutral":
      return "bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80"
    default:
      return "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-dashed border-amber-300/80 dark:border-amber-800/80"
  }
}

export function activityCategoryLabel(category: unknown): string {
  return ACTIVITY_CATEGORY_LABELS[normalizeActivityCategory(category)]
}

/**
 * Shortcuts for the classify dialog. The stored model is only
 * (pattern → category), so a preset is just a category plus a suggested
 * label — "Games" is a kind of thing, "not productive" is the judgement the
 * reports actually use.
 */
export const CLASSIFY_PRESETS: ReadonlyArray<{
  id: string
  label: string
  category: ActivityCategory
  /** Prefilled into the display-name field when the preset is picked. */
  suggestedLabel?: string
}> = [
  { id: "work", label: "Work tool", category: "productive", suggestedLabel: "Work" },
  { id: "research", label: "Research / docs", category: "productive", suggestedLabel: "Research" },
  { id: "communication", label: "Communication", category: "neutral", suggestedLabel: "Communication" },
  { id: "games", label: "Games", category: "distracting", suggestedLabel: "Games" },
  { id: "social", label: "Social media", category: "distracting", suggestedLabel: "Social" },
  { id: "streaming", label: "Streaming / video", category: "distracting", suggestedLabel: "Streaming" },
]
