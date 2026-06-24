import { endOfDay, startOfDay } from "@/features/reports/utils/time-and-activity"
import type { AuditLogRow } from "@/features/reports/models/audit-log"

function auditRowInRange(isoDate: string, rangeStart: Date, rangeEnd: Date): boolean {
  const t = new Date(isoDate + "T12:00:00").getTime()
  return t >= startOfDay(rangeStart).getTime() && t <= endOfDay(rangeEnd).getTime()
}

export function filterAuditRows(
  rows: AuditLogRow[],
  opts: { query: string; rangeStart: Date; rangeEnd: Date }
): AuditLogRow[] {
  const q = opts.query.trim().toLowerCase()
  return rows.filter((r) => {
    if (!auditRowInRange(r.date, opts.rangeStart, opts.rangeEnd)) return false
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
