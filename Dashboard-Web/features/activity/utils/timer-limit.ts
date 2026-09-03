export const TIMER_LIMIT_REACHED_MESSAGE =
  "Maximum allowed work time for this task has been reached."

export type TimerAllowance = {
  allowedRemainingSeconds: number | null
  maxCumulativeActiveSeconds: number | null
  limitReached: boolean
  message: string
  taskDailyCapSeconds: number
  memberDailyLimitSeconds: number
  memberWeeklyLimitSeconds: number
  workedTodaySeconds: number
  workedTodayOnTaskSeconds: number
  workedWeekSeconds: number
}

export function resolveTimerActiveLimit(
  allowance: TimerAllowance | null | undefined,
  fallbackLimitSeconds: number | null,
): number | null {
  if (allowance?.maxCumulativeActiveSeconds != null) {
    return allowance.maxCumulativeActiveSeconds
  }
  return fallbackLimitSeconds
}
