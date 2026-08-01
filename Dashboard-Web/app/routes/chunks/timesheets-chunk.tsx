"use client"

import { PeopleTeamScopeProvider } from "@/features/members/context/people-team-scope-context"
import { TimesheetsViewEdit } from "@/features/timesheets"
import { ReportEmptyState, StandardReportLayout, TimeAndActivityReport } from "@/features/reports"
import type { PageChunkProps } from "@/app/routes/types"

export default function TimesheetsChunk({ pageId, onNavigate }: PageChunkProps) {
  switch (pageId) {
    case "reports-timesheet-approvals":
      return (
        <StandardReportLayout
          title="Timesheet approvals report"
          titleTone="muted"
          onNavigate={onNavigate}
          exportFileBaseName="timesheet-approvals"
        >
          <ReportEmptyState />
        </StandardReportLayout>
      )
    case "timesheets-time-activity":
      return <TimeAndActivityReport />
    case "timesheets-view":
    default:
      return (
        <PeopleTeamScopeProvider>
          <TimesheetsViewEdit />
        </PeopleTeamScopeProvider>
      )
  }
}
