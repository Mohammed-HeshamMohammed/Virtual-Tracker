// The Time & Activity report as a workbook: a Summary sheet, then one sheet for every group
// the table is grouped by (a day, by default) with bordered cells, a coloured header, and any
// row that needs a second look shaded - and named in a Flags column, so the colour is never
// the only signal.
//
// Built from the same table model as the CSV and the PDF, so it carries the same columns,
// filters and sort as the screen, and never a money column for a viewer who may not see money.
//
// No runtime import of exceljs here: the module is handed in. That keeps this file loadable
// from Node for tests, and keeps the library out of the page until someone exports.

import type { Fill, Workbook, Worksheet } from "exceljs"
import type { ExportColumn, ExportRow, TimeActivityExportTable } from "./export-model.ts"
import { describeRiskRules, evaluateRowFlags, hmsToSeconds, type RowFlags, type Severity } from "./export-flags.ts"

type ExcelJSModule = { Workbook: new () => Workbook }

export interface XlsxMeta {
  title: string
  rangeLabel: string
  filterLines: string[]
  generatedAt: Date
}

/** Past this many groups the rest are listed on the Summary only. A workbook with hundreds of
 *  tabs opens slowly and cannot be navigated; the Summary still carries every group. */
export const MAX_GROUP_SHEETS = 200

const PALETTE = {
  ink: "FF0F172A",
  headerFill: "FF1E293B",
  headerText: "FFFFFFFF",
  border: "FFCBD5E1",
  groupFill: "FFE2E8F0",
  muted: "FF64748B",
  link: "FF1D4ED8",
  tab: "FF1E293B",
  critical: { row: "FFFEE2E2", cell: "FFFCA5A5", text: "FF991B1B", tab: "FFDC2626" },
  warning: { row: "FFFEF3C7", cell: "FFFDE68A", text: "FF92400E", tab: "FFF59E0B" },
  review: { row: "FFEDE9FE", cell: "FFDDD6FE", text: "FF5B21B6", tab: "FF8B5CF6" },
} as const

type Flagged = Exclude<Severity, "none">
const colours = (severity: Severity) => (severity === "none" ? null : PALETTE[severity as Flagged])

const FLAGS_KEY = "__flags"
const DURATION_KEYS = new Set(["regular_hours", "break_time", "manual_hours", "total_hours", "idle_hr"])
const PERCENT_KEYS = new Set(["activity_pct", "idle_pct"])
const HEADER_ROW = 4
const SUMMARY_HEADER_ROW = 5

const solid = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } })
const line = { style: "thin" as const, color: { argb: PALETTE.border } }
const BORDER = { top: line, left: line, bottom: line, right: line }

/** Excel's own rules for a tab name: 31 characters, none of \ / ? * [ ] :, no edge apostrophes,
 *  unique without regard to case, and never "History". */
