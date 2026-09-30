import type {
  TimeActivityDayRow,
  TimeActivityGroupBy,
  TimeActivityMemberSubRow,
} from "@/features/reports/models/time-and-activity"

/**
 * One description of the Time & Activity table, built once and rendered by
 * both the CSV and the PDF, so neither can drift from what is on screen:
 * the same visible columns, the same grouping, the same filtered and sorted
 * rows, and the people (or projects) underneath each group.
 *
 * Deliberately free of runtime imports so it can be tested without a
 * browser: the only inputs are the rows the table already computed.
 */

export interface ExportColumnDef {
  /** The table's own column key (client, team, total_hours, ...). */
  key: string
  label: string
}

export interface ExportColumn {
  key: string
  header: string
  align: "left" | "right"
}

export interface ExportRow {
  /** "group" is the table's top-level row (a day, member, project...);
   *  "detail" is one of the rows expanded underneath it. */
  kind: "group" | "detail"
  cells: Record<string, string>
}

export interface TimeActivityExportTable {
  columns: ExportColumn[]
  rows: ExportRow[]
}

export interface BuildExportInput {
  rows: TimeActivityDayRow[]
  getSubRows: (groupKey: string) => TimeActivityMemberSubRow[]
  groupBy: TimeActivityGroupBy
  groupColumnLabel: string
  /** The table's currently visible metric columns, in table order. */
  metricColumns: ExportColumnDef[]
  moneyHidden: boolean
  formatManualHours: (hours: number) => string
}

/** What the rows under a group are: the expanded rows of a day are its
 *  members, but under a member or a week they are its projects (see
 *  group-aggregate.ts's subKeyLabelFor). */
export function detailKindLabel(groupBy: TimeActivityGroupBy): "Member" | "Project" {
  return groupBy === "member" || groupBy === "date_per_week" ? "Project" : "Member"
}

const NUMERIC_KEYS = new Set([
  "regular_hours",
  "break_time",
  "manual_hours",
  "total_hours",
  "activity_pct",
  "idle_pct",
  "idle_hr",
  "total_spent",
])

function groupCell(day: TimeActivityDayRow, key: string, input: BuildExportInput): string {
  switch (key) {
    case "client":
      return day.client
    case "team":
      return day.team
    case "todo":
      return day.todo
    case "project":
      return `${day.projectCount}`
    case "regular_hours":
      return day.regularHours
    case "break_time":
      return day.breakTime
    case "manual_hours":
      return input.formatManualHours(day.manualHours)
    case "total_hours":
      return day.totalHours
    case "activity_pct":
      return `${day.activityPct}%`
    case "idle_pct":
      return day.idlePct
    case "idle_hr":
      return day.idleHr
    case "total_spent":
      return day.totalSpent
    default:
      return ""
  }
}

function detailCell(sub: TimeActivityMemberSubRow, key: string, input: BuildExportInput): string {
  switch (key) {
    case "client":
    case "team":
    case "todo":
      return ""
    case "project":
      // The on-screen sub-row shows a dash here; the export has room for
      // what the dash stands for.
      return sub.projectNames.join("; ")
    case "regular_hours":
      return sub.regularHours
    case "break_time":
      return sub.breakTime
    case "manual_hours":
      return input.formatManualHours(sub.manualHours)
    case "total_hours":
      return sub.totalHours
    case "activity_pct":
      return `${sub.activityPct}%`
    case "idle_pct":
      return sub.idlePct
    case "idle_hr":
      return sub.idleHr
    case "total_spent":
      return sub.totalSpent
    default:
      return ""
  }
}

export function buildTimeActivityExportTable(input: BuildExportInput): TimeActivityExportTable {
  const metrics = input.metricColumns.filter((c) => !(input.moneyHidden && c.key === "total_spent"))
  const detailLabel = detailKindLabel(input.groupBy)

  const columns: ExportColumn[] = [
    { key: "__group", header: input.groupColumnLabel, align: "left" },
    { key: "__detail", header: detailLabel, align: "left" },
    { key: "__members", header: "Members", align: "right" },
    ...metrics.map((c) => ({
      key: c.key,
      header: c.label,
      align: (NUMERIC_KEYS.has(c.key) ? "right" : "left") as "left" | "right",
    })),
  ]

  const rows: ExportRow[] = []
  for (const day of input.rows) {
    const groupCells: Record<string, string> = {
      __group: day.dateLabel,
      __detail: `All ${detailLabel.toLowerCase()}s`,
      __members: String(day.memberCount),
    }
    for (const c of metrics) groupCells[c.key] = groupCell(day, c.key, input)
    rows.push({ kind: "group", cells: groupCells })

    for (const sub of input.getSubRows(day.date)) {
      const cells: Record<string, string> = {
        // Repeated on every line so a filtered or pivoted spreadsheet still
        // knows which group a row belongs to.
        __group: day.dateLabel,
        __detail: sub.name,
        __members: "",
      }
      for (const c of metrics) cells[c.key] = detailCell(sub, c.key, input)
      rows.push({ kind: "detail", cells })
    }
  }
  return { columns, rows }
}

const UTF8_BOM = String.fromCharCode(0xfeff)
const CRLF = String.fromCharCode(13, 10)

function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Flat CSV: one line per group total and one per person/project beneath it.
 *  Every line carries its group, so it filters and pivots like any table. */
export function timeActivityTableToCsv(table: TimeActivityExportTable): string {
  const header = table.columns.map((c) => escapeCsvCell(c.header)).join(",")
  const lines = table.rows.map((r) => table.columns.map((c) => escapeCsvCell(r.cells[c.key] ?? "")).join(","))
  // A UTF-8 BOM so Excel reads non-Latin names correctly instead of guessing
  // a legacy code page.
  return `${UTF8_BOM}${[header, ...lines].join(CRLF)}${CRLF}`
}

export interface ExportFilterState {
  memberLabel: string
  projectLabel: string
  groupColumnLabel: string
  trackedTime: string
  manualTime: string
  activityLevel: string
  currency: string
  moneyHidden: boolean
}

/** Human-readable lines describing what the report was narrowed to. Only
 *  filters that are actually applied appear, so an unfiltered report says
 *  "All members" and nothing else. */
export function describeExportFilters(f: ExportFilterState): string[] {
  const lines = [
    `Members: ${f.memberLabel}`,
    `Projects: ${f.projectLabel}`,
    `Grouped by: ${f.groupColumnLabel}`,
  ]
  if (f.trackedTime) lines.push(`Tracked time: ${f.trackedTime}`)
  if (f.manualTime) lines.push(`Manual time: ${f.manualTime}`)
  if (f.activityLevel) lines.push(`Activity level: ${f.activityLevel}`)
  if (!f.moneyHidden && f.currency) lines.push(`Currency: ${f.currency}`)
  return lines
}

export function timeActivityReportTitle(groupColumnLabel: string): string {
  return `Time & Activity by ${groupColumnLabel}`
}

/** A filename that says what is inside: range and grouping, no spaces. */
export function timeActivityFilename(rangeLabel: string, groupBy: TimeActivityGroupBy): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  const range = slug(rangeLabel)
  return ["time-and-activity", range, `by-${slug(groupBy.replace(/_/g, "-"))}`].filter(Boolean).join("_")
}
