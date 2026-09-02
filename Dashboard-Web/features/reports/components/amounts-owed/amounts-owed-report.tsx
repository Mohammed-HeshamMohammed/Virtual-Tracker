/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { Fragment, useEffect, useMemo, useState as useComponentState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  LineChart,
  Send,
  SlidersHorizontal,
} from "lucide-react"
import {
  AMOUNTS_OWED_DEFAULT_VISIBLE_COLUMNS,
  type AmountsOwedColumnKey,
  type AmountsOwedDayGroup,
} from "@/features/reports/components/shared/constants"
import { ReportDateRangePicker } from "@/features/reports/components/time-activity-report/date-range-picker"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { formatRangeLabel, formatSecondsAsHMS, parseTimeToSeconds, startOfDay, endOfDay } from "@/features/reports/utils/time-and-activity"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu"
import { cn } from "@/shared/utils/utils"
import { AmountsOwedFiltersPanel } from "@/features/reports/components/amounts-owed/amounts-owed-filters-panel"
import { AmountsOwedTableColumnsMenu } from "@/features/reports/components/amounts-owed/amounts-owed-table-columns-menu"
import { ReportScheduleDialog } from "@/features/reports/components/amounts-owed/report-schedule-dialog"
import { ReportSendDialog } from "@/features/reports/components/amounts-owed/report-send-dialog"
import { fetchAmountsOwedReport, fetchReportFilterOptions, type ReportFilterOptions } from "@/features/reports/api/misc-reports-api"
import { useAuth } from "@/shared/providers/app"
import { ReportErrorState, ReportPageHeading, ReportTableSkeleton } from "@/features/reports/components/shared/report-ui"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import { STANDARD_REPORT_ORG_LABEL, STANDARD_REPORT_TIMEZONE_LABEL } from "@/features/reports/components/shared/constants"

function sumHoursStrings(hmsList: string[]): string {
  const sec = hmsList.reduce((a, h) => a + parseTimeToSeconds(h), 0)
  return formatSecondsAsHMS(sec)
}

function sumAmountStrings(amountList: string[]): string {
  const total = amountList.reduce((a, v) => a + (Number.parseFloat(v.replace(/[^0-9.-]/g, "")) || 0), 0)
  return `$${total.toFixed(2)}`
}
const yTicks = [0, 2, 4, 6, 8, 10]

