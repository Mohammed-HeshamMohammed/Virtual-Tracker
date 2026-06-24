import { monthNames, baseWeekStart } from "@/features/timesheets/components/view-edit/constants"

export function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

export function toPrettyDate(d: Date): string {
  return `${monthNames[d.getMonth()]} ${d.getDate()}`
}

export function calculateCalendarCells(calendarMonth: Date): (number | null)[] {
  const monthStartIndexMonday =
    (new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay() + 6) % 7
  const monthDayCount = daysInMonth(calendarMonth)
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - monthStartIndexMonday + 1
    if (day < 1 || day > monthDayCount) return null
    return day
  })
}

export function getWeekRangeLabel(weekDates: Date[]): string {
  return `${monthNames[weekDates[0]!.getMonth()]} ${weekDates[0]!.getDate()} - ${weekDates[6]!.getDate()}, ${weekDates[0]!.getFullYear()}`
}

export function calculateWeekOffsetFromDate(picked: Date): { weekOffset: number; dayIndex: number } {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const diffDays = Math.round(
    (picked.getTime() - baseWeekStart.getTime()) / MS_PER_DAY
  )
  const weekOffset = Math.floor(diffDays / 7)
  const dayIndex = ((diffDays % 7) + 7) % 7
  return { weekOffset, dayIndex }
}
