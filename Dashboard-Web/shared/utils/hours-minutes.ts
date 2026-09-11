/** Splits a decimal-hours string ("2.5") into separate hours/minutes parts
 *  for an h/m input pair. Empty or invalid input yields empty parts rather
 *  than throwing, since the caller is a live-typing form field. */
export function decimalHoursToParts(value: string): { hours: string; minutes: string } {
  const trimmed = value.trim()
  if (!trimmed) return { hours: "", minutes: "" }
  const total = Number(trimmed)
  if (!Number.isFinite(total) || total < 0) return { hours: "", minutes: "" }
  const totalMinutes = Math.round(total * 60)
  return { hours: String(Math.floor(totalMinutes / 60)), minutes: String(totalMinutes % 60) }
}

/** Inverse of decimalHoursToParts - clamps minutes to 0-59 and hours to >=0,
 *  returning "" (not "0") when the result is zero so the field reads as
 *  unset rather than an explicit zero duration. */
/** "45 min", "7.5 min", "1 h", "5 h 30 min" - a duration as people read it. */
export function formatMinutesAsDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0 min"
  const halfMinutes = Math.round(totalMinutes * 2) / 2
  if (halfMinutes < 60) return `${halfMinutes} min`
  const hours = Math.floor(halfMinutes / 60)
  const minutes = Math.round(halfMinutes - hours * 60)
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`
}

export function partsToDecimalHours(hoursRaw: string, minutesRaw: string): string {
  const hours = Math.max(0, Number(hoursRaw) || 0)
  const minutes = Math.max(0, Math.min(59, Number(minutesRaw) || 0))
  const total = hours + minutes / 60
  if (total <= 0) return ""
  return String(Math.round(total * 100) / 100)
}