function downloadAmountsOwedCsv(groups: AmountsOwedDayGroup[]): void {
  const header = ["Date", "Member", "Rate", "Hours", "Amount"]
  const rows = groups.flatMap((group) =>
    group.members.map((m) => [group.dateLabel, m.name, m.rateLabel, m.hours, m.amount])
  )
  const csv = [header, ...rows]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `amounts-owed-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function parseMoney(label: string): number {
  const n = Number(String(label).replace(/[^0-9.-]/g, ""))
  return Number.isFinite(n) ? n : 0
}

function downloadAmountsOwedPdf(groups: AmountsOwedDayGroup[], dateLabel: string): void {
  const byMember = new Map<string, number>()
  groups.forEach((g) => g.members.forEach((m) => byMember.set(m.name, (byMember.get(m.name) ?? 0) + parseMoney(m.amount))))
  const allHours = groups.flatMap((g) => g.members.map((m) => m.hours))
  const allAmounts = groups.flatMap((g) => g.members.map((m) => m.amount))
  downloadReportPdf({
    title: "Amounts Owed Report",
    subtitle: "Outstanding balances and what the organization owes members and contractors.",
    orgLabel: STANDARD_REPORT_ORG_LABEL,
    timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
    rangeLabel: dateLabel,
    summary: [
      { label: "Hours", value: sumHoursStrings(allHours) },
      { label: "Amount", value: sumAmountStrings(allAmounts) },
    ],
    charts: [
      ...(groups.length > 0
        ? [
            {
              type: "line" as const,
              title: "Total amount per day",
              points: groups.map((g) => ({
                label: g.dateLabel,
                value: g.members.reduce((sum, m) => sum + parseMoney(m.amount), 0),
              })),
              valueFormatter: (v: number) => `$${v.toFixed(0)}`,
            },
          ]
        : []),
      ...(byMember.size > 0
        ? [
            {
              type: "bar" as const,
              title: "Amount by member",
              data: [...byMember.entries()]
                .sort(([, a], [, b]) => b - a)
                .map(([label, value]) => ({ label, value })),
              valueFormatter: (v: number) => `$${v.toFixed(0)}`,
            },
          ]
        : []),
    ],
    table: {
      columns: [
        { header: "Date", key: "date" },
        { header: "Member", key: "member" },
        { header: "Rate", key: "rate" },
        { header: "Hours", key: "hours", align: "right" },
        { header: "Amount", key: "amount", align: "right" },
      ],
      rows: groups.flatMap((g) =>
        g.members.map((m) => ({
          date: g.dateLabel,
          member: m.name,
          rate: m.rateLabel,
          hours: m.hours,
          amount: m.amount,
        })),
      ),
      emptyMessage: "No tracked time in this date range.",
    },
    filename: "amounts-owed",
  })
}

/** Total amount per day, plotted from the report's own rows. */
function AmountPerDayChart({ groups }: { groups: AmountsOwedDayGroup[] }) {
  const series = groups.map((g) => ({
    label: g.dateLabel,
    value: g.members.reduce((sum, m) => sum + parseMoney(m.amount), 0),
  }))
  const n = series.length
  const CHART_H = 220
  const padL = 44
  const padR = 12
  const padT = 16
  const padB = 28
  const vbW = 960
  const plotW = vbW - padL - padR
  const plotH = CHART_H - padT - padB
  const rawMax = Math.max(0, ...series.map((s) => s.value))
  // Round the axis up to something readable instead of ending on a stray value.
  const yMax = rawMax <= 0 ? 10 : Math.ceil(rawMax / 4) * 4
  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const yAt = (v: number) => padT + plotH - (v / yMax) * plotH
  const yTicks = [0, yMax / 4, yMax / 2, (yMax * 3) / 4, yMax]
  const points = series.map((s, i) => `${xAt(i)},${yAt(s.value)}`).join(" ")

  if (n === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm">
        <div className="border-b border-slate-50 dark:border-white/10 px-6 py-3">
          <h3 className="text-base font-semibold text-slate-800 dark:text-[#dce1fb]">Total amount per day</h3>
        </div>
        <div className="px-6 py-10 text-center text-sm text-slate-500 dark:text-white/45">No data in this range</div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm">
      <div className="border-b border-slate-50 dark:border-white/10 px-6 py-3">
        <h3 className="text-base font-semibold text-slate-800 dark:text-[#dce1fb]">Total amount per day</h3>
      </div>
      <div className="px-6 pb-6 pt-2">
        {/* maxWidth caps this at the chart's own natural (960-unit) size -
            w-full alone let it stretch to fill whatever wide card/page it
            sat in, and with preserveAspectRatio="none" that didn't just
            widen the chart, it distorted the line's own slope. Still
            shrinks on a narrow viewport (w-full below the cap). */}
        <div className="w-full" style={{ height: CHART_H, maxWidth: vbW }}>
          <svg
            className="h-full w-full"
            viewBox={`0 0 ${vbW} ${CHART_H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Amount per day chart"
          >
            {yTicks.map((t) => {
              const yy = yAt(t)
              return (
                <g key={t}>
                  <line x1={padL} x2={vbW - padR} y1={yy} y2={yy} stroke="#f1f5f9" strokeWidth={1} />
                  <text x={padL - 8} y={yy + 4} textAnchor="end" fill="#94a3b8" style={{ fontSize: 10 }}>
                    {Math.round(t)}
                  </text>
                </g>
              )
            })}
            <polyline
              fill="none"
              stroke="rgb(37 99 235)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={points}
            />
            {series.map((s, i) => (
              <circle
                key={`${i}-${s.label}`}
                cx={xAt(i)}
                cy={yAt(s.value)}
                r={3}
                fill="white"
                stroke="rgb(37 99 235)"
                strokeWidth={2}
              >
                <title>{`${s.label}: ${s.value.toFixed(2)}`}</title>
              </circle>
            ))}
            <text x={padL} y={CHART_H - 6} fill="#94a3b8" style={{ fontSize: 9 }}>
              {series[0]?.label ?? ""}
            </text>
            <text x={vbW - padR} y={CHART_H - 6} textAnchor="end" fill="#94a3b8" style={{ fontSize: 9 }}>
              {series[n - 1]?.label ?? ""}
            </text>
          </svg>
        </div>
      </div>
    </div>
  )
}

