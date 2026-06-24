"use client"

import { ReportEmptyState, StandardReportLayout } from "@/features/reports/components/app/standard-report-layout"

export function WorkBreaksReport({ onNavigate }: { onNavigate?: (id: string) => void }) {
  return (
    <StandardReportLayout title="Work breaks report" onNavigate={onNavigate} exportFileBaseName="work-breaks">
      <ReportEmptyState />
    </StandardReportLayout>
  )
}

