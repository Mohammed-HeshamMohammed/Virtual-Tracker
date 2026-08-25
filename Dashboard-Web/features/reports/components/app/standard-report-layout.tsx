/* eslint-disable react-doctor/use-lazy-motion */
/* eslint-disable react-doctor/no-giant-component */
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Menu,
  Send,
  X,
} from "lucide-react"
import { ReportDateRangePicker } from "@/features/reports/components/time-activity-report/date-range-picker"
import { ReportSimpleDropdown } from "@/features/reports/components/time-activity-report/simple-dropdown"
import { ReportScheduleDialog } from "@/features/reports/components/amounts-owed/report-schedule-dialog"
import { ReportSendDialog } from "@/features/reports/components/amounts-owed/report-send-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu"
import { useTheme } from "@/shared/providers/app"
import {
  STANDARD_REPORT_GROUP_BY_OPTIONS,
  STANDARD_REPORT_ORG_LABEL,
  STANDARD_REPORT_TIMEZONE_LABEL,
} from "@/features/reports/components/shared/constants"
import { formatRangeLabel, startOfDay, endOfDay } from "@/features/reports/utils/time-and-activity"
import { cn } from "@/shared/utils/utils"

export type StandardReportScope = "me" | "all"

export type StandardReportLayoutContextValue = {
  scope: StandardReportScope
  rangeStart: Date
  rangeEnd: Date
  dateLabel: string
  groupBy: string
  registerExportHandler: (fn: (() => void) | null) => void
}

const StandardReportLayoutContext = createContext<StandardReportLayoutContextValue | null>(null)

export function useStandardReportLayout(): StandardReportLayoutContextValue {
  const v = use(StandardReportLayoutContext)
  if (!v) {
    throw new Error("useStandardReportLayout must be used within StandardReportLayout")
  }
  return v
}

