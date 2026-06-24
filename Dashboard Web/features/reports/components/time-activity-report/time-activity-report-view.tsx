/* eslint-disable react-doctor/use-lazy-motion */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { Fragment } from "react"
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
  Play,
  Save,
  Table2,
  TrendingUp,
} from "lucide-react"
import { useTimeAndActivityReport } from "@/features/reports/hooks/use-time-and-activity-report"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
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

export function TimeActivityReportView({ days, memberRows }: TimeActivityReportViewProps) {
  const {
    chartMetrics,
    toggleChartMetric,
    groupBy,
    setGroupBy,
    groupByOptions,
    memberFilter,
    setMemberFilter,
    memberFilterOptions,
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
    totals,
    visibleMetricColumns,
    toggleCol,
    handleSortClick,
    pickerEnabledCols,
    getSubRowsForDay,
  } = useTimeAndActivityReport({ days, memberRows })

  const statCards = [
    { icon: <Clock className="h-5 w-5 text-blue-500" />, label: "Total time", value: totals.time },
    { icon: <TrendingUp className="h-5 w-5 text-blue-500" />, label: "Average activity", value: `${totals.activity}%` },
    { icon: <CreditCard className="h-5 w-5 text-blue-500" />, label: "Total spent", value: totals.spent },
  ]

  return (
    <div className="relative isolate">
      <div ref={reportColumnRef} className="relative mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        <div className="relative z-50 flex flex-wrap items-end gap-3 gap-y-3">
          <div className="flex min-w-40 flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Members</div>
            <ReportSimpleDropdown
              value={memberFilter}
              onChange={setMemberFilter}
              options={memberFilterOptions}
              width="w-48"
              accentBar={false}
            />
          </div>

          <div className="relative flex flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date range</div>
            <button
              type="button"
              onClick={() => setShowDatePicker((v) => !v)}
              className={cn(
                "flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50",
                showDatePicker ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200"
              )}
            >
              {dateLabel}
              <Calendar className="h-4 w-4 text-blue-500" />
            </button>
            <AnimatePresence>
              {showDatePicker && (
                <ReportDateRangePicker
                  key="date-range"
                  onApply={(lbl) => {
                    setDateLabel(lbl)
                    setShowDatePicker(false)
                  }}
                  onDismiss={() => setShowDatePicker(false)}
                />
              )}
            </AnimatePresence>
          </div>

          <div className="flex flex-col gap-1 pb-2">
            <div className="select-none text-[10px] font-semibold uppercase tracking-wider text-transparent">.</div>
            <span className="text-sm font-semibold text-slate-700">MDT</span>
          </div>

          <div className="flex min-w-40 flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Data grouped by</div>
            <ReportSimpleDropdown
              value={groupBy}
              onChange={(v) => setGroupBy(v as TimeActivityGroupBy)}
              options={groupByOptions}
              width="w-44"
              accentBar={false}
            />
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2 pb-0.5">
            {[
              { icon: <Download className="h-4 w-4" />, title: "Export" },
              { icon: <Play className="h-4 w-4" />, title: "Share" },
              { icon: <Clock className="h-4 w-4" />, title: "Schedule" },
            ].map((btn) => (
              <IconTooltip key={btn.title} text={btn.title} placement="bottom">
                <button
                  type="button"
                  aria-label={btn.title}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-500 transition-colors hover:bg-blue-50"
                >
                  {btn.icon}
                </button>
              </IconTooltip>
            ))}
            <button
              type="button"
              onClick={() => setShowFilters(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-blue-500 transition-colors hover:bg-blue-50"
            >
              <Filter className="h-3.5 w-3.5" />
              Filter
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
          </div>
        </div>

        <div className="border-t border-slate-200" />

        <div className="grid grid-cols-3 gap-4">
          {statCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="flex items-center gap-4 rounded-xl border border-slate-100 bg-white px-5 py-4 shadow-sm"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50">{card.icon}</div>
              <div>
                <div className="text-sm text-slate-500">{card.label}</div>
                <div className="mt-0.5 text-2xl font-bold text-slate-800">{card.value}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <ReportTimeActivityChart days={sortedDisplayRows} enabledMetrics={chartMetrics} onToggleMetric={toggleChartMetric} />

        <div className="relative overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
          <AnimatePresence>
            {showColumnPicker && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-25 rounded-xl bg-slate-900/10"
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
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
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

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <ReportSortableTh
                    colKey="date"
                    label="Date"
                    sortable
                    activeKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSortClick}
                    className="whitespace-nowrap px-5"
                  />
                  {visibleMetricColumns.map((col) => (
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
                </tr>
              </thead>
              <tbody>
                {sortedDisplayRows.map((day) => {
                  const isExpanded = expandedRows.has(day.date)
                  const subRows = getSubRowsForDay(day.date)
                  return (
                    <Fragment key={day.date}>
                      <tr
                        className="cursor-pointer border-b border-slate-50 transition-colors hover:bg-slate-50/60"
                        onClick={() => toggleRow(day.date)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            )}
                            <span className="whitespace-nowrap text-sm text-slate-700">
                              {day.dateLabel} ({day.memberCount})
                            </span>
                          </div>
                        </td>
                        {visibleMetricColumns.map((col) => {
                          const on = enabledPeriodCols.has(col.key)
                          return (
                            <td key={col.key} className={cn("px-4 py-3.5", !on && "text-slate-300")}>
                              {on ? <ReportPeriodMetricCell day={day} colKey={col.key} /> : <span className="text-sm">—</span>}
                            </td>
                          )
                        })}
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
                              className="border-b border-slate-50 bg-slate-50/40 transition-colors hover:bg-slate-100/50"
                            >
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2.5 pl-6">
                                  <ReportMemberAvatar initials={member.avatar} />
                                  <span className="text-sm text-slate-700">{member.name}</span>
                                </div>
                              </td>
                              {visibleMetricColumns.map((col) => {
                                const on = enabledMemberCols.has(col.key)
                                return (
                                  <td key={col.key} className={cn("px-4 py-3", !on && "text-slate-300")}>
                                    {on ? (
                                      <ReportMemberMetricCell member={member} colKey={col.key} />
                                    ) : (
                                      <span className="text-sm">—</span>
                                    )}
                                  </td>
                                )
                              })}
                            </motion.tr>
                          ))}
                      </AnimatePresence>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-50 px-5 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              Showing {sortedDisplayRows.length} rows
              <div className="relative">
                <select className="appearance-none rounded-lg border border-slate-200 bg-white py-1 pl-2 pr-6 text-sm text-slate-600 focus:outline-none">
                  <option>50</option>
                  <option>100</option>
                  <option>250</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
              </div>
              per page
            </div>
            <button className="flex h-7 w-7 items-center justify-center rounded bg-blue-500 text-sm font-medium text-white" type="button">
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
                <ReportFiltersPanel key="ta-filters-panel" onClose={() => setShowFilters(false)} panelStyle={filterPanelLayout} />
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  )
}