export function sheetNameFor(label: string, used: Set<string>): string {
  const base =
    label
      .replace(/[\\/?*[\]:]/g, "-")
      .replace(/^'+|'+$/g, "")
      .trim()
      .slice(0, 31) || "Sheet"
  let name = base
  for (let n = 2; used.has(name.toLowerCase()) || name.toLowerCase() === "history"; n++) {
    const suffix = ` (${n})`
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`
  }
  used.add(name.toLowerCase())
  return name
}

/** What goes in the cell: a real number where the text is one, so it sorts and sums in Excel. */
function typed(key: string, text: string): { value: string | number; numFmt?: string } {
  if (DURATION_KEYS.has(key)) {
    const seconds = hmsToSeconds(text)
    if (seconds !== null) return { value: seconds / 86400, numFmt: "[h]:mm:ss" }
  }
  if (PERCENT_KEYS.has(key)) {
    const m = /^(\d+(?:\.\d+)?)%$/.exec(text.trim())
    if (m) return { value: Number(m[1]) / 100, numFmt: "0%" }
  }
  if (key === "__members" && /^\d+$/.test(text)) return { value: Number(text), numFmt: "0" }
  return { value: text }
}

interface SheetColumn {
  key: string
  header: string
  align: "left" | "right"
}

function columnsFor(table: TimeActivityExportTable, drop: string): SheetColumn[] {
  const own = table.columns.filter((c: ExportColumn) => c.key !== drop)
  return [...own, { key: FLAGS_KEY, header: "Flags", align: "left" }]
}

function flagsOf(table: TimeActivityExportTable, row: ExportRow): RowFlags {
  return evaluateRowFlags(row.metrics, { memberDay: table.groupBy === "date_per_day" && row.kind === "detail" })
}

function textOf(row: ExportRow, flags: RowFlags, key: string): string {
  return key === FLAGS_KEY ? flags.reasons.join("; ") : (row.cells[key] ?? "")
}

function writeHeader(sheet: Worksheet, rowNumber: number, columns: SheetColumn[]): void {
  const row = sheet.getRow(rowNumber)
  row.height = 24
  columns.forEach((c, i) => {
    const cell = row.getCell(i + 1)
    cell.value = c.header
    cell.fill = solid(PALETTE.headerFill)
    cell.font = { bold: true, color: { argb: PALETTE.headerText }, size: 11 }
    cell.border = BORDER
    cell.alignment = { horizontal: c.align === "right" ? "right" : "left", vertical: "middle", wrapText: true }
  })
}

function writeRow(
  sheet: Worksheet,
  rowNumber: number,
  columns: SheetColumn[],
  row: ExportRow,
  flags: RowFlags,
  isTotal: boolean,
): void {
  const tint = flags.severity === "critical" || flags.severity === "warning" ? colours(flags.severity) : null
  const worst = colours(flags.severity)
  columns.forEach((c, i) => {
    const cell = sheet.getCell(rowNumber, i + 1)
    const { value, numFmt } = typed(c.key, textOf(row, flags, c.key))
    cell.value = value
    if (numFmt) cell.numFmt = numFmt
    cell.border = BORDER
    cell.alignment = { horizontal: c.align === "right" ? "right" : "left", vertical: "middle", wrapText: c.key === FLAGS_KEY }
    cell.font = { bold: isTotal, color: { argb: PALETTE.ink } }
    if (isTotal) cell.fill = solid(PALETTE.groupFill)
    else if (tint) cell.fill = solid(tint.row)

    const marked = colours(flags.cells[c.key] ?? "none")
    if (marked) {
      cell.fill = solid(marked.cell)
      cell.font = { bold: true, color: { argb: marked.text } }
    } else if (c.key === FLAGS_KEY && worst) {
      cell.font = { bold: true, color: { argb: worst.text } }
    }
  })
}

function fitWidths(sheet: Worksheet, columns: SheetColumn[], rows: { row: ExportRow; flags: RowFlags }[]): void {
  columns.forEach((c, i) => {
    const longest = Math.max(
      c.header.length,
      ...rows.map(({ row, flags }) => {
        const text = textOf(row, flags, c.key)
        return c.key === FLAGS_KEY ? Math.min(text.length, 58) : text.length
      }),
    )
    const [min, max] = c.key === FLAGS_KEY ? [20, 60] : [10, 38]
    sheet.getColumn(i + 1).width = Math.min(max, Math.max(min, longest + 2))
  })
}

function worstOf(flags: RowFlags[]): Severity {
  const rank: Severity[] = ["none", "review", "warning", "critical"]
  return flags.reduce<Severity>((w, f) => (rank.indexOf(f.severity) > rank.indexOf(w) ? f.severity : w), "none")
}

interface Group {
  total: ExportRow
  details: ExportRow[]
}

function groupsOf(table: TimeActivityExportTable): Group[] {
  const groups: Group[] = []
  for (const row of table.rows) {
    if (row.kind === "group") groups.push({ total: row, details: [] })
    else groups[groups.length - 1]?.details.push(row)
  }
  return groups
}

const pad = (n: number) => String(n).padStart(2, "0")
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
const link = (name: string) => `#'${name.replace(/'/g, "''")}'!A1`

function addGroupSheet(
  workbook: Workbook,
  name: string,
  label: string,
  group: Group,
  table: TimeActivityExportTable,
  meta: XlsxMeta,
): void {
  const columns = columnsFor(table, "__group")
  const detailFlags = group.details.map((row) => ({ row, flags: flagsOf(table, row) }))
  const totalFlags = flagsOf(table, group.total)
  const worst = worstOf([...detailFlags.map((d) => d.flags), ...(detailFlags.length ? [] : [totalFlags])])
  const tab = colours(worst)?.tab

  const sheet = workbook.addWorksheet(name, {
    properties: tab ? { tabColor: { argb: tab } } : undefined,
    views: [{ state: "frozen", xSplit: 1, ySplit: HEADER_ROW, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  sheet.getCell("A1").value = `${label}  ·  ${meta.title}`
  sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: PALETTE.ink } }
  sheet.getCell("A2").value = { text: "← Back to Summary", hyperlink: link("Summary") }
  sheet.getCell("A2").font = { underline: true, color: { argb: PALETTE.link } }

  writeHeader(sheet, HEADER_ROW, columns)
  detailFlags.forEach(({ row, flags }, i) => writeRow(sheet, HEADER_ROW + 1 + i, columns, row, flags, false))

  const totalRow = HEADER_ROW + detailFlags.length + 1
  const total: ExportRow = { ...group.total, cells: { ...group.total.cells, __detail: "Total" } }
  writeRow(sheet, totalRow, columns, total, totalFlags, true)

  if (detailFlags.length > 0) {
    sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW + detailFlags.length, column: columns.length } }
  }
  fitWidths(sheet, columns, [...detailFlags, { row: total, flags: totalFlags }])
  // The title sits in the first column; widening it for the title would spoil the table under it.
}

function addSummarySheet(
  workbook: Workbook,
  table: TimeActivityExportTable,
  groups: Group[],
  names: (string | null)[],
  meta: XlsxMeta,
  truncated: boolean,
): void {
  const columns = columnsFor(table, "__detail")
  const sheet = workbook.addWorksheet("Summary", {
    properties: { tabColor: { argb: PALETTE.tab } },
    views: [{ state: "frozen", xSplit: 1, ySplit: SUMMARY_HEADER_ROW, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  sheet.getCell("A1").value = meta.title
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: PALETTE.ink } }
  sheet.getCell("A2").value = `Range: ${meta.rangeLabel}   ·   Generated ${stamp(meta.generatedAt)}`
  sheet.getCell("A2").font = { color: { argb: PALETTE.muted } }
  sheet.getCell("A3").value = `Filters: ${meta.filterLines.join("   ·   ")}`
  sheet.getCell("A3").font = { color: { argb: PALETTE.muted } }

  writeHeader(sheet, SUMMARY_HEADER_ROW, columns)
  const rows = groups.map((g) => ({ row: g.total, flags: flagsOf(table, g.total) }))
  rows.forEach(({ row, flags }, i) => {
    const r = SUMMARY_HEADER_ROW + 1 + i
    writeRow(sheet, r, columns, row, flags, true)
    const name = names[i]
    if (name) {
      const cell = sheet.getCell(r, 1)
      cell.value = { text: row.cells.__group ?? "", hyperlink: link(name) }
      cell.font = { bold: true, underline: true, color: { argb: PALETTE.link } }
    }
  })
  if (rows.length === 0) {
    sheet.getCell(SUMMARY_HEADER_ROW + 1, 1).value = "Nothing to show for these filters."
    sheet.getCell(SUMMARY_HEADER_ROW + 1, 1).font = { italic: true, color: { argb: PALETTE.muted } }
  } else {
    sheet.autoFilter = {
      from: { row: SUMMARY_HEADER_ROW, column: 1 },
      to: { row: SUMMARY_HEADER_ROW + rows.length, column: columns.length },
    }
  }
  fitWidths(sheet, columns, rows)

  let r = SUMMARY_HEADER_ROW + Math.max(rows.length, 1) + 2
  if (truncated) {
    sheet.getCell(r, 1).value = `Only the first ${MAX_GROUP_SHEETS} have a sheet of their own; the rest are listed here only.`
    sheet.getCell(r, 1).font = { italic: true, color: { argb: PALETTE.muted } }
    r += 2
  }

  sheet.getCell(r, 1).value = "How rows are marked"
  sheet.getCell(r, 1).font = { bold: true, size: 12, color: { argb: PALETTE.ink } }
  for (const rule of describeRiskRules()) {
    r++
    const swatch = sheet.getCell(r, 1)
    const c = colours(rule.severity)
    swatch.value = rule.label
    swatch.border = BORDER
    swatch.font = { bold: true, color: { argb: c ? c.text : PALETTE.muted } }
    swatch.fill = solid(c ? c.cell : "FFF1F5F9")
    if (columns.length > 1) sheet.mergeCells(r, 2, r, columns.length)
    const text = sheet.getCell(r, 2)
    text.value = rule.text
    text.alignment = { wrapText: true, vertical: "middle" }
    sheet.getRow(r).height = Math.max(18, Math.ceil(rule.text.length / 95) * 16)
  }
}

export function buildTimeActivityWorkbook(ExcelJS: ExcelJSModule, table: TimeActivityExportTable, meta: XlsxMeta): Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "My Virtual Tracker"
  workbook.created = meta.generatedAt

  const groups = groupsOf(table)
  const used = new Set<string>(["summary"])
  const names = groups.map((g, i) => (i < MAX_GROUP_SHEETS ? sheetNameFor(g.total.cells.__group ?? "", used) : null))

  addSummarySheet(workbook, table, groups, names, meta, groups.length > MAX_GROUP_SHEETS)
  groups.forEach((g, i) => {
    const name = names[i]
    if (name) addGroupSheet(workbook, name, g.total.cells.__group ?? name, g, table, meta)
  })
  return workbook
}
