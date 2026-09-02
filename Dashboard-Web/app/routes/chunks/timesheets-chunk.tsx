"use client"

import { PeopleTeamScopeProvider } from "@/features/members/context/people-team-scope-context"
import { TimesheetsViewEdit, TimesheetsPage, ManualTimeRequestsPage } from "@/features/timesheets"
import { TimeAndActivityReport } from "@/features/reports"
import type { PageChunkProps } from "@/app/routes/types"

export default function TimesheetsChunk({ pageId, onNavigate: _onNavigate }: PageChunkProps) {
  switch (pageId) {
    case "timesheets-submissions":
      return <TimesheetsPage />
    case "timesheets-manual-requests":
      return <ManualTimeRequestsPage />
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
