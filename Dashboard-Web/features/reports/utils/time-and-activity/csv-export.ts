import type { TimeActivityExportTable } from "@/features/reports/utils/time-and-activity/export-model"
import { timeActivityTableToCsv } from "@/features/reports/utils/time-and-activity/export-model"
import { todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"

export function downloadTimeActivityCsv(table: TimeActivityExportTable, filename = "time-and-activity"): void {
  const blob = new Blob([timeActivityTableToCsv(table)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${filename}-${todayDateParam()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
