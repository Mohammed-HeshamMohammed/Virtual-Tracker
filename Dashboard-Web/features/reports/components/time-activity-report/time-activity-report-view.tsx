"use client"

import { Fragment, useEffect, useMemo, useRef, useState as useComponentState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import * as ContextMenu from "@radix-ui/react-context-menu"
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Download,
  Filter,
  Focus,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
  TrendingUp,
} from "lucide-react"
import { useTimeAndActivityReport } from "@/features/reports/hooks/use-time-and-activity-report"
import { cn } from "@/shared/utils/utils"
import { useAuth, useTheme } from "@/shared/providers/app"
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
import { SearchableSelectField, type SearchableSelectOption } from "@/shared/ui/forms/searchable-select-field"
import { downloadReportPdf } from "@/features/reports/utils/pdf/report-pdf-kit"
import {
  ALL_MEMBERS_VALUE,
  STANDARD_REPORT_ORG_LABEL,
  MEMBER_TIMEZONE_LABEL,
  TIME_ACTIVITY_TABLE_COL_AUTO_HIDE_PRIORITY,
  TIME_ACTIVITY_TABLE_COL_MIN_WIDTH,
  TIME_ACTIVITY_TABLE_FIXED_WIDTH,
} from "@/features/reports/components/shared/constants"
import { useReportColumnAutoHide } from "@/features/reports/hooks/use-report-column-auto-hide"
import { formatDecimalHoursClock } from "@/features/reports/utils/time-and-activity"
import { copyTextToClipboard } from "@/shared/utils/clipboard"

function parseDayParam(day: string): Date {
  return new Date(`${day}T00:00:00`)
}

