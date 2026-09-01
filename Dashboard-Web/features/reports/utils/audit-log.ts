import { endOfDay, startOfDay } from "@/features/reports/utils/time-and-activity"
import type { AuditLogRow } from "@/features/reports/models/audit-log"

function auditRowInRange(isoDate: string, rangeStart: Date, rangeEnd: Date): boolean {
  const t = new Date(isoDate + "T12:00:00").getTime()
  return t >= startOfDay(rangeStart).getTime() && t <= endOfDay(rangeEnd).getTime()
}

export function filterAuditRows(
  rows: AuditLogRow[],
  opts: {
    query: string
    rangeStart: Date
    rangeEnd: Date
    /** Empty set = no restriction. */
    authors?: Set<string>
    actions?: Set<string>
  }
): AuditLogRow[] {
  const q = opts.query.trim().toLowerCase()
  return rows.filter((r) => {
    if (!auditRowInRange(r.date, opts.rangeStart, opts.rangeEnd)) return false
    if (opts.authors && opts.authors.size > 0 && !opts.authors.has(r.author)) return false
    if (opts.actions && opts.actions.size > 0 && !opts.actions.has(r.action)) return false
    if (!q) return true
    const hay = [
      r.id,
      r.author,
      r.action,
      r.object,
      r.member,
      r.detail,
      r.timeLabel,
    ]
      .join(" ")
      .toLowerCase()
    return hay.includes(q)
  })
}

export function groupAuditRowsByDate(rows: AuditLogRow[]): { dateKey: string; label: string; rows: AuditLogRow[] }[] {
  const order: string[] = []
  const map = new Map<string, AuditLogRow[]>()
  for (const r of rows) {
    if (!map.has(r.date)) {
      map.set(r.date, [])
      order.push(r.date)
    }
    map.get(r.date)!.push(r)
  }
  order.sort((a, b) => b.localeCompare(a))
  return order.map((dateKey) => {
    const [y, m, d] = dateKey.split("-").map(Number)
    const dt = new Date(y, m - 1, d)
    const label = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    return { dateKey, label, rows: map.get(dateKey) ?? [] }
  })
}

export type AuditLogGroupBy = "date" | "author" | "action"

/**
 * AuditLogRow (see models/audit-log.ts) has no identifiable project - the
 * backend maps every row's `member` to a literal "—" placeholder, and
 * `object` is a table name, not a project reference - so there is nothing
 * to build a Projects filter or a "project" group-by option on. Author and
 * Action are real per-row fields the endpoint already populates, so those
 * are offered as the additional dimensions instead.
 */
export function groupAuditRows(
  rows: AuditLogRow[],
  groupBy: AuditLogGroupBy
): { dateKey: string; label: string; rows: AuditLogRow[] }[] {
  if (groupBy !== "date") {
    const key = (r: AuditLogRow) => (groupBy === "author" ? r.author || "Unknown" : r.action || "Unknown")
    const order: string[] = []
    const map = new Map<string, AuditLogRow[]>()
    for (const r of rows) {
      const k = key(r)
      if (!map.has(k)) {
        map.set(k, [])
        order.push(k)
      }
      map.get(k)!.push(r)
    }
    order.sort((a, b) => a.localeCompare(b))
    return order.map((k) => ({ dateKey: k, label: k, rows: map.get(k) ?? [] }))
  }
  return groupAuditRowsByDate(rows)
}

export function exportAuditLogToCsv(rows: AuditLogRow[]): string {
  const headers = ["ID", "Date", "Author", "Time", "Action", "Object", "Member", "Detail"]
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
  const lines = [headers.join(",")]
  for (const r of rows) {
    lines.push(
      [
        esc(r.id),
        esc(r.date),
        esc(r.author),
        esc(r.timeLabel),
        esc(r.action),
        esc(r.object),
        esc(r.member),
        esc(r.detail),
      ].join(",")
    )
  }
  return lines.join("\n")
}
