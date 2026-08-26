/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useEffect, useMemo, useState } from "react"
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

/** Members/projects the viewer may filter by, fetched once per mount. */
export function useReportFilterOptions(): ReportFilterOptions {
  const [options, setOptions] = useState<ReportFilterOptions>({ members: [], projects: [] })
  useEffect(() => {
    let cancelled = false
    void fetchReportFilterOptions().then((opts) => {
      if (!cancelled) setOptions(opts)
    })
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

/**
 * The filters panel shared by every report that scopes by member and/or
 * project. Options come from /api/reports/filter-options, which returns only
 * what the viewer may filter by - and the backend re-validates every id, so
 * this is a convenience, not the access boundary.
 */
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
  /** Off for reports with no project dimension (e.g. limits, timesheets). */
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
