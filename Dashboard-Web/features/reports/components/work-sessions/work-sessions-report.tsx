/* eslint-disable react-doctor/use-lazy-motion */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { Fragment } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  LayoutList,
  LineChart,
  Menu,
  Send,
  Settings2,
  X,
} from "lucide-react"
import { useWorkSessionsReport } from "@/features/reports/hooks/use-work-sessions-report"
import {
  WORK_SESSIONS_ORG_LABEL,
  WORK_SESSIONS_TIMEZONE_LABEL,
} from "@/features/reports/components/shared/constants"
import {
  formatWorkSessionDuration,
  type WorkSessionDailyActivityPoint,
} from "@/features/reports/utils/work-sessions"
import { cn } from "@/shared/utils/utils"
import type { WorkSessionColumnKey } from "@/features/reports/models/work-sessions"
import { ReportDateRangePicker } from "@/features/reports/components/time-activity-report/date-range-picker"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { ReportSimpleDropdown } from "@/features/reports/components/time-activity-report/simple-dropdown"
import { Button } from "@/shared/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover"
import { ReportScheduleDialog } from "@/features/reports/components/amounts-owed/report-schedule-dialog"
import { ReportSendDialog } from "@/features/reports/components/amounts-owed/report-send-dialog"
import { WorkSessionsFiltersPanel } from "@/features/reports/components/work-sessions/work-sessions-filters-panel"
import {
  ReportErrorState,
  ReportOrgLine,
  ReportPageHeading,
  ReportTableSkeleton,
} from "@/features/reports/components/shared/report-ui"

const COLUMN_META: { key: WorkSessionColumnKey; label: string }[] = [
  { key: "client", label: "Client" },
  { key: "project", label: "Project" },
  { key: "member", label: "Member" },
  { key: "todo", label: "To-do / Job" },
  { key: "manual", label: "Manual" },
  { key: "started", label: "Started" },
  { key: "stopped", label: "Stopped" },
  { key: "duration", label: "Duration" },
  { key: "activity", label: "Activity" },
]
const yTicks: number[] = [0, 25, 50, 75, 100]

