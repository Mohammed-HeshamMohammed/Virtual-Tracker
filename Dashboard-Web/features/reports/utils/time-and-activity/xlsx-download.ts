import type { TimeActivityExportTable } from "@/features/reports/utils/time-and-activity/export-model"
import { buildTimeActivityWorkbook, type XlsxMeta } from "@/features/reports/utils/time-and-activity/xlsx-export"
import { todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** Builds the workbook and hands it to the browser. exceljs is loaded here, on first export,
 *  rather than with the page. */
export async function downloadTimeActivityXlsx(
  table: TimeActivityExportTable,
  meta: Omit<XlsxMeta, "generatedAt">,
  filename = "time-and-activity",
): Promise<void> {
  const ExcelJS = await import("exceljs")
  const workbook = buildTimeActivityWorkbook(ExcelJS, table, { ...meta, generatedAt: new Date() })
  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_TYPE }))
  const a = document.createElement("a")
  a.href = url
  a.download = `${filename}-${todayDateParam()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
