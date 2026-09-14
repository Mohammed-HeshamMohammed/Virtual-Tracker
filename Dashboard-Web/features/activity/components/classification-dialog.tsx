"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AppWindow, Globe, Info, Loader2, Search, ChevronDown, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { FLOATING_MENU_ATTR, FLOATING_MENU_Z_CLASS } from "@/shared/ui/forms/floating-menu"
import { useFloatingMenuPosition } from "@/shared/ui/forms/use-floating-menu-position"
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  CLASSIFY_PRESETS,
  normalizeActivityCategory,
  type ActivityCategory,
} from "@/features/activity/utils/activity-categories"
import { ACTIVITY_CATEGORY_OPTIONS } from "@/features/activity/components/activity-toolbar-primitives"
import {
  classificationKey,
  fetchClassifications,
  saveClassification,
  toClassificationMap,
} from "@/features/activity/services/classification-api"
import { clearActivityApiFeedCache } from "@/features/activity/services/activity-api"

type MatchType = "app" | "domain" | "window_title"

export interface ClassifiableItem {
  pattern: string
  label?: string
  category?: string
  /** Overrides the dialog's `matchType` for this one row - used to mix
   *  window-title rows into the site list. */
  matchType?: MatchType
  /** The app's own icon or the site's favicon, so the list reads the way the
   *  Apps and Sites tables do instead of as a column of initials. */
  iconUrl?: string | null
}

type Draft = { category: ActivityCategory; displayName: string }

type Filter = "all" | ActivityCategory | "edited"

const UNCLASSIFIED_DRAFT: Draft = { category: "unclassified", displayName: "" }

/** Unclassified comes second: it is the work still to do. */
const FILTERS: ReadonlyArray<{ id: Exclude<Filter, "edited">; label: string }> = [
  { id: "all", label: "All" },
  { id: "unclassified", label: "Unclassified" },
  { id: "productive", label: "Productive" },
  { id: "neutral", label: "Neutral" },
  { id: "distracting", label: "Not productive" },
]

/** The same dots the page's category filter uses. */
const CATEGORY_DOT: Record<string, string> = Object.fromEntries(
  ACTIVITY_CATEGORY_OPTIONS.map((option) => [option.id, option.dot]),
)

/** Selected-state colours, in the hues of the table's category badges. */
const CATEGORY_SELECTED: Record<ActivityCategory, string> = {
  productive:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:ring-emerald-800/70",
  neutral: "bg-white text-slate-900 ring-slate-200 dark:bg-[#1b2233] dark:text-white dark:ring-slate-700",
  distracting: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-800/70",
  unclassified:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800/70",
}

/** Presets grouped by the category they set, so the menu says what each one does. */
const PRESET_GROUPS = ACTIVITY_CATEGORIES.map((category) => ({
  category,
  presets: CLASSIFY_PRESETS.filter((preset) => preset.category === category),
})).filter((group) => group.presets.length > 0)

/** The same groups, shaped for ClassifyMenu. */
const PRESET_MENU_GROUPS = PRESET_GROUPS.map((group) => ({
  label: ACTIVITY_CATEGORY_LABELS[group.category],
  options: group.presets.map((preset) => ({
    value: preset.id,
    label: preset.label,
    dot: CATEGORY_DOT[group.category],
  })),
}))

/** One flat group: the four categories, each with its own colour dot. */
const SET_ALL_MENU_GROUPS = [
  {
    options: ACTIVITY_CATEGORIES.map((category) => ({
      value: category,
      label: ACTIVITY_CATEGORY_LABELS[category],
      dot: CATEGORY_DOT[category],
    })),
  },
]

const TRAY =
  "rounded-xl border border-slate-200/80 bg-slate-50/80 p-0.5 shadow-inner dark:border-[#3d4a3d]/40 dark:bg-[#101417]/60"

const FIELD =
  "h-8 w-full rounded-lg border border-slate-200/90 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-hidden transition-colors placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-600"

// Rows lay themselves out by the list's width, not the window's: stacked when
// narrow, name + label + quick set over the category picker when medium, one
// line when wide. The column header shares the wide template so it lines up.
const ROW_GRID =
  "grid grid-cols-2 gap-2.5 @2xl:grid-cols-[minmax(0,1fr)_11rem_9rem] @2xl:items-center @2xl:gap-x-3"
