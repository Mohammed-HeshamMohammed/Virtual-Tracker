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

export function validateWorkLimitsMutualExclusion(
  weeklyLimit: string,
  dailyLimit: string,
  useShiftsForLimits = false,
): string | null {
  if (!SHIFT_ALLOWANCE_LIMITS_ENABLED) {
    useShiftsForLimits = false
  }
  if (useShiftsForLimits) return null
  if (isActiveHourLimit(weeklyLimit) && isActiveHourLimit(dailyLimit)) {
    return "Choose either a Weekly Limit or a Daily Limit, not both."
  }
  return null
}

export const WORK_LIMITS_EXCLUSION_HINT =
  "Choose either a Weekly Limit or a Daily Limit, not both."
