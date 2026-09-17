"use client"

import { useEffect, useRef, useState } from "react"
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
import { startOfDay, endOfDay, toDateParam } from "@/features/reports/utils/time-and-activity"
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

export function buildDefaultTimeActivityReportData(): TimeActivityReportData {
  return { days: [], memberRows: {}, entries: [] }
}

function defaultRange(): { start: Date; end: Date } {
  const end = endOfDay(new Date())
  const start = startOfDay(new Date())
  start.setDate(start.getDate() - 6)
  return { start, end }
}

export function TimeAndActivityReport() {
  const [range, setRange] = useState<{ start: Date; end: Date }>(() => defaultRange())
  const [reportData, setReportData] = useState<TimeActivityReportData>(() => buildDefaultTimeActivityReportData())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // A ref, not state: it must read as current inside the same effect run's
  // .then/.catch the instant a load succeeds, with no extra render in
  // between - state read in a closure from before that render would still
  // say "never loaded" for the first refetch after the first success.
  const hasLoadedOnceRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchTimeAndActivityReport({ from: toDateParam(range.start), to: toDateParam(range.end) })
      .then((data) => {
        if (cancelled) return
        hasLoadedOnceRef.current = true
        setReportData(data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Only a first load has nothing on screen yet to fall back to - a
        // refetch (new date range, manual reload) that fails must leave the
        // table exactly as it was, not blank it out under an error page.
        if (!hasLoadedOnceRef.current) setReportData(buildDefaultTimeActivityReportData())
        setError(err instanceof Error ? err.message : "Request failed")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range, reloadKey])

  if (!hasLoadedOnceRef.current && loading) return <ReportSkeleton tiles={3} rows={8} columns={6} />
  if (!hasLoadedOnceRef.current && error) return <ReportErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />

  // Past the first load, the view stays mounted through every later refetch -
  // unmounting it here (the old behaviour) tore down useTimeAndActivityReport
  // along with it, wiping the member/project filters, grouping, sort and
  // column choices back to defaults on every date-range change or reload,
  // which read as the whole page resetting itself.
  return (
    <TimeActivityReportView
      days={reportData.days}
      memberRows={reportData.memberRows}
      entries={reportData.entries}
      onRangeApply={(start, end) => setRange({ start, end })}
      range={{ from: toDateParam(range.start), to: toDateParam(range.end) }}
      onReload={() => setReloadKey((k) => k + 1)}
      loading={loading}
      error={error}
    />
  )
}

