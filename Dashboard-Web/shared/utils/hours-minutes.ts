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
export function partsToDecimalHours(hoursRaw: string, minutesRaw: string): string {
  const hours = Math.max(0, Number(hoursRaw) || 0)
  const minutes = Math.max(0, Math.min(59, Number(minutesRaw) || 0))
  const total = hours + minutes / 60
  if (total <= 0) return ""
  return String(Math.round(total * 100) / 100)
}
