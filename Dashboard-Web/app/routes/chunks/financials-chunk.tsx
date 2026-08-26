"use client"

import { CreatePaymentsContent } from "@/features/financials"
import { PaymentRecordsContent } from "@/features/financials"
import { InvoicesReportContent } from "@/features/financials"
import { ExpensesReportContent } from "@/features/financials"
import { ManagePayrollPage } from "@/features/financials"
import { FinancialsOverviewPage } from "@/features/financials"
import { StandardReportLayout } from "@/features/reports"
import type { PageChunkProps } from "@/app/routes/types"

export default function FinancialsChunk({ pageId, onNavigate }: PageChunkProps) {
  switch (pageId) {
    case "financials-overview":
      return <FinancialsOverviewPage onNavigate={onNavigate} />
    case "financials-payroll":
      return <ManagePayrollPage onNavigate={onNavigate} />
    case "financials-create":
      return <CreatePaymentsContent />
    case "financials-records":
      return <PaymentRecordsContent />
    case "financials-invoices":
      return <InvoicesReportContent />
    case "financials-expenses":
      return (
        <StandardReportLayout
          title="Expenses"
          onNavigate={onNavigate}
          exportFileBaseName="expenses"
        >
          <ExpensesReportContent />
        </StandardReportLayout>
      )
    default:
      return <FinancialsOverviewPage onNavigate={onNavigate} />
  }
}
