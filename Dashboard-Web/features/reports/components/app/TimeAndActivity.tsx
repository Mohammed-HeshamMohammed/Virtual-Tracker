/* eslint-disable react-doctor/only-export-components */
"use client"

import { useMemo } from "react"
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
  return { days: [], memberRows: {} }
}

/** Empty Time & Activity shell — use useTimeAndActivityReport for live data. */
export function TimeAndActivityReport() {
  const { days, memberRows } = useMemo(() => buildDefaultTimeActivityReportData(), [])
  return <TimeActivityReportView days={days} memberRows={memberRows} />
}

