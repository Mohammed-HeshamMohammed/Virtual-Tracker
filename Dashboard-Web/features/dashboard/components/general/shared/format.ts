export function formatUsd0(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n)
}

export function formatDecimalHoursAsClock(decimalHours: number): string {
  const h = Math.floor(decimalHours)
  let minutes = Math.round((decimalHours - h) * 60)
  let carry = h
  if (minutes === 60) {
    carry += 1
    minutes = 0
  }
  return `${carry}:${minutes.toString().padStart(2, "0")}`
}

export function formatDecimalHoursAsHhMm(decimalHours: number): string {
  const h = Math.floor(decimalHours)
  let m = Math.round((decimalHours - h) * 60)
  let hh = h
  if (m === 60) {
    hh += 1
    m = 0
  }
  return `${hh}h ${m}m`
}

export function formatSecondsAsHhMm(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.round((totalSeconds % 3600) / 60)
  if (h <= 0) return `${m}m`
  return `${h}h ${m}m`
}
