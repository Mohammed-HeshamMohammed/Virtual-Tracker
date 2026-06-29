export function getCategoryColor(category: string): string {
  if (category === "productive") return "bg-emerald-500"
  if (category === "neutral") return "bg-slate-400"
  return "bg-red-500"
}

export function getCategoryBgColor(category: string): string {
  if (category === "productive") return "bg-emerald-100 text-emerald-700"
  if (category === "neutral") return "bg-slate-100 text-slate-700"
  return "bg-red-100 text-red-700"
}

export function getScreenshotActivityColor(level: number): string {
  if (level >= 80) return "bg-emerald-500"
  if (level >= 60) return "bg-amber-500"
  return "bg-red-500"
}

export function getActivityTextColor(level: number): string {
  if (level >= 80) return "text-emerald-600"
  if (level >= 60) return "text-amber-600"
  return "text-red-600"
}

export interface Screenshot {
  id: string
  member: string
  avatar: string
  project: string
  capturedAt?: string
  timestamp: string
  time: string
  activityLevel: number
  activeApp: string
  imageData?: string
  pageTitle?: string
  memberId?: string
}

export async function exportToExcel(
  filename: string,
  sheets: Array<{ name: string; columns: any[]; rows: any[] }>,
  metadata?: Array<{ label: string; value: string }>
): Promise<void> {
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()

  sheets.forEach(({ name, columns, rows }) => {
    const sheet = workbook.addWorksheet(name)
    sheet.columns = columns
    rows.forEach((row) => sheet.addRow(row))

    if (metadata && metadata.length > 0) {
      sheet.addRow({})
      metadata.forEach(({ label, value }) => {
        sheet.addRow([label, value])
      })
    }
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
