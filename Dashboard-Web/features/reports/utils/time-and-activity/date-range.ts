export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

export function formatRangeLabel(start: Date, end: Date | null): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
  if (!end || start.getTime() === end.getTime()) return fmt(start)
  return `${fmt(start)} - ${fmt(end)}`
}

export function computePresetRange(preset: string): { start: Date; end: Date } | null {
  const now = new Date()
  const today = startOfDay(now)
  switch (preset) {
    case "Today":
      return { start: today, end: endOfDay(now) }
    case "Yesterday": {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      return { start: y, end: endOfDay(new Date(y)) }
    }
    case "Last 7 days": {
      const s = new Date(today)
      s.setDate(s.getDate() - 6)
      return { start: s, end: endOfDay(now) }
    }
    case "Last week": {
      const dow = now.getDay()
      const diffToMonday = dow === 0 ? -6 : 1 - dow
      const thisMonday = new Date(today)
      thisMonday.setDate(today.getDate() + diffToMonday)
      const lastMonday = new Date(thisMonday)
      lastMonday.setDate(thisMonday.getDate() - 7)
      const lastSunday = new Date(lastMonday)
      lastSunday.setDate(lastMonday.getDate() + 6)
      return { start: startOfDay(lastMonday), end: endOfDay(lastSunday) }
    }
    case "Last 2 weeks": {
      const s = new Date(today)
      s.setDate(s.getDate() - 13)
      return { start: s, end: endOfDay(now) }
    }
    case "This month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: startOfDay(s), end: endOfDay(now) }
    }
    case "Last month": {
      const firstThis = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastPrev = new Date(firstThis)
      lastPrev.setDate(0)
      const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1)
      return { start: startOfDay(firstPrev), end: endOfDay(lastPrev) }
    }
    default:
      return null
  }
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

export function getFirstDayOfWeek(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay()
  return d === 0 ? 6 : d - 1
}

export function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function isBetween(d: Date, start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false
  const t = d.getTime()
  return t > Math.min(start.getTime(), end.getTime()) && t < Math.max(start.getTime(), end.getTime())
}

/**
 * The calendar date a `Date` falls on **in the viewer's own zone**, as the
 * `YYYY-MM-DD` string the report APIs take.
 *
 * Every report used to build its range with `startOfDay(d).toISOString().slice(0, 10)`.
 * `startOfDay` sets *local* midnight; `toISOString` then renders it in UTC. The
 * two disagree for every viewer whose offset isn't zero, so the range silently
 * grew by a day. In Cairo (UTC+3), picking "Today" on 10 Sep sent
 * `from=2026-09-09&to=2026-09-10` - two days of data behind a one-day label.
 * West of UTC the extra day lands on the other end instead.
 *
 * Reading the local parts back off the Date keeps the string on the same
 * calendar the user picked it from.
 */
export function toDateParam(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** Today's local date, for stamping export filenames. */
export function todayDateParam(): string {
  return toDateParam(new Date())
}
