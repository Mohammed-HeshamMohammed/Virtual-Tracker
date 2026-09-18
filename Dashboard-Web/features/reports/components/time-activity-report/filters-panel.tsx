"use client"

import type { CSSProperties } from "react"
import { motion } from "framer-motion"
import { X } from "lucide-react"
import type { ActivityLevelFilter, ManualTimeFilter, TrackedTimeFilter } from "@/features/reports/utils/time-and-activity"
import { ReportFilterDropdown } from "@/features/reports/components/time-activity-report/filter-dropdown"
import { PAY_RATE_CURRENCIES } from "@/features/members/config/pay-currencies"

const TRACKED_TIME_SELECT_OPTIONS: { value: TrackedTimeFilter; label: string }[] = [
  { value: "all", label: "All members" },
  { value: "with", label: "Members with tracked time" },
  { value: "without", label: "Members without tracked time" },
]

const MANUAL_TIME_SELECT_OPTIONS: { value: ManualTimeFilter; label: string }[] = [
  { value: "all", label: "Any manual time" },
  { value: "with", label: "Has manual time" },
  { value: "without", label: "No manual time" },
]

const ACTIVITY_LEVEL_OPTIONS: { value: ActivityLevelFilter; label: string }[] = [
  { value: "all", label: "Any activity level" },
  { value: "under_50", label: "Under 50%" },
  { value: "50_to_79", label: "50–79%" },
  { value: "80_plus", label: "80% and above" },
]

export function ReportFiltersPanel({
  onClose,
  panelStyle,
  trackedTimeFilter,
  setTrackedTimeFilter,
  manualTimeFilter,
  setManualTimeFilter,
  activityLevelFilter,
  setActivityLevelFilter,
  displayCurrency,
  resolvedDisplayCurrency,
  setDisplayCurrency,
  onClearFilters,
}: {
  onClose: () => void
  panelStyle?: CSSProperties | null
  trackedTimeFilter: TrackedTimeFilter
  setTrackedTimeFilter: (value: TrackedTimeFilter) => void
  manualTimeFilter: ManualTimeFilter
  setManualTimeFilter: (value: ManualTimeFilter) => void
  activityLevelFilter: ActivityLevelFilter
  setActivityLevelFilter: (value: ActivityLevelFilter) => void
  displayCurrency: string
  resolvedDisplayCurrency?: string
  setDisplayCurrency: (value: string) => void
  onClearFilters: () => void
}) {
  const currencyOptions = [
    { value: "", label: resolvedDisplayCurrency ? `Automatic (${resolvedDisplayCurrency})` : "Automatic" },
    ...PAY_RATE_CURRENCIES,
  ]

  function clearFilters() {
    setDisplayCurrency("")
    onClearFilters()
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
          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">TRACKED TIME</div>
            <ReportFilterDropdown
              label="All members"
              options={TRACKED_TIME_SELECT_OPTIONS.map((o) => o.label)}
              selectedValue={TRACKED_TIME_SELECT_OPTIONS.find((o) => o.value === trackedTimeFilter)?.label ?? "All members"}
              onSelect={(label) => {
                const opt = TRACKED_TIME_SELECT_OPTIONS.find((o) => o.label === label)
                if (opt) setTrackedTimeFilter(opt.value)
              }}
            />
          </div>
          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">MANUAL TIME</div>
            <ReportFilterDropdown
              label="Any manual time"
              options={MANUAL_TIME_SELECT_OPTIONS.map((o) => o.label)}
              selectedValue={MANUAL_TIME_SELECT_OPTIONS.find((o) => o.value === manualTimeFilter)?.label ?? "Any manual time"}
              onSelect={(label) => {
                const opt = MANUAL_TIME_SELECT_OPTIONS.find((o) => o.label === label)
                if (opt) setManualTimeFilter(opt.value)
              }}
            />
          </div>
          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">ACTIVITY LEVEL</div>
            <ReportFilterDropdown
              label="Any activity level"
              options={ACTIVITY_LEVEL_OPTIONS.map((o) => o.label)}
              selectedValue={ACTIVITY_LEVEL_OPTIONS.find((o) => o.value === activityLevelFilter)?.label ?? "Any activity level"}
              onSelect={(label) => {
                const opt = ACTIVITY_LEVEL_OPTIONS.find((o) => o.label === label)
                if (opt) setActivityLevelFilter(opt.value)
              }}
            />
          </div>
          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">DISPLAY CURRENCY</div>
            <ReportFilterDropdown
              label="Automatic"
              options={currencyOptions.map((o) => o.label)}
              selectedValue={currencyOptions.find((o) => o.value === displayCurrency)?.label ?? displayCurrency}
              onSelect={(label) => {
                const opt = currencyOptions.find((o) => o.label === label)
                if (opt) setDisplayCurrency(opt.value)
              }}
            />
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-3 px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-blue-400 dark:bg-blue-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 dark:hover:bg-blue-600"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={clearFilters}
          className="w-full py-2 text-center text-sm text-slate-500 dark:text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
        >
          Clear filters
        </button>
      </div>
    </motion.div>
  )
}

