"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronDown, Search, X, XCircle } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { fetchReportFilterOptions, type ReportFilterOptions } from "@/features/reports/api/misc-reports-api"

export interface ReportFilterState {
  memberIds: Set<string>
  projectIds: Set<string>
}

export function emptyReportFilters(): ReportFilterState {
  return { memberIds: new Set<string>(), projectIds: new Set<string>() }
}

export function useReportFilterOptions(): ReportFilterOptions {
  const [options, setOptions] = useState<ReportFilterOptions>({ members: [], projects: [] })
  useEffect(() => {
    let cancelled = false
    void fetchReportFilterOptions()
      .then((opts) => {
        if (!cancelled) setOptions(opts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return options
}

function MultiSelect({
  label,
  emptyLabel,
  options,
  selected,
  onChange,
  isDark,
}: {
  label: string
  emptyLabel: string
  options: { id: string; name: string }[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  isDark: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options
  }, [options, search])

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <div className="relative">
      <div className={cn("mb-2 text-[10px] font-bold uppercase tracking-wider", isDark ? "text-white/40" : "text-slate-400")}>
        {label}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
          isDark
            ? "border-white/10 bg-white/5 text-[#dce1fb] hover:bg-white/10"
            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
          open && "border-blue-500 ring-1 ring-blue-500"
        )}
      >
        <span>{selected.size === 0 ? emptyLabel : `${selected.size} selected`}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={cn(
              "absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border shadow-lg",
              isDark ? "border-white/10 bg-[#191f31]" : "border-slate-200 bg-white"
            )}
          >
            <div className={cn("border-b p-2", isDark ? "border-white/10" : "border-slate-100")}>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}`}
                  aria-label={`Search ${label.toLowerCase()}`}
                  className={cn(
                    "w-full rounded-lg border py-1.5 pl-8 pr-7 text-sm outline-none",
                    isDark
                      ? "border-white/10 bg-white/5 text-[#dce1fb] placeholder:text-white/30"
                      : "border-slate-200 bg-white text-slate-800 placeholder:text-slate-400"
                  )}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:text-slate-600"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto scrollbar-hide">
              {shown.length === 0 ? (
                <p className={cn("px-4 py-3 text-sm", isDark ? "text-white/40" : "text-slate-500")}>
                  Nothing to filter by
                </p>
              ) : (
                shown.map((o) => {
                  const on = selected.has(o.id)
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggle(o.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                        isDark ? "text-[#dce1fb] hover:bg-white/5" : "text-slate-800 hover:bg-slate-50"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          on
                            ? "border-blue-500 bg-blue-500"
                            : isDark
                              ? "border-white/20 bg-transparent"
                              : "border-slate-300 bg-white"
                        )}
                      >
                        {on ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                      </span>
                      <span className="truncate">{o.name}</span>
                    </button>
                  )
                })
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export function ReportToolbarMultiSelect({
  label,
  emptyLabel,
  options,
  selected,
  onChange,
  allSelected,
  onSelectAll,
  width = "w-60",
}: {
  label: string
  emptyLabel: string
  /** `meta` is drawn before the name - a member's avatar, say. */
  options: { id: string; name: string; meta?: ReactNode }[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  allSelected?: boolean
  onSelectAll?: () => void
  width?: string
}) {
  const { isDark } = useTheme()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query ? options.filter((option) => option.name.toLowerCase().includes(query)) : options
  }, [options, search])
  const selectedNames = options.filter((option) => selected.has(option.id)).map((option) => option.name)
  const isAllSelected = allSelected ?? selected.size === 0
  const summary =
    isAllSelected
      ? emptyLabel
      : selectedNames.length === 0
        ? `No ${label.toLowerCase()}`
        : selectedNames.length === 1
        ? selectedNames[0]
        : `${selectedNames.length} ${label.toLowerCase()}`

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <div ref={rootRef} className={cn("relative", width)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm transition-colors",
          isDark
            ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
          open && "border-blue-500 ring-1 ring-blue-500"
        )}
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={{ duration: 0.12 }}
            className={cn(
              "absolute left-0 top-full z-70 mt-1 w-full min-w-64 overflow-hidden rounded-xl border shadow-xl",
              isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"
            )}
          >
            <div className={cn("border-b p-2", isDark ? "border-slate-700" : "border-slate-100")}>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Search ${label.toLowerCase()}`}
                  aria-label={`Search ${label.toLowerCase()}`}
                  className={cn(
                    "h-8 w-full rounded-lg border py-1.5 pl-8 pr-3 text-sm outline-none focus:border-blue-500",
                    isDark
                      ? "border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
                      : "border-slate-200 bg-white text-slate-800 placeholder:text-slate-400"
                  )}
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto py-1 scrollbar-hide" role="listbox" aria-label={label}>
              <button
                type="button"
                onClick={() => (onSelectAll ? onSelectAll() : onChange(new Set()))}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  isDark ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-50"
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    isAllSelected
                      ? "border-blue-500 bg-blue-500"
                      : isDark
                        ? "border-slate-600"
                        : "border-slate-300"
                  )}
                >
                  {isAllSelected ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                </span>
                <span className="truncate">{emptyLabel}</span>
              </button>
              {shown.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-500">No matches</p>
              ) : (
                shown.map((option) => {
                  const active = selected.has(option.id)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggle(option.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                        isDark ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          active
                            ? "border-blue-500 bg-blue-500"
                            : isDark
                              ? "border-slate-600"
                              : "border-slate-300"
                        )}
                      >
                        {active ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                      </span>
                      {option.meta}
                      <span className="truncate">{option.name}</span>
                    </button>
                  )
                })
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export function ReportFiltersPanel({
  onClose,
  options,
  value,
  onChange,
  showProjects = true,
}: {
  onClose: () => void
  options: ReportFilterOptions
  value: ReportFilterState
  onChange: (next: ReportFilterState) => void
  showProjects?: boolean
}) {
  const { isDark } = useTheme()
  const activeCount = value.memberIds.size + value.projectIds.size

  return (
    <div
      className={cn(
        "flex max-h-[min(30rem,85vh)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-xl",
        isDark ? "border-white/10 bg-[#191f31]" : "border-slate-200 bg-white"
      )}
    >
      <div className={cn("flex items-center justify-between border-b px-4 py-3", isDark ? "border-white/10" : "border-slate-100")}>
        <h2 className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>
          {activeCount > 0 ? `Filters (${activeCount})` : "Filters"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={cn(
            "rounded-lg p-1.5 transition-colors",
            isDark ? "text-white/40 hover:bg-white/10" : "text-slate-400 hover:bg-slate-100"
          )}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 scrollbar-hide">
        <MultiSelect
          label="Members"
          emptyLabel="All members"
          options={options.members}
          selected={value.memberIds}
          onChange={(memberIds) => onChange({ ...value, memberIds })}
          isDark={isDark}
        />
        {showProjects ? (
          <MultiSelect
            label="Projects"
            emptyLabel="All projects"
            options={options.projects}
            selected={value.projectIds}
            onChange={(projectIds) => onChange({ ...value, projectIds })}
            isDark={isDark}
          />
        ) : null}
      </div>

      <div className={cn("flex shrink-0 gap-2 border-t px-4 py-3", isDark ? "border-white/10" : "border-slate-100")}>
        <button
          type="button"
          onClick={() => onChange(emptyReportFilters())}
          disabled={activeCount === 0}
          className={cn(
            "flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors disabled:opacity-40",
            isDark
              ? "border-white/10 text-[#dce1fb] hover:bg-white/5"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          )}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-xl bg-blue-500 py-2.5 text-sm font-semibold text-white hover:bg-blue-600"
        >
          Done
        </button>
      </div>
    </div>
  )
}
