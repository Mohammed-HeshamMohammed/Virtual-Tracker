/** Count Mon–Fri between start and end dates (inclusive). */
export function countWorkingDaysBetween(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  if (end.getTime() < start.getTime()) return 0

  let count = 0
  const cur = new Date(start)
  while (cur.getTime() <= end.getTime()) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) count += 1
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

export function estimateAssignmentSeconds(task: {
  durationHoursPerDay?: number | null
  overtimeHoursPerDay?: number | null
  startDate?: string | null
  dueDate?: string | null
  durationDays?: number | null
  workingDays?: number | null
}): number | null {
  const hoursPerDay = task.durationHoursPerDay ?? 0
  const overtimePerDay = task.overtimeHoursPerDay ?? 0
  const hoursTotal = hoursPerDay + overtimePerDay
  if (hoursTotal <= 0) return null

  let workingDays = countWorkingDaysBetween(task.startDate ?? null, task.dueDate ?? null)
  if (workingDays == null || workingDays <= 0) {
    workingDays = task.workingDays ?? task.durationDays ?? 0
  }
  if (workingDays <= 0) workingDays = 1

  return Math.floor(workingDays * hoursTotal * 3600)
}
