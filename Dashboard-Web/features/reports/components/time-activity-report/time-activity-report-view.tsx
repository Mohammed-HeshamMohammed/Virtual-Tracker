"use client"

import { Fragment, useState as useComponentState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Filter,
  Loader2,
  Play,
  Plus,
  Save,
  Table2,
  Trash2,
  TrendingUp,
} from "lucide-react"
import { useTimeAndActivityReport } from "@/features/reports/hooks/use-time-and-activity-report"
import { cn } from "@/shared/utils/utils"
import { useAuth } from "@/shared/providers/app"
import { isManagementRole } from "@/features/auth"
import { changedEvent } from "@/infrastructure/api/change-events"
import { AddManualEntryDialog } from "@/features/reports/components/time-activity-report/add-manual-entry-dialog"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu"
import { downloadTimeActivityCsv } from "@/features/reports/utils/time-and-activity/csv-export"
import { ReportSendDialog } from "@/features/reports/components/amounts-owed/report-send-dialog"
import { ReportScheduleDialog } from "@/features/reports/components/amounts-owed/report-schedule-dialog"
import {
  deleteTimeAndActivityDay,
  sendTimeAndActivityReport,
  scheduleTimeAndActivityReport,
} from "@/features/reports/api/time-and-activity-api"
import type { TimeActivityGroupBy, TimeActivityReportViewProps } from "@/features/reports/models/time-and-activity"
import { ReportColumnPicker } from "@/features/reports/components/time-activity-report/column-picker"
import { ReportDateRangePicker } from "@/features/reports/components/time-activity-report/date-range-picker"
import { ReportFiltersPanel } from "@/features/reports/components/time-activity-report/filters-panel"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { ReportMemberMetricCell } from "@/features/reports/components/time-activity-report/member-metric-cell"
import { ReportPeriodMetricCell } from "@/features/reports/components/time-activity-report/period-metric-cell"
import { ReportTimeActivityChart } from "@/features/reports/components/time-activity-report/report-chart"
import { ReportSortableTh } from "@/features/reports/components/time-activity-report/sortable-th"
import { ReportSimpleDropdown } from "@/features/reports/components/time-activity-report/simple-dropdown"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  STANDARD_REPORT_ORG_LABEL,
  STANDARD_REPORT_TIMEZONE_LABEL,
  TIME_ACTIVITY_TABLE_COL_AUTO_HIDE_PRIORITY,
  TIME_ACTIVITY_TABLE_COL_MIN_WIDTH,
  TIME_ACTIVITY_TABLE_FIXED_WIDTH,
} from "@/features/reports/components/shared/constants"
import { useReportColumnAutoHide } from "@/features/reports/hooks/use-report-column-auto-hide"
import { formatDecimalHoursClock } from "@/features/reports/utils/time-and-activity"

function parseDayParam(day: string): Date {
  return new Date(`${day}T00:00:00`)
}