function WorkSessionsActivityChart({ series }: { series: WorkSessionDailyActivityPoint[] }) {
  const Y_MAX = 100
  const W = 560
  const H = 220
  const leftPad = 44
  const rightPad = 12
  const topPad = 10
  const bottomPad = 48
  const plotW = W - leftPad - rightPad
  const plotH = H - topPad - bottomPad
  const n = series.length
  const xAt = (i: number): number =>
    leftPad + (n <= 1 ? plotW / 2 : (i / Math.max(1, n - 1)) * plotW)
  const yAt = (v: number): number => topPad + plotH - (v / Y_MAX) * plotH
  const points = series.map((pt, i) => `${xAt(i)},${yAt(pt.avgActivity)}`).join(" ")
  const labelStep = n <= 14 ? 1 : Math.ceil(n / 14)

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm">
      <div className="border-b border-slate-50 dark:border-white/10 px-6 py-3">
        <h3 className="text-base font-semibold text-slate-800 dark:text-[#dce1fb]">Average activity by day</h3>
      </div>
      <div className="px-6 pb-4 pt-2">
        <svg
          className="h-auto w-full max-w-3xl"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Average activity percentage by calendar day"
        >
          {yTicks.map((tick) => (
            <line
              key={tick}
              x1={leftPad}
              y1={yAt(tick)}
              x2={leftPad + plotW}
              y2={yAt(tick)}
              stroke="#f1f5f9"
              strokeWidth={1}
            />
          ))}
          <text x={4} y={yAt(100) + 4} className="fill-slate-400 dark:fill-white/40 text-[10px]">
            100%
          </text>
          <text x={4} y={yAt(75) + 4} className="fill-slate-400 dark:fill-white/40 text-[10px]">
            75%
          </text>
          <text x={4} y={yAt(50) + 4} className="fill-slate-400 dark:fill-white/40 text-[10px]">
            50%
          </text>
          <text x={4} y={yAt(25) + 4} className="fill-slate-400 dark:fill-white/40 text-[10px]">
            25%
          </text>
          <text x={4} y={yAt(0) + 4} className="fill-slate-400 dark:fill-white/40 text-[10px]">
            0%
          </text>
          <line
            x1={leftPad}
            y1={topPad + plotH}
            x2={leftPad + plotW}
            y2={topPad + plotH}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          <polyline
            fill="none"
            stroke="rgb(37 99 235)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={points}
          />
          {series.map((pt, i) => {
            const cx = xAt(i)
            const cy = yAt(pt.avgActivity)
            if (pt.hasData) {
              return (
                <circle
                  key={pt.iso}
                  cx={cx}
                  cy={cy}
                  r={3.5}
                  fill="white"
                  stroke="rgb(37 99 235)"
                  strokeWidth={2}
                />
              )
            }
            return (
              <circle
                key={pt.iso}
                cx={cx}
                cy={cy}
                r={2.5}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth={1.5}
              />
            )
          })}
          {series.map((pt, i) => {
            if (i % labelStep !== 0 && i !== n - 1) return null
            return (
              <text
                key={`x-${pt.iso}`}
                x={xAt(i)}
                y={H - 12}
                textAnchor="middle"
                className="fill-slate-500 dark:fill-white/45 text-[9px]"
              >
                {pt.xShort}
              </text>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

export function WorkSessionsReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const {
    scope,
    setScope,
    rangeStart,
    rangeEnd,
    setRangeStart,
    setRangeEnd,
    dateLabel,
    showDatePicker,
    setShowDatePicker,
    showFilters,
    setShowFilters,
    groupBy,
    setGroupBy,
    groupByOptions,
    showActivityChart,
    setShowActivityChart,
    tableCollapsed,
    setTableCollapsed,
    collapsedGroups,
    toggleGroupCollapsed,
    projectOptions,
    memberOptions,
    projectFilter,
    memberFilter,
    toggleProject,
    toggleMember,
    selectAllProjects,
    selectAllMembers,
    clearProjects,
    clearMembers,
    sendOpen,
    setSendOpen,
    scheduleOpen,
    setScheduleOpen,
    columnVisibility,
    toggleColumn,
    activityChartSeries,
    filteredRows,
    grouped,
    totals,
    shiftRangeByDays,
    goToToday,
    downloadCsv,
    downloadPdf,
    loading,
    error,
    retry,
  } = useWorkSessionsReport()

  const visibleCols = COLUMN_META.filter((c) => columnVisibility[c.key])
  const colCount = visibleCols.length

  return (
    <div className="relative isolate min-h-0">
      <div className="report-print-area relative mx-auto min-h-[min(80vh,56rem)] max-w-[1400px] space-y-6 px-6 py-6">

        <ReportPageHeading title="Work sessions report" pageId="reports-work-sessions" />

        <div className="flex flex-col gap-4 border-b border-slate-200 dark:border-white/10 pb-4 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:gap-x-4">
          <div className="flex flex-wrap items-end gap-6">
            <div className="flex gap-10">
              {(["me", "all"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setScope(v)}
                  className={cn(
                    "-mb-px border-b-2 pb-2 text-sm font-semibold transition-colors",
                    scope === v ? "border-blue-500 text-blue-600" : "border-transparent text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-[#bccbb9]"
                  )}
                >
                  {v === "me" ? "ME" : "ALL"}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => shiftRangeByDays(-1)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] text-slate-600 dark:text-[#bccbb9] shadow-sm hover:bg-slate-50 dark:hover:bg-white/5"
                aria-label="Previous period"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="relative z-50">
                <button
                  type="button"
                  onClick={() => setShowDatePicker((x) => !x)}
                  className={cn(
                    "flex min-w-[260px] items-center gap-2 rounded-lg border bg-white dark:bg-[#151b2d] px-4 py-2 text-sm text-slate-700 dark:text-[#dce1fb] hover:bg-slate-50 dark:hover:bg-white/5",
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
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] text-slate-600 dark:text-[#bccbb9] shadow-sm hover:bg-slate-50 dark:hover:bg-white/5"
                aria-label="Next period"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={goToToday}
                className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] px-4 py-2 text-sm font-medium text-slate-600 dark:text-[#bccbb9] hover:bg-slate-50 dark:hover:bg-white/5"
              >
                Today
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowFilters(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600"
          >
            Filters
            <ChevronDown className="h-4 w-4 opacity-90" />
          </button>
        </div>

        <div className="flex flex-wrap items-stretch gap-0 rounded-xl border border-slate-100 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm">
          <div className="flex min-w-[100px] flex-1 flex-col justify-center border-r border-slate-100 dark:border-white/10 px-6 py-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">Time</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 sm:text-3xl">
              {formatWorkSessionDuration(totals.timeSec)}
            </div>
          </div>
          <div className="flex min-w-[100px] flex-1 flex-col justify-center border-r border-slate-100 dark:border-white/10 px-6 py-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">Break time</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-800 dark:text-[#dce1fb] sm:text-3xl">
              {totals.breakSec > 0 ? formatWorkSessionDuration(totals.breakSec) : "—"}
            </div>
          </div>
          <div className="flex min-w-[100px] flex-1 flex-col justify-center px-6 py-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">Avg. activity</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 sm:text-3xl">{totals.avgActivity}%</div>
          </div>
          <div className="flex items-center border-l border-slate-100 dark:border-white/10 px-3">
            <button
              type="button"
              onClick={() => setShowActivityChart((v) => !v)}
              className={cn(
                "flex h-full min-h-20 cursor-pointer items-center justify-center rounded-lg px-3 transition-opacity hover:opacity-90",
                showActivityChart ? "bg-blue-500" : "bg-slate-200 dark:bg-white/15"
              )}
              aria-expanded={showActivityChart}
              aria-label={showActivityChart ? "Hide activity chart" : "Show activity chart"}
            >
              <LineChart className={cn("h-6 w-6", showActivityChart ? "text-white" : "text-slate-600 dark:text-[#bccbb9]")} strokeWidth={2} />
            </button>
          </div>
        </div>

        {showActivityChart && activityChartSeries.length > 0 ? (
          <WorkSessionsActivityChart series={activityChartSeries} />
        ) : null}

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <ReportOrgLine org={WORK_SESSIONS_ORG_LABEL} timezone={WORK_SESSIONS_TIMEZONE_LABEL} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Menu className="h-4 w-4 text-slate-500 dark:text-white/45" />
                <span className="text-sm text-slate-500 dark:text-white/45">Group by:</span>
                <ReportSimpleDropdown
                  value={groupBy}
                  onChange={(v) => setGroupBy(v as typeof groupBy)}
                  options={groupByOptions}
                  width="w-40"
                  accentBar={false}
                />
              </div>
              <div className="flex flex-wrap items-center gap-1 border-l border-slate-200 dark:border-white/10 pl-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-slate-600 dark:text-[#bccbb9]"
                  onClick={() => setTableCollapsed((v) => !v)}
                >
                  <X className="h-4 w-4" />
                  {tableCollapsed ? "Expand" : "Collapse"}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="gap-1 text-slate-600 dark:text-[#bccbb9]" onClick={() => setSendOpen(true)}>
                  <Send className="h-4 w-4" />
                  Send
                </Button>
                <Button type="button" variant="ghost" size="sm" className="gap-1 text-slate-600 dark:text-[#bccbb9]" onClick={() => setScheduleOpen(true)}>
                  <Clock className="h-4 w-4" />
                  Schedule
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="gap-1 text-slate-600 dark:text-[#bccbb9]">
                      <Download className="h-4 w-4" />
                      Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={downloadCsv}>To CSV</DropdownMenuItem>
                    <DropdownMenuItem onClick={downloadPdf}>To PDF</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" className="text-slate-500 dark:text-white/45" aria-label="Table settings">
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-3" align="end">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Columns</div>
                    <div className="space-y-1">
                      {COLUMN_META.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => toggleColumn(c.key)}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-white/5"
                        >
                          {c.label}
                          <span className={cn("text-xs", columnVisibility[c.key] ? "text-blue-600" : "text-slate-300 dark:text-white/25")}>
                            {columnVisibility[c.key] ? "On" : "Off"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          {loading ? (
            <ReportTableSkeleton rows={8} columns={6} />
          ) : error ? (
            <ReportErrorState message={error} onRetry={retry} />
          ) : (
          <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm">
            <div className={cn("overflow-x-auto", tableCollapsed && "hidden")}>
              <table className="w-full min-w-[900px] table-fixed">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-white/10">
                    {visibleCols.map((c) => (
                      <th
                        key={c.key}
                        className={cn(
                          "px-4 py-3 text-sm font-semibold text-slate-700 dark:text-[#dce1fb]",
                          c.key === "duration" || c.key === "activity" ? "text-right" : "text-left",
                          c.key === "manual" && "text-center",
                          c.key === "client" && "w-[12%]",
                          c.key === "project" && "w-[14%]",
                          c.key === "member" && "w-[14%]",
                          c.key === "todo" && "w-[14%]",
                          c.key === "manual" && "w-[8%]",
                          c.key === "started" && "w-[10%]",
                          c.key === "stopped" && "w-[10%]",
                          c.key === "duration" && "w-[10%]",
                          c.key === "activity" && "w-[8%]"
                        )}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((g) => (
                    <Fragment key={g.key}>
                      <tr className="bg-slate-100 dark:bg-white/10">
                        <td colSpan={colCount} className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => toggleGroupCollapsed(g.key)}
                            className="flex w-full items-center gap-2 text-left text-sm font-medium text-slate-800 dark:text-[#dce1fb]"
                          >
                            <LayoutList className="h-4 w-4 shrink-0 text-slate-500 dark:text-white/45" />
                            <span>{g.label}</span>
                            <ChevronDown
                              className={cn(
                                "ml-auto h-4 w-4 text-slate-400 dark:text-white/40 transition-transform",
                                collapsedGroups.has(g.key) && "-rotate-90"
                              )}
                            />
                          </button>
                        </td>
                      </tr>
                      {!collapsedGroups.has(g.key)
                        ? g.rows.map((r) => (
                            <tr key={r.id} className="border-b border-slate-100 bg-white transition-colors hover:bg-slate-50/80 dark:border-white/10 dark:bg-[#151b2d] dark:hover:bg-white/5">
                              {columnVisibility.client ? (
                                <td className="px-4 py-3 text-sm text-slate-800 dark:text-[#dce1fb]">{r.client}</td>
                              ) : null}
                              {columnVisibility.project ? (
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                      style={{ backgroundColor: r.projectColor }}
                                    >
                                      {r.projectLetter}
                                    </div>
                                    <span className="text-sm text-slate-800 dark:text-[#dce1fb]">{r.projectName}</span>
                                  </div>
                                </td>
                              ) : null}
                              {columnVisibility.member ? (
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <ReportMemberAvatar initials={r.memberInitials} />
                                    <span className="text-sm text-slate-800 dark:text-[#dce1fb]">{r.memberName}</span>
                                  </div>
                                </td>
                              ) : null}
                              {columnVisibility.todo ? (
                                <td className="px-4 py-3 text-sm text-slate-600 dark:text-[#bccbb9]">{r.todoJob}</td>
                              ) : null}
                              {columnVisibility.manual ? (
                                <td className="px-4 py-3 text-center text-sm tabular-nums text-slate-700 dark:text-[#dce1fb]">{r.manualPct}%</td>
                              ) : null}
                              {columnVisibility.started ? (
                                <td className="px-4 py-3 text-sm text-slate-600 dark:text-[#bccbb9]">{r.startedLabel}</td>
                              ) : null}
                              {columnVisibility.stopped ? (
                                <td className="px-4 py-3 text-sm text-slate-600 dark:text-[#bccbb9]">{r.stoppedLabel}</td>
                              ) : null}
                              {columnVisibility.duration ? (
                                <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-800 dark:text-[#dce1fb]">{r.durationHms}</td>
                              ) : null}
                              {columnVisibility.activity ? (
                                <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-800 dark:text-[#dce1fb]">{r.activityPct}%</td>
                              ) : null}
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  ))}
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={colCount} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-white/45">
                        No work sessions match the current filters or date range.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {tableCollapsed ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-white/45">Table collapsed. Use Expand to show sessions.</div>
            ) : null}
          </div>
          )}
        </div>

        <ReportSendDialog open={sendOpen} onOpenChange={setSendOpen} />
        <ReportScheduleDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
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
              <WorkSessionsFiltersPanel
                className="absolute right-4 top-48 z-110 max-h-[calc(100%-12rem)]"
                onClose={() => setShowFilters(false)}
                projectOptions={projectOptions}
                memberOptions={memberOptions}
                projectFilter={projectFilter}
                memberFilter={memberFilter}
                onToggleProject={toggleProject}
                onToggleMember={toggleMember}
                onClearProjects={clearProjects}
                onClearMembers={clearMembers}
                onSelectAllProjects={selectAllProjects}
                onSelectAllMembers={selectAllMembers}
              />
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

