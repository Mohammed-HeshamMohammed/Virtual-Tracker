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
      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="border-b border-slate-50 px-6 py-3">
          <h3 className="text-base font-semibold text-slate-800">Total amount per day</h3>
        </div>
        <div className="px-6 py-10 text-center text-sm text-slate-500">No data in this range</div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="border-b border-slate-50 px-6 py-3">
        <h3 className="text-base font-semibold text-slate-800">Total amount per day</h3>
      </div>
      <div className="px-6 pb-6 pt-2">
        <div className="w-full" style={{ height: CHART_H }}>
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
  const [filterOptions, setFilterOptions] = useComponentState<ReportFilterOptions>({ members: [], projects: [] })
  const [selectedMemberIds, setSelectedMemberIds] = useComponentState<Set<string>>(() => new Set())
  const [selectedProjectIds, setSelectedProjectIds] = useComponentState<Set<string>>(() => new Set())
  const [visibleColumns, setVisibleColumns] = useComponentState<Set<AmountsOwedColumnKey>>(
    () => new Set(AMOUNTS_OWED_DEFAULT_VISIBLE_COLUMNS)
  )

  useEffect(() => {
    let cancelled = false
    void fetchReportFilterOptions().then((opts) => {
      if (!cancelled) setFilterOptions(opts)
    })
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
    fetchAmountsOwedReport({ from, to, memberId: scope === "me" ? memberId ?? null : null,
      memberIds: [...selectedMemberIds],
      projectIds: [...selectedProjectIds],
    }).then((data) => {
      if (!cancelled) setGroups(data)
    })
    return () => {
      cancelled = true
    }
  }, [rangeStart, rangeEnd, scope, memberId, selectedMemberIds, selectedProjectIds])

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
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-4 lg:gap-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="relative flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5"
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
                      className="absolute inset-0 rounded-full bg-white shadow-sm"
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-10",
                      scope === v ? "text-slate-900" : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    {v === "me" ? "Me" : "All"}
                  </span>
                </button>
              ))}
            </div>

            <div className="hidden h-6 w-px shrink-0 bg-slate-200 sm:block" aria-hidden />

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => shiftRangeByDays(-1)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                aria-label="Previous day"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="relative z-50">
                <button
                  type="button"
                  onClick={() => setShowDatePicker((v) => !v)}
                  className={cn(
                    "flex min-w-[280px] items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50",
                    showDatePicker ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200"
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
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
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
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <SlidersHorizontal className="h-4 w-4 text-slate-500" />
              Filters
            </button>

            <div className="flex flex-wrap items-stretch overflow-visible rounded-lg border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setSendDialogOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                <Send className="h-4 w-4 text-slate-500" />
                <span className="hidden sm:inline">Send</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleDialogOpen(true)}
                className="flex items-center gap-1.5 border-l border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                <Clock className="h-4 w-4 text-slate-500" />
                <span className="hidden sm:inline">Schedule</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 border-l border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 data-[state=open]:bg-slate-50"
                  >
                    <Download className="h-4 w-4 text-slate-500" />
                    <span className="hidden sm:inline">Export</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-36">
                  <DropdownMenuItem className="cursor-pointer" onClick={() => downloadAmountsOwedCsv(groups)}>To CSV</DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer" onClick={() => window.print()}>To PDF</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="flex items-center border-l border-slate-200 px-1.5">
                <AmountsOwedTableColumnsMenu visible={visibleColumns} onVisibleChange={setVisibleColumns} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-stretch gap-4 rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="min-w-[120px] flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Hours</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-emerald-600">{totalHoursSummary}</div>
          </div>
          <div className="min-w-[120px] flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Amount</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-800">{totalAmountSummary}</div>
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

        <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="w-[36%] px-5 py-3 text-left text-sm font-semibold text-slate-700">Member</th>
                  {visibleColumns.has("rate") ? (
                    <th className="w-[22%] px-4 py-3 text-center text-sm font-semibold text-slate-700">Current rate</th>
                  ) : null}
                  {visibleColumns.has("hours") ? (
                    <th className="w-[20%] px-4 py-3 text-right text-sm font-semibold text-slate-700">Total hours</th>
                  ) : null}
                  {visibleColumns.has("amount") ? (
                    <th className="w-[22%] px-4 py-3 text-right text-sm font-semibold text-slate-700">Amount</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.date}>
                    <tr className="bg-slate-100">
                      <td colSpan={1 + visibleColumns.size} className="px-5 py-2 text-sm font-medium text-slate-800">
                        {group.dateLabel}
                      </td>
                    </tr>
                    {group.members.map((m) => (
                      <tr key={`${group.date}-${m.name}`} className="border-b border-slate-100 bg-white">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <ReportMemberAvatar initials={m.initials} />
                            <span className="text-sm text-slate-800">{m.name}</span>
                          </div>
                        </td>
                        {visibleColumns.has("rate") ? (
                          <td className="px-4 py-3 text-center text-sm text-slate-500">{m.rateLabel}</td>
                        ) : null}
                        {visibleColumns.has("hours") ? (
                          <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-800">{m.hours}</td>
                        ) : null}
                        {visibleColumns.has("amount") ? (
                          <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-800">{m.amount}</td>
                        ) : null}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 bg-white font-semibold">
                      <td className="px-5 py-3 text-sm text-slate-900">Total</td>
                      {visibleColumns.has("rate") ? <td className="px-4 py-3" /> : null}
                      {visibleColumns.has("hours") ? (
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-900">
                          {sumHoursStrings(group.members.map((x) => x.hours))}
                        </td>
                      ) : null}
                      {visibleColumns.has("amount") ? (
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-900">
                          {sumAmountStrings(group.members.map((x) => x.amount))}
                        </td>
                      ) : null}
                    </tr>
                  </Fragment>
                ))}
                {groups.length === 0 ? (
                  <tr>
                    <td colSpan={1 + visibleColumns.size} className="px-4 py-12 text-center text-sm text-slate-500">
                      No tracked time in this date range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

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

