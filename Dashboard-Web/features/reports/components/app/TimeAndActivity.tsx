/* eslint-disable react-doctor/only-export-components */
"use client"

import { useEffect, useState } from "react"
import {
  ReportCalendarGrid,
  ReportColumnPicker,
  ReportDateRangePicker,
  ReportFilterDropdown,
  ReportFiltersPanel,
  ReportMemberAvatar,
  ReportMemberMetricCell,
  ReportPeriodMetricCell,
  ReportSimpleDropdown,
  ReportSortableTh,
  ReportTimeActivityChart,
  TimeActivityReportView,
} from "@/features/reports/components/time-activity-report"
import type { TimeActivityReportData } from "@/features/reports/models/time-and-activity"
import { fetchTimeAndActivityReport } from "@/features/reports/api/time-and-activity-api"
import { startOfDay, endOfDay } from "@/features/reports/utils/time-and-activity"
import { ReportErrorState, ReportSkeleton } from "@/features/reports/components/shared/report-ui"

export { useTimeAndActivityReport } from "@/features/reports/hooks/use-time-and-activity-report"
export type { UseTimeAndActivityReportParams } from "@/features/reports/hooks/use-time-and-activity-report"

export {
  ReportCalendarGrid,
  ReportColumnPicker,
  ReportDateRangePicker,
  ReportFilterDropdown,
  ReportFiltersPanel,
  ReportMemberAvatar,
  ReportMemberMetricCell,
  ReportPeriodMetricCell,
  ReportSimpleDropdown,
  ReportSortableTh,
  ReportTimeActivityChart,
  TimeActivityReportView,
}

/** Empty default payload until report data is loaded from the API. */
export function buildDefaultTimeActivityReportData(): TimeActivityReportData {
  return { days: [], memberRows: {}, entries: [] }
}

function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function defaultRange(): { start: Date; end: Date } {
  const end = endOfDay(new Date())
  const start = startOfDay(new Date())
  start.setDate(start.getDate() - 6)
  return { start, end }
}

/** Time & Activity report, wired to real data — owns the date range so it can refetch on change. */
export function TimeAndActivityReport() {
  const [range, setRange] = useState<{ start: Date; end: Date }>(() => defaultRange())
  const [reportData, setReportData] = useState<TimeActivityReportData>(() => buildDefaultTimeActivityReportData())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchTimeAndActivityReport({ from: toDateParam(range.start), to: toDateParam(range.end) })
      .then((data) => {
        if (!cancelled) setReportData(data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setReportData(buildDefaultTimeActivityReportData())
        setError(err instanceof Error ? err.message : "Request failed")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range, reloadKey])

  if (loading) return <ReportSkeleton tiles={3} rows={8} columns={6} />
  if (error) return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />

  return (
    <TimeActivityReportView
      days={reportData.days}
      memberRows={reportData.memberRows}
      entries={reportData.entries}
      onRangeApply={(start, end) => setRange({ start, end })}
      range={{ from: toDateParam(range.start), to: toDateParam(range.end) }}
      onReload={() => setReloadKey((k) => k + 1)}
    />
  )
}

