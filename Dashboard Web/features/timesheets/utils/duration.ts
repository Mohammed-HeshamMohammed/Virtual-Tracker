export function parseDurationToMinutes(duration: string): number {
  const match = duration.match(/(\d+)h\s*(\d+)m/)
  if (!match) return 0
  return Number(match[1]) * 60 + Number(match[2])
}

export function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h ${String(m).padStart(2, "0")}m`
}

export function getDurationFromTimes(startTime: string, endTime: string): string {
  const [startHour, startMinute] = startTime.split(":").map(Number)
  const [endHour, endMinute] = endTime.split(":").map(Number)
  const startTotal = startHour * 60 + startMinute
  let endTotal = endHour * 60 + endMinute
  if (endTotal < startTotal) {
    endTotal += 24 * 60
  }
  const durationMinutes = Math.max(endTotal - startTotal, 0)
  return formatMinutes(durationMinutes)
}
