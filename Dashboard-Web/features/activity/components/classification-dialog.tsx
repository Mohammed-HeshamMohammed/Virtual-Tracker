"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Loader2, Search, Tag } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  CLASSIFY_PRESETS,
  activityCategoryBadgeClass,
  normalizeActivityCategory,
  type ActivityCategory,
} from "@/features/activity/utils/activity-categories"
import {
  classificationKey,
  fetchClassifications,
  saveClassification,
  toClassificationMap,
} from "@/features/activity/services/classification-api"

export interface ClassifiableItem {
  /** App name, or domain for URLs — the pattern stored against the row. */
  pattern: string
  /** What the page shows for it, when that differs from the raw pattern. */
  label?: string
  /** Category the feed reported, used until the saved map loads. */
  category?: string
}

type Draft = { category: ActivityCategory; displayName: string }

export function ClassificationDialog({
  open,
  onOpenChange,
  matchType,
  items,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  matchType: "app" | "domain"
  items: ClassifiableItem[]
  onSaved?: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [initial, setInitial] = useState<Record<string, Draft>>({})
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uniqueItems = useMemo(() => {
    const byPattern = new Map<string, ClassifiableItem>()
    for (const item of items) {
      const pattern = item.pattern?.trim()
      if (!pattern) continue
      if (!byPattern.has(pattern.toLowerCase())) byPattern.set(pattern.toLowerCase(), { ...item, pattern })
    }
    return [...byPattern.values()].sort((a, b) => a.pattern.localeCompare(b.pattern))
  }, [items])

  // Seed from the feed's own categories first so the list is usable
  // immediately, then reconcile against the saved map once it arrives —
  // the saved rows are authoritative, including their display names.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const seeded: Record<string, Draft> = {}
    for (const item of uniqueItems) {
      seeded[item.pattern] = { category: normalizeActivityCategory(item.category), displayName: "" }
    }
    setDrafts(seeded)
    setInitial(seeded)
    setError(null)
    setLoading(true)
    fetchClassifications()
      .then((rows) => {
        if (cancelled) return
        const saved = toClassificationMap(rows)
        const merged: Record<string, Draft> = { ...seeded }
        for (const item of uniqueItems) {
          const row = saved.get(classificationKey(matchType, item.pattern))
          if (!row) continue
          merged[item.pattern] = {
            category: normalizeActivityCategory(row.category),
            displayName: row.displayName ?? "",
          }
        }
        setDrafts(merged)
        setInitial(merged)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load saved classifications.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, matchType, uniqueItems])

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return uniqueItems
    return uniqueItems.filter(
      (item) => item.pattern.toLowerCase().includes(q) || (item.label ?? "").toLowerCase().includes(q),
    )
  }, [uniqueItems, search])

  const changed = useMemo(
    () =>
      Object.entries(drafts).filter(([pattern, draft]) => {
        const before = initial[pattern]
        return !before || before.category !== draft.category || before.displayName !== draft.displayName
      }),
    [drafts, initial],
  )

  const setDraft = useCallback((pattern: string, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const current: Draft = prev[pattern] ?? { category: "unclassified", displayName: "" }
      return { ...prev, [pattern]: { ...current, ...patch } }
    })
  }, [])

  const handleSave = useCallback(async () => {
    if (!changed.length) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Sequential on purpose: this is a handful of rows at a time, and a
      // partial failure should stop rather than race a dozen writes.
      for (const [pattern, draft] of changed) {
        await saveClassification({
          matchType,
          pattern,
          category: draft.category,
          displayName: draft.displayName.trim() || null,
        })
      }
      setInitial(drafts)
      onSaved?.()
      onOpenChange(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save classifications.")
    } finally {
      setSaving(false)
    }
  }, [changed, drafts, matchType, onOpenChange, onSaved])

  const noun = matchType === "app" ? "app" : "site"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Classify {noun}s
          </DialogTitle>
          <DialogDescription>
            Mark each {noun} as productive, neutral, or not productive. This is org-wide — it drives the
            Category column here and the productive / distracting split in focused-time reporting.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 pb-1">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${noun}s…`}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1.5 pl-8 pr-3 text-sm text-slate-800 dark:text-slate-100 outline-hidden focus:border-slate-400 dark:focus:border-slate-500"
            />
          </div>
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading saved labels…
            </span>
          ) : null}
        </div>

        <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
          {visibleItems.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Nothing to classify for this day.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleItems.map((item) => {
                const draft = drafts[item.pattern] ?? { category: "unclassified" as ActivityCategory, displayName: "" }
                return (
                  <li key={item.pattern} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {item.label || item.pattern}
                        </p>
                        {item.label && item.label !== item.pattern ? (
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.pattern}</p>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                          activityCategoryBadgeClass(draft.category),
                        )}
                      >
                        {ACTIVITY_CATEGORY_LABELS[draft.category]}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {ACTIVITY_CATEGORIES.map((category) => (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setDraft(item.pattern, { category })}
                          aria-pressed={draft.category === category}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                            draft.category === category
                              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
                          )}
                        >
                          {draft.category === category ? <Check className="h-3 w-3" /> : null}
                          {ACTIVITY_CATEGORY_LABELS[category]}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-slate-400 dark:text-slate-500">Quick set:</span>
                      {CLASSIFY_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() =>
                            setDraft(item.pattern, {
                              category: preset.category,
                              displayName: preset.suggestedLabel ?? draft.displayName,
                            })
                          }
                          className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {preset.label}
                        </button>
                      ))}
                      <input
                        value={draft.displayName}
                        onChange={(e) => setDraft(item.pattern, { displayName: e.target.value })}
                        placeholder="Label (optional) — e.g. Games"
                        className="ml-auto w-44 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-800 dark:text-slate-100 outline-hidden focus:border-slate-400 dark:focus:border-slate-500"
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

        <DialogFooter>
          <span className="mr-auto text-xs text-slate-500 dark:text-slate-400">
            {changed.length > 0 ? `${changed.length} change${changed.length === 1 ? "" : "s"} pending` : "No changes"}
          </span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || changed.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