const WIDE_COLUMNS = "@5xl:grid-cols-[minmax(0,1fr)_27rem_11rem_9rem] @5xl:gap-x-4"

/**
 * The dialog's own dropdown, styled to match the dialog rather than the
 * browser's native `<select>` (a different font, a different palette, and in
 * dark mode a plain white list, right in the middle of a dialog that themes
 * everything else itself). Positioning reuses the same floating-menu helpers
 * every other menu in the app uses, so it flips and clamps at the viewport
 * edge the same way.
 *
 * It picks an action rather than holding a value - choosing an entry applies
 * it immediately and the trigger goes back to reading `placeholder`.
 */
function ClassifyMenu({
  placeholder,
  groups,
  onPick,
  disabled = false,
  ariaLabel,
  className,
}: {
  placeholder: string
  groups: { label?: string; options: { value: string; label: string; dot?: string }[] }[]
  onPick: (value: string) => void
  disabled?: boolean
  ariaLabel: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const rowCount = groups.reduce((count, group) => count + group.options.length + (group.label ? 1 : 0), 0)
  const { style: menuStyle, syncPosition } = useFloatingMenuPosition(
    triggerRef,
    open,
    Math.min(280, rowCount * 32 + 16),
    rowCount,
  )

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [open])

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (triggerRef.current) syncPosition()
          setOpen((v) => !v)
        }}
        className={cn(
          FIELD,
          "flex items-center justify-between gap-1.5 text-left font-medium hover:border-slate-300 dark:hover:border-slate-700",
          open && "border-emerald-400 ring-2 ring-emerald-500/15 dark:border-emerald-600",
          className,
        )}
      >
        <span className="truncate text-slate-500 dark:text-slate-400">{placeholder}</span>
        <ChevronDown
          aria-hidden
          className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && menuStyle && typeof document !== "undefined"
        ? createPortal(
            <div className={cn("pointer-events-none fixed inset-0", FLOATING_MENU_Z_CLASS)}>
              <div className="pointer-events-auto absolute inset-0" aria-hidden onMouseDown={() => setOpen(false)} />
              <div
                {...{ [FLOATING_MENU_ATTR]: "" }}
                role="listbox"
                aria-label={ariaLabel}
                onMouseDown={(e) => e.stopPropagation()}
                className="custom-scrollbar pointer-events-auto fixed overflow-y-auto rounded-xl border border-slate-200/90 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
                style={{
                  top: menuStyle.top,
                  left: menuStyle.left,
                  minWidth: menuStyle.width,
                  width: menuStyle.width,
                  maxHeight: menuStyle.maxHeight,
                }}
              >
                {groups.map((group, index) => (
                  <div key={group.label ?? `group-${index}`}>
                    {group.label ? (
                      <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        {group.label}
                      </p>
                    ) : null}
                    {group.options.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          onPick(option.value)
                          setOpen(false)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {option.dot ? (
                          <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", option.dot)} />
                        ) : null}
                        <span className="truncate">{option.label}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

/** The app's icon or the site's favicon, falling back to the initial tile. A
 *  remote favicon that fails to load falls back too, rather than showing a
 *  broken image. */
function RowIcon({ name, iconUrl }: { name: string; iconUrl?: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [iconUrl])
  if (iconUrl && !failed) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={32}
        height={32}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-8 w-8 shrink-0 rounded-lg object-contain"
      />
    )
  }
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-300"
    >
      {name.trim().charAt(0)}
    </span>
  )
}

function CategoryPicker({
  value,
  onChange,
  name,
  className,
}: {
  value: ActivityCategory
  onChange: (category: ActivityCategory) => void
  name: string
  className?: string
}) {
  return (
    <div role="group" aria-label={`Category for ${name}`} className={cn(TRAY, "grid grid-cols-2 gap-0.5 @md:flex", className)}>
      {ACTIVITY_CATEGORIES.map((category) => {
        const selected = value === category
        return (
          <button
            key={category}
            type="button"
            onClick={() => onChange(category)}
            aria-pressed={selected}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
              selected
                ? cn("shadow-sm ring-1", CATEGORY_SELECTED[category])
                : "text-slate-500 hover:bg-white/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200",
            )}
          >
            <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CATEGORY_DOT[category], !selected && "opacity-60")} />
            {ACTIVITY_CATEGORY_LABELS[category]}
          </button>
        )
      })}
    </div>
  )
}

