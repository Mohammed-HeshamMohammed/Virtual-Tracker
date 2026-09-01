/**
 * Generic row-bucketing shared by every report's "Group by" dropdown. Each
 * report supplies its own key function (a small switch over its own row
 * shape and the current `groupBy` string) - this just buckets the report's
 * already-loaded, already-filtered rows under that key, in first-seen order,
 * and sorts chronologically when every key looks like an ISO date. It does
 * not re-aggregate any numbers - the report's own per-row markup renders
 * unchanged underneath each section header.
 */
export interface ReportGroupedRows<T> {
  key: string
  label: string
  rows: T[]
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function formatGroupDateLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1)
  if (Number.isNaN(dt.getTime())) return key
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

export function groupReportRows<T>(rows: T[], keyOf: (row: T) => string): ReportGroupedRows<T>[] {
  const order: string[] = []
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row) || "—"
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(row)
  }
  const isDateGrouping = order.length > 0 && order.every((k) => ISO_DATE_RE.test(k))
  if (isDateGrouping) order.sort((a, b) => a.localeCompare(b))
  return order.map((key) => ({
    key,
    label: ISO_DATE_RE.test(key) ? formatGroupDateLabel(key) : key,
    rows: map.get(key) ?? [],
  }))
}
