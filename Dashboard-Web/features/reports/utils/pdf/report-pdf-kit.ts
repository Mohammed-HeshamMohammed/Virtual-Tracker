import { renderPdf } from "@/shared/pdf-core/kit"
import type {
  PdfAlign,
  PdfAxisUnit,
  PdfBarChart,
  PdfChart,
  PdfColumn,
  PdfLineChart,
  PdfProgressChart,
  PdfSpec,
  PdfSummaryItem,
} from "@/shared/pdf-core/kit"
import { DEFAULT_PDF_OPTIONS, type PdfOptions } from "@/shared/pdf-core/options"
import { todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"

/**
 * Every report's PDF is drawn by the shared core (shared/pdf-core), the same
 * code the server uses for emailed and scheduled reports. This file is the
 * names the report pages already import, and "save it as a download".
 */
export type ReportPdfAlign = PdfAlign
export type ReportPdfAxisUnit = PdfAxisUnit
export type ReportPdfColumn = PdfColumn
export type ReportPdfSummaryItem = PdfSummaryItem
export type ReportPdfBarChart = PdfBarChart
export type ReportPdfLineChart = PdfLineChart
export type ReportPdfProgressChart = PdfProgressChart
export type ReportPdfChart = PdfChart
export type ReportPdfSpec = PdfSpec

/** Downloads the document. Without options it is the plain default look, in English. */
export function downloadReportPdf(spec: ReportPdfSpec, options: PdfOptions = DEFAULT_PDF_OPTIONS): void {
  renderPdf(spec, options).save(`${spec.filename}-${todayDateParam()}.pdf`)
}
