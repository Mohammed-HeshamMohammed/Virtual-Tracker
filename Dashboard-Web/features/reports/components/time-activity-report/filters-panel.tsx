/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState, type CSSProperties } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Plus, Trash2, X } from "lucide-react"
import {
  CUSTOM_FILTER_FIELDS,
  CUSTOM_FILTER_OPERATORS,
  FILTERS_PANEL_SECTIONS,
  TRACKED_TIME_OPTIONS,
} from "@/features/reports/components/shared/constants"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { newTimeActivityCustomFilterRow } from "@/features/reports/utils/time-and-activity"
import type { TimeActivityCustomFilterRow } from "@/features/reports/models/time-and-activity"
import { ReportFilterDropdown } from "@/features/reports/components/time-activity-report/filter-dropdown"

export function ReportFiltersPanel({
  onClose,
  panelStyle,
}: {
  onClose: () => void
  panelStyle?: CSSProperties | null
}) {
  const [includeArchived, setIncludeArchived] = useState(true)
  const [customFilters, setCustomFilters] = useState<TimeActivityCustomFilterRow[]>([])

  function addCustomFilter() {
    setCustomFilters((rows) => [...rows, newTimeActivityCustomFilterRow()])
  }

  function removeCustomFilter(id: string) {
    setCustomFilters((rows) => rows.filter((r) => r.id !== id))
  }

  function updateCustomFilter(
    id: string,
    patch: Partial<Pick<TimeActivityCustomFilterRow, "field" | "operator" | "value">>
  ) {
    setCustomFilters((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0.96 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 34 }}
      onWheel={(e) => e.stopPropagation()}
      style={panelStyle ?? undefined}
      className={
        panelStyle
          ? "fixed z-110 flex min-h-0 max-w-full flex-col overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/5"
          : "fixed right-3 top-3 z-110 flex max-h-[min(34rem,calc(100vh-4rem))] w-[min(400px,calc(100%-1.5rem))] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/5"
      }
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Filters</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
          <X className="h-5 w-5 text-slate-400 dark:text-slate-500" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4 scrollbar-hide">
        <div className="space-y-5">
          {FILTERS_PANEL_SECTIONS.map(({ label, options }) => (
            <div key={label}>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</div>
              <ReportFilterDropdown label={options[0]!} options={options} />
            </div>
          ))}

          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">TRACKED TIME</div>
            <ReportFilterDropdown label="Members with tracked time" options={TRACKED_TIME_OPTIONS} />
          </div>
        </div>
      </div>

      <div className="shrink-0 px-5 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Custom filters</span>
          <button
            type="button"
            onClick={addCustomFilter}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/60"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
        <div className="space-y-2">
          {customFilters.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 px-2 py-2 text-center text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              No custom filters. Tap <span className="font-semibold text-slate-600 dark:text-slate-300">Add</span> for field / operator /
              value.
            </p>
          )}
          {customFilters.map((row, idx) => (
            <div key={row.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Filter {idx + 1}</span>
                <IconTooltip text="Remove filter" placement="top">
                  <button
                    type="button"
                    onClick={() => removeCustomFilter(row.id)}
                    aria-label="Remove filter"
                    className="rounded-md p-1 text-slate-400 dark:text-slate-500 transition-colors hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </IconTooltip>
              </div>
              <div className="space-y-1.5">
                <select
                  value={row.field}
                  onChange={(e) => updateCustomFilter(row.id, { field: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500"
                >
                  {CUSTOM_FILTER_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <select
                  value={row.operator}
                  onChange={(e) => updateCustomFilter(row.id, { operator: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500"
                >
                  {CUSTOM_FILTER_OPERATORS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateCustomFilter(row.id, { value: e.target.value })}
                  placeholder="Value"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500" aria-label="Interactive control"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-5 py-3">
        <label className="flex cursor-pointer items-center gap-3">
          <div
            role="checkbox"
            aria-checked={includeArchived}
            tabIndex={0}
            onClick={() => setIncludeArchived((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                setIncludeArchived((v) => !v)
              }
            }}
            className={cn(
              "flex h-4 w-4 cursor-pointer items-center justify-center rounded border-2 transition-colors",
              includeArchived ? "border-blue-500 dark:border-blue-500 bg-blue-500 dark:bg-blue-500" : "border-slate-300 dark:border-slate-600"
            )}
          >
            {includeArchived && <Check className="h-3 w-3 text-white" />}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Include archived projects
          </span>
        </label>
      </div>

      <div className="shrink-0 space-y-3 px-5 py-4">
        <button
          type="button"
          className="w-full rounded-xl bg-blue-400 dark:bg-blue-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 dark:hover:bg-blue-600"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2 text-center text-sm text-slate-500 dark:text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
        >
          Clear filters
        </button>
      </div>
    </motion.div>
  )
}

