"use client"

import { ReportEmptyState, StandardReportLayout } from "@/features/reports/components/app/standard-report-layout"

export function ManualTimeEditsReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  return (
    <StandardReportLayout title="Manual time edits report" onNavigate={onNavigate} exportFileBaseName="manual-time-edits">
      <ReportEmptyState />
    </StandardReportLayout>
  )
}

