"use client"

import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  useState as useComponentState,
  type ReactNode, use } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Calendar,
  Clock,
  Download,
  Filter,
  Play,
} from "lucide-react"
import { ReportDateRangePicker } from "@/features/reports/components/time-activity-report/date-range-picker"
import { ReportSimpleDropdown } from "@/features/reports/components/time-activity-report/simple-dropdown"
import { ReportScheduleDialog, type ReportScheduleInput } from "@/features/reports/components/amounts-owed/report-schedule-dialog"
import { ReportSendDialog, type ReportSendInput } from "@/features/reports/components/amounts-owed/report-send-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { useTheme } from "@/shared/providers/app"
import {
  STANDARD_REPORT_GROUP_BY_OPTIONS,
  reportTimezoneLabelFor,
} from "@/features/reports/components/shared/constants"
import {
  ReportToolbarMultiSelect,
  type ReportFilterState,
} from "@/features/reports/components/shared/report-filters-panel"
import type { ReportFilterOptions } from "@/features/reports/api/misc-reports-api"
import { formatRangeLabel, startOfDay, endOfDay } from "@/features/reports/utils/time-and-activity"
import { reportCardFor } from "@/features/reports/catalog"
import { cn } from "@/shared/utils/utils"

export type StandardReportScope = "me" | "all"

export type StandardReportToolbarFilters = {
  options: ReportFilterOptions
  value: ReportFilterState
  onChange: (next: ReportFilterState) => void
  showMembers?: boolean
  showProjects?: boolean
}

export type { ReportSendInput } from "@/features/reports/components/amounts-owed/report-send-dialog"
export type { ReportScheduleInput } from "@/features/reports/components/amounts-owed/report-schedule-dialog"

export type StandardReportLayoutContextValue = {
  scope: StandardReportScope
  rangeStart: Date
  rangeEnd: Date
  dateLabel: string
  groupBy: string
  registerExportHandler: (fn: (() => void) | null) => void
  registerPdfExportHandler: (fn: (() => void) | null) => void
}

const StandardReportLayoutContext = createContext<StandardReportLayoutContextValue | null>(null)

export function useStandardReportLayout(): StandardReportLayoutContextValue {
  const v = use(StandardReportLayoutContext)
  if (!v) {
    throw new Error("useStandardReportLayout must be used within StandardReportLayout")
  }
  return v
}

