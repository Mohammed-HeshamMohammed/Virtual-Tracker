"use client"

import {
  TimeAndActivityReport,
  AmountsOwedReport,
  DailyTotalsReport,
  ReportsAllPage,
  WorkSessionsReport,
  ManualTimeEditsReport,
  WorkBreaksReport,
  AuditLogReport,
  ReportEmptyState,
  StandardReportLayout,
} from "@/features/reports/components/app"
import { ProjectBudgetsReport } from "@/features/reports"
import { SHIFT_STYLE_HUB_REPORTS } from "@/features/reports"
import { RoutePlaceholder } from "@/app/routes/placeholder"
import type { PageChunkProps } from "@/app/routes/types"

export default function ReportsChunk({ pageId, onNavigate }: PageChunkProps) {
  const shiftStyle = SHIFT_STYLE_HUB_REPORTS[pageId]
  if (shiftStyle) {
    return (
      <StandardReportLayout
        title={shiftStyle.title}
        onNavigate={onNavigate}
        exportFileBaseName={shiftStyle.exportFileBaseName}
      >
        <ReportEmptyState />
      </StandardReportLayout>
    )
  }

  switch (pageId) {
    case "reports-project-budgets":
      return <ProjectBudgetsReport onNavigate={onNavigate} />
    case "reports-time":
      return <TimeAndActivityReport />
    case "reports-daily":
      return <DailyTotalsReport />
    case "reports-amounts":
      return <AmountsOwedReport />
    case "reports-all":
      return <ReportsAllPage onNavigate={onNavigate} />
    case "reports-custom":
      return <RoutePlaceholder title="Customized Reports" />
    case "reports-work-sessions":
      return <WorkSessionsReport onNavigate={onNavigate} />
    case "reports-manual-edits":
      return <ManualTimeEditsReport onNavigate={onNavigate} />
    case "reports-work-breaks":
      return <WorkBreaksReport onNavigate={onNavigate} />
    case "reports-audit":
      return <AuditLogReport onNavigate={onNavigate} />
    case "reports-apps-urls":
      return (
        <StandardReportLayout
          title="Apps & URLs report"
          titleTone="muted"
          onNavigate={onNavigate}
          exportFileBaseName="apps-urls"
        >
          <ReportEmptyState />
        </StandardReportLayout>
      )
    case "reports-expenses":
      return (
        <StandardReportLayout
          title="Expenses"
          titleTone="muted"
          onNavigate={onNavigate}
          exportFileBaseName="expenses"
        >
          <ReportEmptyState />
        </StandardReportLayout>
      )
    default:
      return <ReportsAllPage onNavigate={onNavigate} />
  }
}