export function TimeActivityReportView({
  days,
  memberRows,
  entries,
  onRangeApply,
  range,
  onReload,
  loading,
  error,
  displayCurrency = "",
  resolvedDisplayCurrency,
  onDisplayCurrencyChange,
}: TimeActivityReportViewProps) {
  const { memberRole, currentMember } = useAuth()
  const { isDark } = useTheme()
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
    manualTimeFilter,
    setManualTimeFilter,
    activityLevelFilter,
    setActivityLevelFilter,
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
    enabledCols,
    sortKey,
    sortDir,
    sortedDisplayRows,
    tableDisplayRows,
    pagedRows,
    page,
    setPage,
    pageCount,
    pageSize,
    setPageSize,
    totals,
    visibleMetricColumns,
    toggleCol,
    handleSortClick,
    getSubRowsForDay,
    groupColumnLabel,
  } = useTimeAndActivityReport({ days, memberRows, entries, range, currentMemberName: currentMember?.name })

  // Same searchable, avatar-bearing member picker as Manual Time Requests
  // (ManualTimeContent) and the Add Manual Entry dialog on this page, rather
  // than the plain enum dropdown a fixed list like "Data grouped by" uses.
  const memberSelectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      memberFilterOptions.map((o) => ({
        value: o.value,
        label: o.label,
        meta: o.value === ALL_MEMBERS_VALUE ? undefined : <ReportMemberAvatar initials={o.avatar} imageUrl={o.avatarUrl} />,
      })),
    [memberFilterOptions],
  )

  // The column picker used to live inside the table's own card, which clips
  // anything (menus, tooltips) that would extend past its rounded corners -
  // overflow-hidden there is load-bearing for the horizontal scroll and the
  // corner radius, not something to drop. Moved to the toolbar instead, it
  // needs its own outside-click handling in place of the backdrop the table
  // card used to render behind it.
  const columnPickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showColumnPicker) return
    function onPointerDown(e: MouseEvent) {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) setShowColumnPicker(false)
    }
    document.addEventListener("mousedown", onPointerDown, true)
    return () => document.removeEventListener("mousedown", onPointerDown, true)
  }, [showColumnPicker, setShowColumnPicker])

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
      timezoneLabel: MEMBER_TIMEZONE_LABEL,
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
          <div className="flex min-w-60 flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Members</div>
            <SearchableSelectField
              value={memberFilter}
              onChange={(v) => setMemberFilter(v ?? ALL_MEMBERS_VALUE)}
              options={memberSelectOptions}
              placeholder="All members"
              isDark={isDark}
              className="w-60"
            />
          </div>

          <div className="flex min-w-60 flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Projects</div>
            <ReportSimpleDropdown
              value={projectFilter}
              onChange={setProjectFilter}
              options={projectFilterOptions}
              width="w-60"
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
            <div className="relative" ref={columnPickerRef}>
              <IconTooltip text="Choose columns" placement="bottom">
                <button
                  type="button"
                  onClick={() => setShowColumnPicker((v) => !v)}
                  aria-label="Choose columns"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Table2 className="h-4 w-4" />
                </button>
              </IconTooltip>
              <AnimatePresence>
                {showColumnPicker && (
                  <ReportColumnPicker
                    enabledCols={enabledCols}
                    onToggle={toggleCol}
                  />
                )}
              </AnimatePresence>
            </div>
            <button
              type="button"
              onClick={() => setShowFilters(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-blue-500 dark:text-blue-400 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/60"
            >
              <Filter className="h-3.5 w-3.5" />
              Filter
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg bg-blue-500 dark:bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 dark:hover:bg-blue-700"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => downloadTimeActivityCsv(tableDisplayRows, "time-and-activity", groupColumnLabel)}>
                  To CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadPdf}>To PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700" />

        {error ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            {onReload ? (
              <button
                type="button"
                onClick={onReload}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {/* A refetch (new date range, manual reload) never unmounts this view -
            see TimeAndActivity.tsx - so it dims what's already on screen and
            says so, rather than the page flashing to a skeleton and every
            filter/sort/grouping choice resetting with it. */}
        {loading ? (
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400 dark:text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Refreshing…
          </div>
        ) : null}

        <div
          aria-busy={loading}
          className={cn("space-y-6 transition-opacity", loading && "pointer-events-none opacity-60")}
        >
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
          <div className="overflow-x-auto custom-scrollbar-x pt-3">
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
                {pagedRows.map((day) => {
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
                          const on = enabledCols.has(col.key)
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
                            <ContextMenu.Root key={`${day.date}-${member.name}`}>
                              <ContextMenu.Trigger asChild>
                                <motion.tr
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  transition={{ delay: mi * 0.03 }}
                                  className="border-b border-slate-50 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40 transition-colors hover:bg-slate-100/50 dark:hover:bg-slate-800/70"
                                >
                                  <td className="px-5 py-3">
                                    <div className="flex items-center gap-2.5 pl-6">
                                      <ReportMemberAvatar initials={member.avatar} imageUrl={member.avatarUrl} />
                                      <span className="text-sm text-slate-700 dark:text-slate-200">{member.name}</span>
                                    </div>
                                  </td>
                                  {fittedMetricColumns.map((col) => {
                                    const on = enabledCols.has(col.key)
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
                              </ContextMenu.Trigger>
                              <ContextMenu.Portal>
                                <ContextMenu.Content className="z-100 min-w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                                  <ContextMenu.Item
                                    onSelect={() => setMemberFilter(member.name)}
                                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:bg-slate-800"
                                  >
                                    <Focus className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                                    Focus on {member.name}
                                  </ContextMenu.Item>
                                  <ContextMenu.Item
                                    onSelect={() => onRangeApply?.(parseDayParam(day.date), parseDayParam(day.date))}
                                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:bg-slate-800"
                                  >
                                    <CalendarDays className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                                    Show only {day.dateLabel}
                                  </ContextMenu.Item>
                                  <ContextMenu.Separator className="mx-2 my-1 h-px bg-slate-100 dark:bg-slate-800" />
                                  <ContextMenu.Item
                                    onSelect={() =>
                                      void copyTextToClipboard(
                                        `${member.name} — ${day.dateLabel}\nTotal hours: ${member.totalHours}\nActivity: ${member.activityPct}%\nTotal spent: ${member.totalSpent}`,
                                      )
                                    }
                                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:bg-slate-800"
                                  >
                                    <Copy className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                                    Copy record summary
                                  </ContextMenu.Item>
                                </ContextMenu.Content>
                              </ContextMenu.Portal>
                            </ContextMenu.Root>
                          ))}
                      </AnimatePresence>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-50 dark:border-slate-800 px-5 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              {tableDisplayRows.length === 0
                ? "No rows"
                : `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, tableDisplayRows.length)} of ${tableDisplayRows.length} rows`}
              <div className="relative">
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="appearance-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 pl-2 pr-6 text-sm text-slate-600 dark:text-slate-300 focus:outline-none"
                >
                  {[4, 8, 15, 18, 25].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              </div>
              per page
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                aria-label="Previous page"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-2 text-sm text-slate-500 dark:text-slate-400">
                Page {page} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage(page + 1)}
                disabled={page >= pageCount}
                aria-label="Next page"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
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
                  manualTimeFilter={manualTimeFilter}
                  setManualTimeFilter={setManualTimeFilter}
                  activityLevelFilter={activityLevelFilter}
                  setActivityLevelFilter={setActivityLevelFilter}
                  displayCurrency={displayCurrency}
                  resolvedDisplayCurrency={resolvedDisplayCurrency}
                  setDisplayCurrency={onDisplayCurrencyChange ?? (() => {})}
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

