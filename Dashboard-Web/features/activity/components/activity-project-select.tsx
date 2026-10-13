"use client"

import { useMemo } from "react"
import { useActivityFeedContext } from "@/features/activity/components/activity-feed-context"
import { ReportToolbarMultiSelect, useReportFilterOptions } from "@/features/reports/components/shared/report-filters-panel"

/** Narrow activity to some projects. The list is the one the reports
 *  offer - only projects this viewer can see - and the server holds the
 *  request to the same set, so a hand-edited id gets nothing extra. */
export function ActivityProjectSelect() {
  const { selectedProjectIds, setSelectedProjectIds } = useActivityFeedContext()
  const { projects } = useReportFilterOptions()
  const selected = useMemo(() => new Set(selectedProjectIds), [selectedProjectIds])

  if (projects.length === 0) return null

  return (
    <ReportToolbarMultiSelect
      label="Projects"
      emptyLabel="All projects"
      options={projects}
      selected={selected}
      onChange={(next) => setSelectedProjectIds([...next])}
      width="w-36 shrink-0 sm:w-44"
    />
  )
}
