import type { TimeActivityDayRow, TimeActivityMetric } from "@/features/reports/models/time-and-activity"
import { formatMoney } from "@/shared/utils/workspace-currency"

export function buildYTicks(maxVal: number, metric: TimeActivityMetric): number[] {
  if (maxVal <= 0) return metric === "activity" ? [0, 25, 50, 75, 100] : [0, 1, 2, 3, 4]
  if (metric === "activity") return [0, 25, 50, 75, 100]
  // 8% headroom left the tallest bar all but touching the top of the plot -
  // worst on a one-day range, where that bar is also the only thing on
  // screen, and it left the hover tooltip (which sits above the bar) with
  // nowhere to go. 22% keeps the peak visibly below the ceiling at every
  // range length.
  const pad = maxVal * 0.22
  const top = maxVal + pad
  const step = top <= 10 ? 1 : top <= 24 ? 2 : top <= 48 ? 4 : Math.ceil(top / 6)
  // Ticks run until one reaches or passes `top`, and that tick becomes the
  // axis maximum. The loop used to stop at the last tick BELOW top, which
  // rounded the ceiling down and ate the headroom: at 8% padding a 10h peak
  // got a max tick of exactly 10 (bar flush with the ceiling), and even at
  // 22% a 19h peak got 22 - under 16%. Rounding up keeps the padding real.
  const ticks: number[] = []
  let v = 0
  for (;;) {
    ticks.push(Math.round(v * 100) / 100)
    if (v >= top - 1e-6) break
    v += step
  }
  return ticks
}

export function formatYTick(metric: TimeActivityMetric, v: number, currency?: string): string {
  if (metric === "activity") return `${Math.round(v)}%`
  // Spend is in the workspace's currency, not dollars.
  if (metric === "total_spent") return formatMoney(v, currency, { compact: true })
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