export function ClassificationDialog({
  open,
  onOpenChange,
  matchType,
  items,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  matchType: MatchType
  items: ClassifiableItem[]
  onSaved?: () => void
}) {
  const matchTypeFor = useCallback(
    (pattern: string): MatchType =>
      items.find((item) => item.pattern?.trim() === pattern)?.matchType ?? matchType,
    [items, matchType],
  )
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [initial, setInitial] = useState<Record<string, Draft>>({})
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
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
    // By the name shown, not the process/domain behind it - "Google Chrome"
    // belongs under G, not under "chrome".
    return [...byPattern.values()].sort((a, b) =>
      (a.label || a.pattern).localeCompare(b.label || b.pattern, undefined, { sensitivity: "base" }),
    )
  }, [items])

  // NUL can't occur in a pattern, so unlike a space (window titles have
  // spaces) it can't make two different sets of patterns look the same.
  // Written as an escape: a literal NUL makes git treat this file as binary.
  const itemsKey = useMemo(() => uniqueItems.map((item) => item.pattern).join("\u0000"), [uniqueItems])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const seeded: Record<string, Draft> = {}
    for (const item of uniqueItems) {
      seeded[item.pattern] = { category: normalizeActivityCategory(item.category), displayName: "" }
    }
    setDrafts(seeded)
    setInitial(seeded)
    setSearch("")
    setFilter("all")
    setError(null)
    setLoading(true)
    fetchClassifications()
      .then((rows) => {
        if (cancelled) return
        const saved = toClassificationMap(rows)
        const merged: Record<string, Draft> = { ...seeded }
        for (const item of uniqueItems) {
          const row = saved.get(classificationKey(item.matchType ?? matchType, item.pattern))
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
    // uniqueItems is read here but deliberately not a dependency - itemsKey
    // stands in for it, and is stable across re-renders that don't change
    // which patterns are on offer. See the comment on itemsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matchType, itemsKey])

  const changed = useMemo(
    () =>
      Object.entries(drafts).filter(([pattern, draft]) => {
        const before = initial[pattern]
        return !before || before.category !== draft.category || before.displayName !== draft.displayName
      }),
    [drafts, initial],
  )
  const changedPatterns = useMemo(() => new Set(changed.map(([pattern]) => pattern)), [changed])

  // "Edited" empties once the changes are discarded; fall back to everything.
  const activeFilter: Filter = filter === "edited" && changed.length === 0 ? "all" : filter

  const counts = useMemo(() => {
    const tally: Record<Exclude<Filter, "edited">, number> = {
      all: uniqueItems.length,
      productive: 0,
      neutral: 0,
      distracting: 0,
      unclassified: 0,
    }
    for (const item of uniqueItems) tally[(drafts[item.pattern] ?? UNCLASSIFIED_DRAFT).category] += 1
    return tally
  }, [uniqueItems, drafts])

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return uniqueItems.filter((item) => {
      if (q && !item.pattern.toLowerCase().includes(q) && !(item.label ?? "").toLowerCase().includes(q)) return false
      if (activeFilter === "all") return true
      if (activeFilter === "edited") return changedPatterns.has(item.pattern)
      // A row you just re-categorised stays put rather than vanishing from
      // the filter you were working through.
      return drafts[item.pattern]?.category === activeFilter || initial[item.pattern]?.category === activeFilter
    })
  }, [uniqueItems, search, activeFilter, changedPatterns, drafts, initial])

  const setDraft = useCallback((pattern: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [pattern]: { ...(prev[pattern] ?? UNCLASSIFIED_DRAFT), ...patch } }))
  }, [])

  const revertDraft = useCallback(
    (pattern: string) => setDrafts((prev) => ({ ...prev, [pattern]: initial[pattern] ?? UNCLASSIFIED_DRAFT })),
    [initial],
  )

  const setVisibleCategory = useCallback(
    (category: ActivityCategory) =>
      setDrafts((prev) => {
        const next = { ...prev }
        for (const item of visibleItems) next[item.pattern] = { ...(prev[item.pattern] ?? UNCLASSIFIED_DRAFT), category }
        return next
      }),
    [visibleItems],
  )

  const handleSave = useCallback(async () => {
    if (!changed.length) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      for (const [pattern, draft] of changed) {
        await saveClassification({
          matchType: matchTypeFor(pattern),
          pattern,
          category: draft.category,
          displayName: draft.displayName.trim() || null,
        })
      }
      setInitial(drafts)
      // The feeds cache their /api/activity/feed response for minutes;
      // onSaved's reload({force}) skips the persistent cache but not that
      // one, so without this the table keeps showing pre-classification
      // categories until the TTL lapses. The event also refreshes any feed
      // instance the caller's onSaved doesn't explicitly reload (all-time
      // summaries, the other sub-page mounted behind a tab, ...).
      clearActivityApiFeedCache()
      window.dispatchEvent(new Event("vt-activity-feed-invalidate"))
      onSaved?.()
      onOpenChange(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save classifications.")
    } finally {
      setSaving(false)
    }
  }, [changed, drafts, matchTypeFor, onOpenChange, onSaved])

  // Escape, the overlay, the close button and Cancel all come through here,
  // so none of them can throw away unsaved work without asking.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (
        !next &&
        !saving &&
        changed.length > 0 &&
        !window.confirm(`Discard ${changed.length} unsaved change${changed.length === 1 ? "" : "s"}?`)
      ) {
        return
      }
      onOpenChange(next)
    },
    [changed.length, onOpenChange, saving],
  )

  const noun = matchType === "app" ? "app" : "site"
  const NounIcon = matchType === "app" ? AppWindow : Globe
  const pending = changed.length
  const filtering = search.trim() !== "" || activeFilter !== "all"

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,56rem)] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200/80 bg-white p-0 text-slate-900 shadow-2xl sm:max-w-6xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:[color-scheme:dark]">
        <DialogHeader className="gap-0 border-b border-slate-200/80 px-6 pb-4 pt-5 pr-14 text-left dark:border-slate-800">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200/80 bg-emerald-50 text-emerald-600 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-400">
              <NounIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-50">
                Classify {noun}s
                {loading ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading saved labels…
                  </span>
                ) : null}
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Org-wide. Drives the Category column here and the productive / not-productive split in focused-time
                reports.
              </DialogDescription>
              {matchType === "domain" ? (
                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Rows marked Window title were read from a browser window&apos;s title, not its address bar, and
                  match that exact title rather than the browser.
                </p>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-2.5 border-b border-slate-200/80 px-6 py-3 lg:flex-row lg:items-center dark:border-slate-800">
          <div className="relative w-full lg:w-64 lg:shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${noun}s…`}
              aria-label={`Search ${noun}s`}
              className={cn(FIELD, "h-9 rounded-xl pl-8 pr-8 text-sm")}
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <div role="group" aria-label={`Show ${noun}s`} className={cn(TRAY, "flex min-w-0 flex-wrap items-center gap-0.5")}>
            {FILTERS.map((option) => {
              const active = activeFilter === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                    active
                      ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-[#1b2233] dark:text-white dark:ring-[#3d4a3d]/50"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                  )}
                >
                  {option.id !== "all" ? (
                    <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CATEGORY_DOT[option.id])} />
                  ) : null}
                  {option.label}
                  <span className="tabular-nums font-medium text-slate-400 dark:text-slate-500">{counts[option.id]}</span>
                </button>
              )
            })}
            {pending > 0 ? (
              <button
                type="button"
                onClick={() => setFilter("edited")}
                aria-pressed={activeFilter === "edited"}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                  activeFilter === "edited"
                    ? "bg-amber-50 text-amber-700 shadow-sm ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800/70"
                    : "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300",
                )}
              >
                Edited
                <span className="tabular-nums">{pending}</span>
              </button>
            ) : null}
          </div>

          {visibleItems.length > 1 ? (
            <ClassifyMenu
              placeholder={`Set all ${visibleItems.length} shown to…`}
              ariaLabel={`Set the category of all ${visibleItems.length} shown ${noun}s`}
              disabled={loading}
              groups={SET_ALL_MENU_GROUPS}
              onPick={(category) => setVisibleCategory(normalizeActivityCategory(category))}
              className="h-9 w-full rounded-xl font-semibold lg:ml-auto lg:w-64"
            />
          ) : null}
        </div>

        <div
          aria-busy={loading}
          className={cn(
            "custom-scrollbar @container min-h-0 flex-1 overflow-y-auto",
            loading && "pointer-events-none opacity-60",
          )}
        >
          {visibleItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-800/60">
                <NounIcon className="h-5 w-5" />
              </span>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {filtering
                  ? `No ${noun}s match these filters.`
                  : `Nothing to classify yet. ${noun === "app" ? "Apps" : "Sites"} appear here once the agent records them.`}
              </p>
              {filtering ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("")
                    setFilter("all")
                  }}
                  className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "sticky top-0 z-10 hidden border-b border-slate-200/80 bg-slate-50/95 px-6 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur @5xl:grid dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-400",
                  WIDE_COLUMNS,
                )}
              >
                <span>{noun === "app" ? "App" : "Site"}</span>
                <span>Category</span>
                <span>Label</span>
                <span>Quick set</span>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {visibleItems.map((item) => {
                  const draft = drafts[item.pattern] ?? UNCLASSIFIED_DRAFT
                  const dirty = changedPatterns.has(item.pattern)
                  const name = item.label || item.pattern
                  const showPattern = !!item.label && item.label !== item.pattern
                  const isWindowTitle = (item.matchType ?? matchType) === "window_title"
                  return (
                    <li
                      key={item.pattern}
                      className={cn(
                        "relative px-6 py-3 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30",
                        ROW_GRID,
                        WIDE_COLUMNS,
                        dirty && "bg-amber-50/40 dark:bg-amber-950/10",
                      )}
                    >
                      {dirty ? (
                        <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-amber-400 dark:bg-amber-500" />
                      ) : null}

                      <div className="col-span-2 flex min-w-0 items-center gap-3 @2xl:col-span-1 @2xl:col-start-1 @2xl:row-start-1">
                        <RowIcon name={name} iconUrl={item.iconUrl} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={item.pattern}>
                            {name}
                          </p>
                          {showPattern || isWindowTitle || dirty ? (
                            <div className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                              {showPattern ? <span className="truncate">{item.pattern}</span> : null}
                              {isWindowTitle ? (
                                <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                  Window title
                                </span>
                              ) : null}
                              {dirty ? (
                                <button
                                  type="button"
                                  onClick={() => revertDraft(item.pattern)}
                                  className="shrink-0 font-semibold text-amber-600 hover:underline dark:text-amber-400"
                                >
                                  Edited · undo
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <CategoryPicker
                        name={name}
                        value={draft.category}
                        onChange={(category) => setDraft(item.pattern, { category })}
                        className="col-span-2 @2xl:col-span-3 @2xl:row-start-2 @2xl:justify-self-start @5xl:col-span-1 @5xl:col-start-2 @5xl:row-start-1 @5xl:justify-self-stretch"
                      />

                      <input
                        value={draft.displayName}
                        onChange={(e) => setDraft(item.pattern, { displayName: e.target.value })}
                        placeholder="Label (optional)"
                        aria-label={`Label for ${name}`}
                        className={cn(FIELD, "@2xl:col-start-2 @2xl:row-start-1 @5xl:col-start-3")}
                      />

                      <ClassifyMenu
                        placeholder="Quick set…"
                        ariaLabel={`Quick set ${name}`}
                        groups={PRESET_MENU_GROUPS}
                        onPick={(id) => {
                          const preset = CLASSIFY_PRESETS.find((p) => p.id === id)
                          if (!preset) return
                          setDraft(item.pattern, {
                            category: preset.category,
                            displayName: preset.suggestedLabel ?? draft.displayName,
                          })
                        }}
                        className="@2xl:col-start-3 @2xl:row-start-1 @5xl:col-start-4"
                      />
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        {error ? (
          <p
            role="alert"
            className="mx-6 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-slate-200/80 px-6 py-3.5 dark:border-slate-800">
          <div className="mr-auto flex items-center gap-3 text-xs">
            {pending > 0 ? (
              <>
                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400 dark:bg-amber-500" />
                  {pending} unsaved change{pending === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => setDrafts(initial)}
                  disabled={saving}
                  className="font-semibold text-slate-500 hover:text-slate-800 hover:underline disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Discard
                </button>
              </>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">No changes</span>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="h-9 rounded-xl border border-slate-200/90 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700/80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading || pending === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : pending > 0 ? `Save ${pending} change${pending === 1 ? "" : "s"}` : "Save"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