export function TimeActivityReportView({ days, memberRows, entries, onRangeApply, range, onReload }: TimeActivityReportViewProps) {
  const { memberRole } = useAuth()
  const canAddForOthers = isManagementRole(memberRole)
  const [addEntryOpen, setAddEntryOpen] = useComponentState(false)
  const [sendOpen, setSendOpen] = useComponentState(false)
  const [scheduleOpen, setScheduleOpen] = useComponentState(false)
  const [deletingKey, setDeletingKey] = useComponentState<string | null>(null)
  const [deleteError, setDeleteError] = useComponentState<string | null>(null)
  const {
    chartMetrics,
    toggleChartMetric,
    groupBy,
    setGroupBy,
    groupByOptions,
    memberFilter,
    setMemberFilter,
    memberFilterOptions,
    projectFilter,
    setProjectFilter,
    projectFilterOptions,
    trackedTimeFilter,
    setTrackedTimeFilter,
    clearFilters,
    expandedRows,
    toggleRow,
    showColumnPicker,
    setShowColumnPicker,
    showFilters,
    setShowFilters,
    showDatePicker,
    setShowDatePicker,
    filterPortalMounted,
    reportColumnRef,
    filterScrimRef,
    filterPanelLayout,
    dateLabel,
    setDateLabel,
    enabledPeriodCols,
    enabledMemberCols,
    columnPickerScope,
    setColumnPickerScope,
    sortKey,
    sortDir,
    sortedDisplayRows,
    tableDisplayRows,
    totals,
    visibleMetricColumns,
    toggleCol,
    handleSortClick,
    pickerEnabledCols,
    getSubRowsForDay,
    groupColumnLabel,
    saveView,
    justSaved,
  } = useTimeAndActivityReport({ days, memberRows, entries, range })

  const canDeleteDay = canAddForOthers && groupBy === "date_per_day"

  const { containerRef: tableWidthRef, visibleColumns: fittedMetricColumns } = useReportColumnAutoHide(
    visibleMetricColumns,
    {
      minWidths: TIME_ACTIVITY_TABLE_COL_MIN_WIDTH,
      hidePriority: TIME_ACTIVITY_TABLE_COL_AUTO_HIDE_PRIORITY,
      fixedWidth: TIME_ACTIVITY_TABLE_FIXED_WIDTH + (canDeleteDay ? 72 : 0),
    },
  )

  function confirmDeleteDay(memberId: string, date: string, memberName: string, dateLabel: string) {
    const ok = window.confirm(
      `Delete ${memberName}'s tracked activity for ${dateLabel}? ` +
        `This also permanently deletes their screenshots, app usage, and URL visits for that day. This cannot be undone.`,
    )
    if (!ok) return
    const key = `${memberId}::${date}`
    setDeleteError(null)
    setDeletingKey(key)
    deleteTimeAndActivityDay(memberId, date)
      .then(() => {
        onReload?.()
        window.dispatchEvent(new Event(changedEvent("activity")))
      })
      .catch((err) => {
        setDeleteError(err instanceof Error ? err.message : "Could not delete this day's activity.")
      })
      .finally(() => setDeletingKey(null))
  }

  function downloadPdf() {
    const byMemberHours = new Map<string, number>()
    for (const day of sortedDisplayRows) {
      for (const member of getSubRowsForDay(day.date)) {
        byMemberHours.set(member.name, (byMemberHours.get(member.name) ?? 0) + member.trackedHours)
      }
    }
    downloadReportPdf({
      title: "Time & Activity Report",
      subtitle: "Time worked, activity levels, and amounts earned per project or to-do.",
      orgLabel: STANDARD_REPORT_ORG_LABEL,
      timezoneLabel: STANDARD_REPORT_TIMEZONE_LABEL,
      rangeLabel: dateLabel,
      summary: [
        { label: "Total time", value: totals.time },
        { label: "Average activity", value: `${totals.activity}%` },
        { label: "Total spent", value: totals.spent },
      ],
      charts: [
        ...(sortedDisplayRows.length > 0
          ? [
              {
                type: "line" as const,
                title: "Tracked hours by day",
                points: sortedDisplayRows.map((d) => ({ label: d.dateLabel, value: Math.round(d.trackedHours * 100) / 100 })),
                valueFormatter: formatDecimalHoursClock,
              },
            ]
          : []),
        ...(byMemberHours.size > 0
          ? [
              {
                type: "bar" as const,
                title: "Tracked hours by member",
                data: [...byMemberHours.entries()]
                  .sort(([, a], [, b]) => b - a)
                  .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 })),
                valueFormatter: formatDecimalHoursClock,
              },
            ]
          : []),
      ],
      table: {
        columns: [
          { header: groupColumnLabel, key: "date" },
          { header: "Members", key: "members", align: "right" },
          { header: "Total hours", key: "totalHours", align: "right" },
          { header: "Activity %", key: "activity", align: "right" },
          { header: "Idle %", key: "idlePct", align: "right" },
          { header: "Idle hours", key: "idleHr", align: "right" },
          { header: "Total spent", key: "totalSpent", align: "right" },
        ],
        rows: tableDisplayRows.map((d) => ({
          date: d.dateLabel,
          members: d.memberCount,
          totalHours: d.totalHours,
          activity: `${d.activityPct}%`,
          idlePct: d.idlePct,
          idleHr: d.idleHr,
          totalSpent: d.totalSpent,
        })),
        emptyMessage: "No data for this range.",
      },
      filename: "time-and-activity",
    })
  }

  const statCards = [
    { icon: <Clock className="h-5 w-5 text-blue-500 dark:text-blue-400" />, label: "Total time", value: totals.time },
    { icon: <TrendingUp className="h-5 w-5 text-blue-500 dark:text-blue-400" />, label: "Average activity", value: `${totals.activity}%` },
    { icon: <CreditCard className="h-5 w-5 text-blue-500 dark:text-blue-400" />, label: "Total spent", value: totals.spent },
  ]

  return (
    <div className="relative isolate">
      <div ref={reportColumnRef} className="report-print-area relative mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        <div className="relative z-50 flex flex-wrap items-end gap-3 gap-y-3">
          <div className="flex min-w-40 flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Members</div>
            <ReportSimpleDropdown
              value={memberFilter}
              onChange={setMemberFilter}
              options={memberFilterOptions}
              width="w-48"
              accentBar={false}
            />
          </div>

          <div className="flex min-w-40 flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Projects</div>
            <ReportSimpleDropdown
              value={projectFilter}
              onChange={setProjectFilter}
              options={projectFilterOptions}
              width="w-48"
              accentBar={false}
            />
          </div>

          <div className="relative flex flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Date range</div>
            <button
              type="button"
              onClick={() => setShowDatePicker((v) => !v)}
              className={cn(
                "flex items-center gap-2 rounded-lg border bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800",
                showDatePicker ? "border-blue-400 dark:border-blue-500 ring-1 ring-blue-400 dark:ring-blue-500" : "border-slate-200 dark:border-slate-700"
              )}
            >
              {dateLabel}
              <Calendar className="h-4 w-4 text-blue-500 dark:text-blue-400" />
            </button>
            <AnimatePresence>
              {showDatePicker && (
                <ReportDateRangePicker
                  key="date-range"
                  initialStart={range ? parseDayParam(range.from) : undefined}
                  initialEnd={range ? parseDayParam(range.to) : undefined}
                  onApply={(lbl) => {
                    setDateLabel(lbl)
                    setShowDatePicker(false)
                  }}
                  onApplyRange={onRangeApply}
                  onDismiss={() => setShowDatePicker(false)}
                />
              )}
            </AnimatePresence>
          </div>

          <div className="flex flex-col gap-1 pb-2">
            <div className="select-none text-[10px] font-semibold uppercase tracking-wider text-transparent">.</div>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">MDT</span>
          </div>

          <div className="flex min-w-40 flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data grouped by</div>
            <ReportSimpleDropdown
              value={groupBy}
              onChange={(v) => setGroupBy(v as TimeActivityGroupBy)}
              options={groupByOptions}
              width="w-44"
              accentBar={false}
            />
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2 pb-0.5">
            {canAddForOthers ? (
              <IconTooltip text="Add time for someone who forgot to track it" placement="bottom">
                <button
                  type="button"
                  aria-label="Add time for someone"
                  onClick={() => setAddEntryOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-blue-500 dark:text-blue-400 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/60"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </IconTooltip>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Export"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-blue-500 dark:text-blue-400 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/60"
                >
                  <Download className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => downloadTimeActivityCsv(tableDisplayRows, "time-and-activity", groupColumnLabel)}>
                  To CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadPdf}>To PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconTooltip text="Send" placement="bottom">
              <button
                type="button"
                aria-label="Send"
                onClick={() => setSendOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-blue-500 dark:text-blue-400 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/60"
              >
                <Play className="h-4 w-4" />
              </button>
            </IconTooltip>
            <IconTooltip text="Schedule" placement="bottom">
              <button
                type="button"
                aria-label="Schedule"
                onClick={() => setScheduleOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-blue-500 dark:text-blue-400 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/60"
              >
                <Clock className="h-4 w-4" />
              </button>
            </IconTooltip>
            <button
              type="button"
              onClick={() => setShowFilters(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-blue-500 dark:text-blue-400 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/60"
            >
              <Filter className="h-3.5 w-3.5" />
              Filter
            </button>
            <button
              type="button"
              onClick={saveView}
              className="flex items-center gap-1.5 rounded-lg bg-blue-500 dark:bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 dark:hover:bg-blue-700"
            >
              <Save className="h-3.5 w-3.5" />
              {justSaved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700" />

        <div className="grid grid-cols-3 gap-4">
          {statCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="flex items-center gap-4 rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4 shadow-sm"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/60">{card.icon}</div>
              <div>
                <div className="text-sm text-slate-500 dark:text-slate-400">{card.label}</div>
                <div className="mt-0.5 text-2xl font-bold text-slate-800 dark:text-slate-100">{card.value}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <ReportTimeActivityChart days={sortedDisplayRows} enabledMetrics={chartMetrics} onToggleMetric={toggleChartMetric} />

        {deleteError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {deleteError}
          </div>
        ) : null}

        <div ref={tableWidthRef} className="relative overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <AnimatePresence>
            {showColumnPicker && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-25 rounded-xl bg-slate-900/10 dark:bg-black/30"
                onClick={() => setShowColumnPicker(false)}
              />
            )}
          </AnimatePresence>
          <div className="relative z-35 flex justify-end px-4 pb-0 pt-3">
            <div className="relative">
              <IconTooltip text="Choose columns (period vs member rows)" placement="bottom">
                <button
                  type="button"
                  onClick={() => setShowColumnPicker((v) => !v)}
                  aria-label="Choose columns"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Table2 className="h-4 w-4" />
                </button>
              </IconTooltip>
              <AnimatePresence>
                {showColumnPicker && (
                  <ReportColumnPicker
                    scope={columnPickerScope}
                    onScopeChange={setColumnPickerScope}
                    enabledCols={pickerEnabledCols}
                    onToggle={toggleCol}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar-x">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <ReportSortableTh
                    colKey="date"
                    label={groupColumnLabel}
                    sortable
                    activeKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSortClick}
                    className="whitespace-nowrap px-5"
                  />
                  {fittedMetricColumns.map((col) => (
                    <ReportSortableTh
                      key={col.key}
                      colKey={col.key}
                      label={col.label}
                      sortable={col.sortable}
                      activeKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSortClick}
                      className={cn(
                        col.key.includes("hours") || col.key.includes("spent") || col.key.includes("idle")
                          ? "whitespace-nowrap"
                          : undefined
                      )}
                    />
                  ))}
                  {canDeleteDay ? (
                    <th className="w-10 px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {tableDisplayRows.map((day) => {
                  const isExpanded = expandedRows.has(day.date)
                  const subRows = getSubRowsForDay(day.date)
                  return (
                    <Fragment key={day.date}>
                      <tr
                        className="cursor-pointer border-b border-slate-50 dark:border-slate-800 transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/60"
                        onClick={() => toggleRow(day.date)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                            )}
                            <span className="whitespace-nowrap text-sm text-slate-700 dark:text-slate-200">
                              {day.dateLabel} ({day.memberCount})
                            </span>
                          </div>
                        </td>
                        {fittedMetricColumns.map((col) => {
                          const on = enabledPeriodCols.has(col.key)
                          return (
                            <td key={col.key} className={cn("px-4 py-3.5", !on && "text-slate-300 dark:text-slate-700")}>
                              {on ? <ReportPeriodMetricCell day={day} colKey={col.key} /> : <span className="text-sm">—</span>}
                            </td>
                          )
                        })}
                        {canDeleteDay ? <td className="px-4 py-3.5" /> : null}
                      </tr>
                      <AnimatePresence>
                        {isExpanded &&
                          subRows.map((member, mi) => (
                            <motion.tr
                              key={`${day.date}-${member.name}`}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ delay: mi * 0.03 }}
                              className="border-b border-slate-50 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40 transition-colors hover:bg-slate-100/50 dark:hover:bg-slate-800/70"
                            >
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2.5 pl-6">
                                  <ReportMemberAvatar initials={member.avatar} />
                                  <span className="text-sm text-slate-700 dark:text-slate-200">{member.name}</span>
                                </div>
                              </td>
                              {fittedMetricColumns.map((col) => {
                                const on = enabledMemberCols.has(col.key)
                                return (
                                  <td key={col.key} className={cn("px-4 py-3", !on && "text-slate-300 dark:text-slate-700")}>
                                    {on ? (
                                      <ReportMemberMetricCell member={member} colKey={col.key} />
                                    ) : (
                                      <span className="text-sm">—</span>
                                    )}
                                  </td>
                                )
                              })}
                              {canDeleteDay ? (
                                <td className="px-4 py-3 text-right">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      confirmDeleteDay(member.memberId, day.date, member.name, day.dateLabel)
                                    }}
                                    disabled={deletingKey === `${member.memberId}::${day.date}`}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                    title="Delete this day's activity and its screenshots, app usage, and URL visits"
                                    aria-label="Delete this day's activity"
                                  >
                                    {deletingKey === `${member.memberId}::${day.date}` ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </td>
                              ) : null}
                            </motion.tr>
                          ))}
                      </AnimatePresence>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-50 dark:border-slate-800 px-5 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              Showing {tableDisplayRows.length} rows
              <div className="relative">
                <select className="appearance-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 pl-2 pr-6 text-sm text-slate-600 dark:text-slate-300 focus:outline-none">
                  <option>50</option>
                  <option>100</option>
                  <option>250</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              </div>
              per page
            </div>
            <button className="flex h-7 w-7 items-center justify-center rounded bg-blue-500 dark:bg-blue-600 text-sm font-medium text-white" type="button">
              1
            </button>
          </div>
        </div>
      </div>

      {filterPortalMounted &&
        createPortal(
          <AnimatePresence>
            {showFilters && (
              <>
                <motion.div
                  ref={filterScrimRef}
                  key="ta-filter-scrim"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-100 bg-transparent"
                  onClick={() => setShowFilters(false)}
                  aria-hidden
                />
                <ReportFiltersPanel
                  key="ta-filters-panel"
                  onClose={() => setShowFilters(false)}
                  panelStyle={filterPanelLayout}
                  trackedTimeFilter={trackedTimeFilter}
                  setTrackedTimeFilter={setTrackedTimeFilter}
                  onClearFilters={clearFilters}
                />
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {canAddForOthers ? (
        <AddManualEntryDialog
          open={addEntryOpen}
          onOpenChange={setAddEntryOpen}
          onSaved={() => onReload?.()}
        />
      ) : null}

      <ReportSendDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        onSend={async ({ emails, subject, message, fileType }) => {
          if (!range) throw new Error("No date range loaded yet.")
          const result = await sendTimeAndActivityReport({
            from: range.from,
            to: range.to,
            emails,
            subject,
            message,
            fileType: fileType.toLowerCase() === "csv" ? "csv" : "pdf",
          })
          if (!result || result.sent === 0) throw new Error("Failed to send report.")
        }}
      />

      <ReportScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        onSave={async ({ emails, subject, message, fileType, scheduleName, dateRange: dateRangeKind, frequency, deliveryTime }) => {
          const result = await scheduleTimeAndActivityReport({
            emails,
            subject,
            message,
            fileType: fileType.toLowerCase() === "csv" ? "csv" : "pdf",
            scheduleName,
            dateRangeKind,
            frequency,
            deliveryTime,
          })
          if (!result) throw new Error("Failed to save schedule.")
        }}
      />
    </div>
  )
}

