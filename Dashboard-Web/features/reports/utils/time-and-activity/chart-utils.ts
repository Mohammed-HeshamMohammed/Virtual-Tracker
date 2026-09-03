import type { TimeActivityDayRow, TimeActivityMetric } from "@/features/reports/models/time-and-activity"

export function buildYTicks(maxVal: number, metric: TimeActivityMetric): number[] {
  if (maxVal <= 0) return metric === "activity" ? [0, 25, 50, 75, 100] : [0, 1, 2, 3, 4]
  if (metric === "activity") return [0, 25, 50, 75, 100]
  const pad = maxVal * 0.08
  const top = maxVal + pad
  const step = top <= 10 ? 1 : top <= 24 ? 2 : top <= 48 ? 4 : Math.ceil(top / 6)
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-6; v += step) ticks.push(Math.round(v * 100) / 100)
  if (ticks.length < 2) ticks.push(Math.round(top * 10) / 10)
  return ticks
}

export function formatYTick(metric: TimeActivityMetric, v: number): string {
  if (metric === "activity") return `${Math.round(v)}%`
  if (metric === "total_spent") return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
  const h = Math.floor(v)
  const m = Math.round((v - h) * 60)
  return m > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${h}:00`
}

export function normalizeSeriesTo01(raw: number[]): number[] {
  const min = Math.min(...raw)
  const max = Math.max(...raw)
  const span = max - min
  if (span < 1e-9) {
    return raw.map(() => (max <= 1e-9 ? 0 : 0.5))
  }
  return raw.map((v) => (v - min) / span)
}

export function formatMetricDisplayValue(metric: TimeActivityMetric, d: TimeActivityDayRow): string {
  switch (metric) {
    case "total_spent":
      return d.totalSpent
    case "activity":
      return `${d.activityPct}%`
    default:
      return d.totalHours
  }
}