export function ReportEmptyState({
  title = "Nothing to report",
  subtitle = "Expecting to see something? Try adjusting the report.",
}: {
  title?: string
  subtitle?: string
}) {
  const { isDark } = useTheme()
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <svg
        className="mb-8 h-44 w-full max-w-[220px]"
        viewBox="0 0 220 180"
        fill="none"
        aria-hidden
      >
        <rect x="48" y="108" width="124" height="58" rx="8" fill={isDark ? "#1e293b" : "#f1f5f9"} stroke={isDark ? "#334155" : "#e2e8f0"} strokeWidth="2" />
        <path d="M62 124h96M62 136h72M62 148h84" stroke={isDark ? "#475569" : "#cbd5e1"} strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="110" cy="52" rx="36" ry="14" fill={isDark ? "#334155" : "#e2e8f0"} />
        <circle cx="110" cy="42" r="20" fill={isDark ? "#475569" : "#cbd5e1"} stroke={isDark ? "#64748b" : "#94a3b8"} strokeWidth="2" />
        <circle cx="104" cy="40" r="2" fill={isDark ? "#94a3b8" : "#64748b"} />
        <circle cx="116" cy="40" r="2" fill={isDark ? "#94a3b8" : "#64748b"} />
        <path d="M104 48 Q110 52 116 48" stroke={isDark ? "#94a3b8" : "#64748b"} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <circle cx="110" cy="22" r="10" fill={isDark ? "#3b82f6" : "#93c5fd"} opacity="0.9" />
        <text x="110" y="26" textAnchor="middle" fill={isDark ? "#e2e8f0" : "#1d4ed8"} fontSize="12" fontWeight="700">
          ?
        </text>
        <rect x="96" y="62" width="28" height="36" rx="4" fill={isDark ? "#64748b" : "#94a3b8"} opacity="0.5" />
      </svg>
      <p className={cn("text-lg font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>{title}</p>
      <p className={cn("mt-2 max-w-sm text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>{subtitle}</p>
    </div>
  )
}

export function StandardReportLayout({
  title,
  onNavigate,
  groupByOptions = STANDARD_REPORT_GROUP_BY_OPTIONS,
  defaultGroupBy = "date",
  filtersPanel,
  exportFileBaseName,
  pageId,
  subtitle,
  onSend,
  onSchedule,
  toolbarFilters,
  showDateRange = true,
  showScopeTabs = true,
  showGroupBy = true,
  children,
}: {
  title: string
  onNavigate?: (id: string) => void
  groupByOptions?: { value: string; label: string }[]
  defaultGroupBy?: string
  filtersPanel?: ReactNode | ((close: () => void) => ReactNode)
  exportFileBaseName?: string
  pageId?: string
  subtitle?: string
  onSend?: (input: ReportSendInput) => Promise<void>
  onSchedule?: (input: ReportScheduleInput) => Promise<void>
  toolbarFilters?: StandardReportToolbarFilters
  showDateRange?: boolean
  showScopeTabs?: boolean
  showGroupBy?: boolean
  children: ReactNode
}) {
  const { isDark } = useTheme()
  const [scope, setScope] = useComponentState<StandardReportScope>("all")
  const [rangeStart, setRangeStart] = useComponentState(() => {
    const d = startOfDay(new Date())
    d.setDate(d.getDate() - 6)
    return d
  })
  const [rangeEnd, setRangeEnd] = useComponentState(() => endOfDay(new Date()))
  const [showDatePicker, setShowDatePicker] = useComponentState(false)
  const [showFilters, setShowFilters] = useComponentState(false)
  const [groupBy, setGroupBy] = useComponentState(defaultGroupBy)
  const [sendOpen, setSendOpen] = useComponentState(false)
  const [scheduleOpen, setScheduleOpen] = useComponentState(false)

  const exportHandlerRef = useRef<(() => void) | null>(null)
  const [canExport, setCanExport] = useComponentState(false)
  const registerExportHandler = useCallback((fn: (() => void) | null) => {
    exportHandlerRef.current = fn
    setCanExport(Boolean(fn))
  }, [])

  const pdfExportHandlerRef = useRef<(() => void) | null>(null)
  const [canExportPdf, setCanExportPdf] = useComponentState(false)
  const registerPdfExportHandler = useCallback((fn: (() => void) | null) => {
    pdfExportHandlerRef.current = fn
    setCanExportPdf(Boolean(fn))
  }, [])

  const dateLabel = useMemo(() => formatRangeLabel(rangeStart, rangeEnd), [rangeStart, rangeEnd])
  const resolvedSubtitle = subtitle ?? (pageId ? reportCardFor(pageId)?.description : undefined)
  const timezoneLabel = reportTimezoneLabelFor(pageId)
  const toolbarTimezoneLabel =
    timezoneLabel === "Each member's own timezone"
      ? "Member TZ"
      : timezoneLabel === "Calendar dates"
        ? "Calendar"
        : timezoneLabel

  const contextValue = useMemo(
    (): StandardReportLayoutContextValue => ({
      scope,
      rangeStart,
      rangeEnd,
      dateLabel,
      groupBy,
      registerExportHandler,
      registerPdfExportHandler,
    }),
    [scope, rangeStart, rangeEnd, dateLabel, groupBy, registerExportHandler, registerPdfExportHandler]
  )

  function runExport() {
    exportHandlerRef.current?.()
  }

  function runPdfExport() {
    pdfExportHandlerRef.current?.()
  }

  const closeFilters = useCallback(() => setShowFilters(false), [])
  const panel =
    typeof filtersPanel === "function" ? filtersPanel(closeFilters) : (filtersPanel ?? null)

  return (
    <StandardReportLayoutContext.Provider value={contextValue}>
      <div className="relative isolate min-h-0">
        <div className="report-print-area relative mx-auto min-h-0 max-w-[1400px] space-y-6 px-6 py-6">

          <div className="relative z-50 flex flex-wrap items-end gap-3 gap-y-3">
            {/* The report's name and blurb are already on the card that got
                you here and in the nav, so on the page itself they were two
                lines of chrome pushing the actual data below the fold. The
                heading stays in the accessibility tree - a page still needs
                one - it just isn't painted. */}
            <h1 className="sr-only">{title}</h1>
            {resolvedSubtitle ? <p className="sr-only">{resolvedSubtitle}</p> : null}
            {toolbarFilters?.showMembers !== false ? (
              toolbarFilters ? (
                <div className="flex min-w-60 flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Members
                  </span>
                  <ReportToolbarMultiSelect
                    label="Members"
                    emptyLabel="All members"
                    options={toolbarFilters.options.members}
                    selected={toolbarFilters.value.memberIds}
                    onChange={(memberIds) => toolbarFilters.onChange({ ...toolbarFilters.value, memberIds })}
                  />
                </div>
              ) : null
            ) : null}

            {toolbarFilters?.showProjects !== false ? (
              toolbarFilters ? (
                <div className="flex min-w-60 flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Projects
                  </span>
                  <ReportToolbarMultiSelect
                    label="Projects"
                    emptyLabel="All projects"
                    options={toolbarFilters.options.projects}
                    selected={toolbarFilters.value.projectIds}
                    onChange={(projectIds) => toolbarFilters.onChange({ ...toolbarFilters.value, projectIds })}
                  />
                </div>
              ) : null
            ) : null}

              {showDateRange ? (
                <div className="relative flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Date range
                  </span>
                <button
                  type="button"
                  onClick={() => setShowDatePicker((x) => !x)}
                  className={cn(
                    "flex h-9 min-w-[240px] max-w-[min(100vw-3rem,420px)] items-center justify-between gap-2 rounded-lg border px-3 text-sm",
                    isDark
                      ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                    showDatePicker ? "border-blue-500 ring-1 ring-blue-500" : ""
                  )}
                >
                  <span className="truncate">{dateLabel}</span>
                  <Calendar className="h-4 w-4 shrink-0 text-blue-500" />
                </button>
                <AnimatePresence>
                  {showDatePicker ? (
                    <ReportDateRangePicker
                      key={`${rangeStart.getTime()}-${rangeEnd.getTime()}`}
                      initialStart={rangeStart}
                      initialEnd={rangeEnd}
                      onApplyRange={(s, e) => {
                        setRangeStart(s)
                        setRangeEnd(e)
                      }}
                      onApply={() => setShowDatePicker(false)}
                      onDismiss={() => setShowDatePicker(false)}
                    />
                  ) : null}
                </AnimatePresence>
                </div>
              ) : null}

            {showDateRange ? (
              <div
                title={timezoneLabel}
                className="flex h-9 items-center pb-0.5 text-sm font-semibold text-slate-700 dark:text-slate-200"
              >
                {toolbarTimezoneLabel}
              </div>
            ) : null}

            {showScopeTabs ? (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Scope
                </span>
                <div className="flex h-9 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                  {(["me", "all"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setScope(value)}
                      className={cn(
                        "px-4 text-sm font-semibold transition-colors",
                        scope === value
                          ? "bg-blue-500 text-white"
                          : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
                      )}
                    >
                      {value === "me" ? "Me" : "All"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {showGroupBy ? (
              <div className="flex min-w-40 flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Data grouped by
                </span>
                  <ReportSimpleDropdown
                    value={groupBy}
                    onChange={setGroupBy}
                    options={groupByOptions}
                    width="w-44"
                    accentBar={false}
                  />
              </div>
            ) : null}

            <div className="ml-auto flex flex-wrap items-center gap-2 pb-0.5">
              {onSend ? (
                <IconTooltip text="Send" placement="bottom">
                  <button
                    type="button"
                    onClick={() => setSendOpen(true)}
                    aria-label="Send"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-500 transition-colors hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-400 dark:hover:bg-blue-950/60"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                </IconTooltip>
              ) : null}
              {onSchedule ? (
                <IconTooltip text="Schedule" placement="bottom">
                  <button
                    type="button"
                    onClick={() => setScheduleOpen(true)}
                    aria-label="Schedule"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-500 transition-colors hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-400 dark:hover:bg-blue-950/60"
                  >
                    <Clock className="h-4 w-4" />
                  </button>
                </IconTooltip>
              ) : null}
              {panel ? (
                <button
                  type="button"
                  onClick={() => setShowFilters(true)}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm text-blue-500 transition-colors hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-400 dark:hover:bg-blue-950/60"
                >
                  <Filter className="h-3.5 w-3.5" />
                  Filter
                </button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={!canExport && !canExportPdf}
                    aria-label="Export"
                    className="flex h-9 min-w-11 items-center justify-center rounded-lg bg-blue-500 px-3 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canExport ? (
                    <DropdownMenuItem onClick={runExport}>To CSV</DropdownMenuItem>
                  ) : null}
                  {canExportPdf ? (
                    <DropdownMenuItem onClick={runPdfExport}>To PDF</DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700" />

          <div>{children}</div>
        </div>

        {onSend ? <ReportSendDialog open={sendOpen} onOpenChange={setSendOpen} onSend={onSend} /> : null}
        {onSchedule ? (
          <ReportScheduleDialog
            open={scheduleOpen}
            onOpenChange={setScheduleOpen}
            onSave={onSchedule}
            onRequestOpenFilters={panel ? () => setShowFilters(true) : undefined}
          />
        ) : null}

        <AnimatePresence>
          {showFilters && panel ? (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-100 bg-black/20"
                onClick={() => setShowFilters(false)}
                aria-hidden
              />
              <motion.div
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                className="fixed right-6 top-28 z-110 max-h-[calc(100%-8rem)] overflow-y-auto custom-scrollbar"
              >
                {panel}
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      </div>
    </StandardReportLayoutContext.Provider>
  )
}

