/** Shift-based allowance requires Settings → Schedules (not released yet). */
export const SHIFT_ALLOWANCE_LIMITS_ENABLED = false

export const SHIFT_ALLOWANCE_COMING_SOON_MESSAGE =
  "Shift-based limits will be available when Settings → Schedules launches. Use manual weekly or daily caps for now."

/** Returns true when the string represents an active (non-empty, > 0) hour limit. */
export function isActiveHourLimit(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || /^no\s/i.test(trimmed)) return false
  const n = Number(trimmed.replace(/[^\d.]/g, ""))
  return Number.isFinite(n) && n > 0
}

function parseHourLimitValue(value: string): number {
  const n = Number(value.trim().replace(/[^\d.]/g, ""))
  return Number.isFinite(n) ? n : 0
}

/**
 * Weekly and daily limits can both be set at once. The only thing that must
 * hold is that a daily cap, spread across the selected working days, can't
 * add up to more than the weekly cap - e.g. 10h/day x 5 working days can't
 * sit under a 40h weekly limit; that combination physically can't be worked.
 */
export function validateWorkLimitsCombo(
  weeklyLimit: string,
  dailyLimit: string,
  workDaysCount: number,
  useShiftsForLimits = false,
): string | null {
  if (!SHIFT_ALLOWANCE_LIMITS_ENABLED) {
    useShiftsForLimits = false
  }
  if (useShiftsForLimits) return null
  if (!isActiveHourLimit(weeklyLimit) || !isActiveHourLimit(dailyLimit)) return null
  const weekly = parseHourLimitValue(weeklyLimit)
  const daily = parseHourLimitValue(dailyLimit)
  const days = workDaysCount > 0 ? workDaysCount : 7
  const dailyTotal = daily * days
  if (dailyTotal > weekly) {
    return `Daily limit x ${days} working day${days === 1 ? "" : "s"} (${dailyTotal}h) can't exceed the weekly limit (${weekly}h).`
  }
  return null
}

export const WORK_LIMITS_COMBO_HINT =
  "Daily limit x working days can't exceed the weekly limit."