export function AmountsOwedReport() {
  const { memberId } = useAuth()
  const [scope, setScope] = useComponentState<"me" | "all">("all")
  const [rangeStart, setRangeStart] = useComponentState(() => {
    const d = startOfDay(new Date())
    d.setDate(d.getDate() - 6)
    return d
  })
  const [rangeEnd, setRangeEnd] = useComponentState(() => endOfDay(new Date()))
  const [showDatePicker, setShowDatePicker] = useComponentState(false)
  const [showFilters, setShowFilters] = useComponentState(false)
  const [chartVisible, setChartVisible] = useComponentState(true)
  const [sendDialogOpen, setSendDialogOpen] = useComponentState(false)
  const [scheduleDialogOpen, setScheduleDialogOpen] = useComponentState(false)
  const [groups, setGroups] = useComponentState<AmountsOwedDayGroup[]>([])
  const [loading, setLoading] = useComponentState(true)
  // A failed read used to be indistinguishable from an empty report:
  // getJson swallowed every error and the table said "No data in this range".
  const [error, setError] = useComponentState<string | null>(null)
  const [reloadKey, setReloadKey] = useComponentState(0)
  const [filterOptions, setFilterOptions] = useComponentState<ReportFilterOptions>({ members: [], projects: [] })
  const [selectedMemberIds, setSelectedMemberIds] = useComponentState<Set<string>>(() => new Set())
  const [selectedProjectIds, setSelectedProjectIds] = useComponentState<Set<string>>(() => new Set())
  const [visibleColumns, setVisibleColumns] = useComponentState<Set<AmountsOwedColumnKey>>(
    () => new Set(AMOUNTS_OWED_DEFAULT_VISIBLE_COLUMNS)
  )

  useEffect(() => {
    let cancelled = false
    // Filter options failing is not fatal - the panel just offers nothing to
    // filter by, which beats taking the whole report down.
    void fetchReportFilterOptions()
      .then((opts) => {
        if (!cancelled) setFilterOptions(opts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const dateLabel = useMemo(() => formatRangeLabel(rangeStart, rangeEnd), [rangeStart, rangeEnd])

  useEffect(() => {
    let cancelled = false
    const from = rangeStart.toISOString().slice(0, 10)
    const to = rangeEnd.toISOString().slice(0, 10)
    // scope "me" filters to the signed-in member server-side; without it in
    // the dep list (and in the request) the ME tab showed everyone.
    setLoading(true)
    setError(null)
    fetchAmountsOwedReport({ from, to, memberId: scope === "me" ? memberId ?? null : null,
      memberIds: [...selectedMemberIds],
      projectIds: [...selectedProjectIds],
    })
      .then((data) => {
        if (!cancelled) setGroups(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Request failed")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [rangeStart, rangeEnd, scope, memberId, selectedMemberIds, selectedProjectIds, reloadKey])

  function shiftRangeByDays(delta: number) {
    const s = new Date(rangeStart)
    s.setDate(s.getDate() + delta)
    const e = new Date(rangeEnd)
    e.setDate(e.getDate() + delta)
    setRangeStart(s)
    setRangeEnd(e)
  }

  function goToToday() {
    const now = new Date()
    setRangeStart(startOfDay(now))
    setRangeEnd(endOfDay(now))
  }

  const totalHoursSummary = useMemo(() => {
    const all = groups.flatMap((g) => g.members.map((m) => m.hours))
    return sumHoursStrings(all)
  }, [groups])

  const totalAmountSummary = useMemo(() => {
    const all = groups.flatMap((g) => g.members.map((m) => m.amount))
    return sumAmountStrings(all)
  }, [groups])

  return (
    <div className="relative isolate min-h-0">
      <div className="report-print-area relative mx-auto min-h-[min(80vh,56rem)] max-w-[1400px] space-y-6 px-6 py-6">
        <ReportPageHeading title="Amounts owed report" pageId="reports-amounts" />
        <div className="flex flex-col gap-4 border-b border-slate-200 dark:border-white/10 pb-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-4 lg:gap-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="relative flex items-center gap-0.5 rounded-full bg-slate-100 dark:bg-white/10 p-0.5"
              role="group"
              aria-label="Report scope"
            >
              {(["me", "all"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setScope(v)}
                  className="relative z-10 flex select-none items-center justify-center rounded-full px-5 py-1.5 text-sm font-medium transition-colors duration-200"
                >
                  {scope === v && (
                    <motion.div
                      layoutId="amounts-owed-scope-pill"
                      className="absolute inset-0 rounded-full bg-white shadow-sm dark:bg-white/20"
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-10",
                      scope === v ? "text-slate-900 dark:text-[#dce1fb]" : "text-slate-500 dark:text-white/45 hover:text-slate-700 dark:hover:text-[#dce1fb]"
                    )}
                  >
                    {v === "me" ? "Me" : "All"}
                  </span>
                </button>
              ))}
            </div>

            <div className="hidden h-6 w-px shrink-0 bg-slate-200 dark:bg-white/15 sm:block" aria-hidden />

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => shiftRangeByDays(-1)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] text-slate-600 dark:text-[#bccbb9] shadow-sm transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                aria-label="Previous day"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="relative z-50">
                <button
                  type="button"
                  onClick={() => setShowDatePicker((v) => !v)}
                  className={cn(
                    "flex min-w-[280px] items-center gap-2 rounded-lg border bg-white dark:bg-[#151b2d] px-4 py-2 text-sm text-slate-700 dark:text-[#dce1fb] transition-colors hover:bg-slate-50 dark:hover:bg-white/5",
                    showDatePicker ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200 dark:border-white/10"
                  )}
                >
                  <span className="truncate">{dateLabel}</span>
                  <Calendar className="h-4 w-4 shrink-0 text-blue-500" />
                </button>
                <AnimatePresence>
                  {showDatePicker && (
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
                  )}
                </AnimatePresence>
              </div>
              <button
                type="button"
                onClick={() => shiftRangeByDays(1)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] text-slate-600 dark:text-[#bccbb9] shadow-sm transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                aria-label="Next day"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={goToToday}
                className="rounded-lg px-3 py-2 text-sm font-medium text-blue-600 underline-offset-4 transition-colors hover:bg-blue-50 hover:underline"
              >
                Today
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <button
              type="button"
              onClick={() => setShowFilters(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-[#dce1fb] shadow-sm transition-colors hover:border-slate-300 dark:hover:border-white/20 hover:bg-slate-50 dark:hover:bg-white/5"
            >
              <SlidersHorizontal className="h-4 w-4 text-slate-500 dark:text-white/45" />
              Filters
            </button>

            <div className="flex flex-wrap items-stretch overflow-visible rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm">
              <button
                type="button"
                onClick={() => setSendDialogOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-[#bccbb9] transition-colors hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-[#dce1fb]"
              >
                <Send className="h-4 w-4 text-slate-500 dark:text-white/45" />
                <span className="hidden sm:inline">Send</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleDialogOpen(true)}
                className="flex items-center gap-1.5 border-l border-slate-200 dark:border-white/10 px-3 py-2 text-sm font-medium text-slate-600 dark:text-[#bccbb9] transition-colors hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-[#dce1fb]"
              >
                <Clock className="h-4 w-4 text-slate-500 dark:text-white/45" />
                <span className="hidden sm:inline">Schedule</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 border-l border-slate-200 dark:border-white/10 px-3 py-2 text-sm font-medium text-slate-600 dark:text-[#bccbb9] transition-colors hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-[#dce1fb] data-[state=open]:bg-slate-50"
                  >
                    <Download className="h-4 w-4 text-slate-500 dark:text-white/45" />
                    <span className="hidden sm:inline">Export</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-36">
                  <DropdownMenuItem className="cursor-pointer" onClick={() => downloadAmountsOwedCsv(groups)}>To CSV</DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer" onClick={() => downloadAmountsOwedPdf(groups, dateLabel)}>To PDF</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="flex items-center border-l border-slate-200 dark:border-white/10 px-1.5">
                <AmountsOwedTableColumnsMenu visible={visibleColumns} onVisibleChange={setVisibleColumns} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-stretch gap-4 rounded-xl border border-slate-100 dark:border-white/10 bg-white dark:bg-[#151b2d] p-6 shadow-sm">
          <div className="min-w-[120px] flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">Hours</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-emerald-600">{totalHoursSummary}</div>
          </div>
          <div className="min-w-[120px] flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">Amount</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-800 dark:text-[#dce1fb]">{totalAmountSummary}</div>
          </div>
          <button
            type="button"
            onClick={() => setChartVisible((v) => !v)}
            className="flex shrink-0 cursor-pointer items-center justify-center self-center rounded-lg bg-blue-500 px-3 py-4 transition-opacity hover:opacity-90"
            aria-expanded={chartVisible}
            aria-label={chartVisible ? "Hide chart" : "Show chart"}
          >
            <LineChart className="h-6 w-6 text-white" strokeWidth={2} />
          </button>
        </div>

        {chartVisible ? <AmountPerDayChart groups={groups} /> : null}

        {loading ? (
          <ReportTableSkeleton rows={6} columns={4} />
        ) : error ? (
          <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : (
        <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/10">
                  <th className="w-[36%] px-5 py-3 text-left text-sm font-semibold text-slate-700 dark:text-[#dce1fb]">Member</th>
                  {visibleColumns.has("rate") ? (
                    <th className="w-[22%] px-4 py-3 text-center text-sm font-semibold text-slate-700 dark:text-[#dce1fb]">Current rate</th>
                  ) : null}
                  {visibleColumns.has("hours") ? (
                    <th className="w-[20%] px-4 py-3 text-right text-sm font-semibold text-slate-700 dark:text-[#dce1fb]">Total hours</th>
                  ) : null}
                  {visibleColumns.has("amount") ? (
                    <th className="w-[22%] px-4 py-3 text-right text-sm font-semibold text-slate-700 dark:text-[#dce1fb]">Amount</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.date}>
                    <tr className="bg-slate-100 dark:bg-white/10">
                      <td colSpan={1 + visibleColumns.size} className="px-5 py-2 text-sm font-medium text-slate-800 dark:text-[#dce1fb]">
                        {group.dateLabel}
                      </td>
                    </tr>
                    {group.members.map((m) => (
                      <tr key={`${group.date}-${m.name}`} className="border-b border-slate-100 bg-white transition-colors hover:bg-slate-50/80 dark:border-white/10 dark:bg-[#151b2d] dark:hover:bg-white/5">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <ReportMemberAvatar initials={m.initials} />
                            <span className="text-sm text-slate-800 dark:text-[#dce1fb]">{m.name}</span>
                          </div>
                        </td>
                        {visibleColumns.has("rate") ? (
                          <td className="px-4 py-3 text-center text-sm text-slate-500 dark:text-white/45">{m.rateLabel}</td>
                        ) : null}
                        {visibleColumns.has("hours") ? (
                          <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-800 dark:text-[#dce1fb]">{m.hours}</td>
                        ) : null}
                        {visibleColumns.has("amount") ? (
                          <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-800 dark:text-[#dce1fb]">{m.amount}</td>
                        ) : null}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] font-semibold">
                      <td className="px-5 py-3 text-sm text-slate-900 dark:text-[#dce1fb]">Total</td>
                      {visibleColumns.has("rate") ? <td className="px-4 py-3" /> : null}
                      {visibleColumns.has("hours") ? (
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-900 dark:text-[#dce1fb]">
                          {sumHoursStrings(group.members.map((x) => x.hours))}
                        </td>
                      ) : null}
                      {visibleColumns.has("amount") ? (
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-900 dark:text-[#dce1fb]">
                          {sumAmountStrings(group.members.map((x) => x.amount))}
                        </td>
                      ) : null}
                    </tr>
                  </Fragment>
                ))}
                {groups.length === 0 ? (
                  <tr>
                    <td colSpan={1 + visibleColumns.size} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-white/45">
                      No tracked time in this date range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        )}

        <ReportSendDialog open={sendDialogOpen} onOpenChange={setSendDialogOpen} />
        <ReportScheduleDialog
          open={scheduleDialogOpen}
          onOpenChange={setScheduleDialogOpen}
          onRequestOpenFilters={() => setShowFilters(true)}
        />

        <AnimatePresence>
          {showFilters && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-100 rounded-xl bg-transparent"
                onClick={() => setShowFilters(false)}
                aria-hidden
              />
              <AmountsOwedFiltersPanel
                className="absolute right-4 top-28 z-110 max-h-[calc(100%-9rem)]"
                onClose={() => setShowFilters(false)}
                onScheduleReport={() => setScheduleDialogOpen(true)}
                options={filterOptions}
                selectedMemberIds={selectedMemberIds}
                onSelectedMemberIdsChange={setSelectedMemberIds}
                selectedProjectIds={selectedProjectIds}
                onSelectedProjectIdsChange={setSelectedProjectIds}
              />
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