function DefaultFiltersPanel({ onClose, isDark }: { onClose: () => void; isDark: boolean }) {
  return (
    <div
      className={cn(
        "flex max-h-[min(24rem,85vh)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-sm",
        isDark ? "border-white/10 bg-[#191f31]" : "border-slate-200 bg-white"
      )}
    >
      <div className={cn("flex items-center justify-between border-b px-4 py-3", isDark ? "border-white/10" : "border-slate-100")}>
        <h2 className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>Filters</h2>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "rounded-lg p-1.5 transition-colors",
            isDark ? "text-white/40 hover:bg-white/10" : "text-slate-400 hover:bg-slate-100"
          )}
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className={cn("px-4 py-6 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        No additional filters for this report (demo).
      </div>
      <div className={cn("border-t px-4 py-3", isDark ? "border-white/10" : "border-slate-100")}>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-sky-500 py-2.5 text-sm font-semibold text-white hover:bg-sky-600"
        >
          Done
        </button>
      </div>
    </div>
  )
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
  titleTone = "emphasis",
  orgLayout = "default",
  showDateRange = true,
  showScopeTabs = true,
  showGroupBy = true,
  children,
}: {
  title: string
  onNavigate?: (id: string) => void
  groupByOptions?: { value: string; label: string }[]
  defaultGroupBy?: string
  filtersPanel?: ReactNode
  exportFileBaseName?: string
  /** emphasis = medium dark title + single-line org (shift report mock); muted = light large title + two-line org */
  titleTone?: "emphasis" | "muted"
  /** stacked-subtle = org name + smaller timezone (project budgets mock); default follows titleTone */
  orgLayout?: "default" | "stacked-subtle"
  // A report that never reads `rangeStart`/`rangeEnd`, `scope`, or `groupBy`
  // out of this layout's context must hide the matching control rather than
  // render a dead one. Several reports used to show all three and consume
  // none, so clicking them visibly did nothing.
  /** Date nav (prev / picker / next / Today). Off for period-scoped reports. */
  showDateRange?: boolean
  /** ME / ALL scope tabs. */
  showScopeTabs?: boolean
  /** "Group by:" dropdown. */
  showGroupBy?: boolean
  children: ReactNode
}) {
  const { isDark } = useTheme()
  const [scope, setScope] = useComponentState<StandardReportScope>("all")
  const [rangeStart, setRangeStart] = useComponentState(() => startOfDay(new Date()))
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

  const dateLabel = useMemo(() => formatRangeLabel(rangeStart, rangeEnd), [rangeStart, rangeEnd])

  const contextValue = useMemo(
    (): StandardReportLayoutContextValue => ({
      scope,
      rangeStart,
      rangeEnd,
      dateLabel,
      groupBy,
      registerExportHandler,
    }),
    [scope, rangeStart, rangeEnd, dateLabel, groupBy, registerExportHandler]
  )

  function shiftRangeByDays(delta: number) {
    const s = new Date(rangeStart)
    s.setDate(s.getDate() + delta)
    const e = new Date(rangeEnd)
    e.setDate(e.getDate() + delta)
    setRangeStart(startOfDay(s))
    setRangeEnd(endOfDay(e))
  }

  function goToToday() {
    const now = new Date()
    setRangeStart(startOfDay(now))
    setRangeEnd(endOfDay(now))
  }

  function runExport() {
    // Only a child-registered handler can export real rows. There used to be
    // a fallback here writing a literal "Demo,<range>" CSV, which looked like
    // a genuine (if empty) export of the report the user was looking at.
    exportHandlerRef.current?.()
  }

  const panel =
    filtersPanel ?? <DefaultFiltersPanel isDark={isDark} onClose={() => setShowFilters(false)} />

  return (
    <StandardReportLayoutContext.Provider value={contextValue}>
      <div className="relative isolate min-h-0">
        <div className="relative mx-auto min-h-0 max-w-[1400px] space-y-5 px-0 py-0">

          {/* Row 1: title (left) + date range + Today + Filters (right) — matches reference */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <h1
              className={cn(
                "min-w-0 max-w-xl tracking-tight",
                titleTone === "muted"
                  ? cn("text-3xl font-light", isDark ? "text-white/45" : "text-slate-400")
                  : cn("text-2xl font-medium", isDark ? "text-white/90" : "text-slate-800")
              )}
            >
              {title}
            </h1>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:pt-1">
              {showDateRange ? (
                <>
              <button
                type="button"
                onClick={() => shiftRangeByDays(-1)}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm",
                  isDark
                    ? "border-white/10 bg-white/5 text-[#dce1fb] hover:bg-white/10"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
                aria-label="Previous period"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="relative z-50">
                <button
                  type="button"
                  onClick={() => setShowDatePicker((x) => !x)}
                  className={cn(
                    "flex min-w-[240px] max-w-[min(100vw-8rem,420px)] items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                    isDark
                      ? "border-white/10 bg-white/5 text-[#dce1fb] hover:bg-white/10"
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
              <button
                type="button"
                onClick={() => shiftRangeByDays(1)}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm",
                  isDark
                    ? "border-white/10 bg-white/5 text-[#dce1fb] hover:bg-white/10"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
                aria-label="Next period"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={goToToday}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium",
                  isDark
                    ? "border-white/10 bg-white/5 text-[#dce1fb] hover:bg-white/10"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
              >
                Today
              </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => setShowFilters(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600"
              >
                Filters
                <ChevronDown className="h-4 w-4 opacity-90" />
              </button>
            </div>
          </div>

          {/* Row 2: ME / ALL */}
          <div
            className={cn(
              "flex flex-wrap gap-10 border-b pb-3",
              isDark ? "border-white/10" : "border-slate-200"
            )}
          >
            {(showScopeTabs ? (["me", "all"] as const) : ([] as const)).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setScope(v)}
                className={cn(
                  "-mb-px border-b-2 pb-2 text-sm font-semibold transition-colors",
                  scope === v
                    ? isDark
                      ? "border-blue-500 text-blue-400"
                      : "border-blue-500 text-blue-600"
                    : isDark
                      ? "border-transparent text-white/35 hover:text-white/60"
                      : "border-transparent text-slate-400 hover:text-slate-600"
                )}
              >
                {v === "me" ? "ME" : "ALL"}
              </button>
            ))}
          </div>

          {/* Row 3: TVC + group by (left) · Send / Schedule / Export (right) */}
          <div
            className={cn(
              "flex flex-col gap-4 border-b pb-5 pt-1 lg:flex-row lg:items-end lg:justify-between",
              isDark ? "border-white/10" : "border-slate-200"
            )}
          >
            <div className="space-y-1">
              {orgLayout === "stacked-subtle" ? (
                <>
                  <div className={cn("text-base font-semibold", isDark ? "text-white/90" : "text-slate-900")}>
                    {STANDARD_REPORT_ORG_LABEL}
                  </div>
                  <div className={cn("text-sm", isDark ? "text-white/45" : "text-slate-400")}>
                    {STANDARD_REPORT_TIMEZONE_LABEL}
                  </div>
                </>
              ) : titleTone === "emphasis" ? (
                <div className={cn("text-sm", isDark ? "text-white/45" : "text-slate-400")}>
                  {STANDARD_REPORT_ORG_LABEL} {STANDARD_REPORT_TIMEZONE_LABEL}
                </div>
              ) : (
                <>
                  <div className={cn("text-2xl font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                    {STANDARD_REPORT_ORG_LABEL}
                  </div>
                  <div className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                    {STANDARD_REPORT_TIMEZONE_LABEL}
                  </div>
                </>
              )}
              {showGroupBy ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Menu className={cn("h-4 w-4", isDark ? "text-white/40" : "text-slate-500")} />
                  <span className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600")}>Group by:</span>
                  <ReportSimpleDropdown
                    value={groupBy}
                    onChange={setGroupBy}
                    options={groupByOptions}
                    width="w-40"
                    accentBar={false}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-4 lg:gap-5">
              <button
                type="button"
                onClick={() => setSendOpen(true)}
                className={cn(
                  "inline-flex items-center gap-1.5 text-sm font-medium transition-colors",
                  isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-500 hover:text-blue-600"
                )}
              >
                <Send className="h-4 w-4 shrink-0" strokeWidth={2} />
                Send
              </button>
              <button
                type="button"
                onClick={() => setScheduleOpen(true)}
                className={cn(
                  "inline-flex items-center gap-1.5 text-sm font-medium transition-colors",
                  isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-500 hover:text-blue-600"
                )}
              >
                <Clock className="h-4 w-4 shrink-0" strokeWidth={2} />
                Schedule
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 text-sm font-medium transition-colors",
                      isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-500 hover:text-blue-600"
                    )}
                  >
                    <Download className="h-4 w-4 shrink-0" strokeWidth={2} />
                    Export
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canExport ? (
                    <DropdownMenuItem onClick={runExport}>To CSV</DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={() => window.print()}>Print / PDF</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="report-print-area pt-4">{children}</div>
        </div>

        <ReportSendDialog open={sendOpen} onOpenChange={setSendOpen} />
        <ReportScheduleDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          onRequestOpenFilters={() => setShowFilters(true)}
        />

        <AnimatePresence>
          {showFilters ? (
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
                className="fixed right-6 top-28 z-110 max-h-[calc(100%-8rem)] overflow-y-auto"
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

