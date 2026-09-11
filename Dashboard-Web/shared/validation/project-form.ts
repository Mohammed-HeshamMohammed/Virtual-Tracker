import { firstValidationError, parseNonNegativeNumber, parsePercentage, parsePositiveNumber } from "@/shared/validation"
import { formatMinutesAsDuration } from "@/shared/utils/hours-minutes"

/**
 * The agent counts time as active until this much inactivity and stops the
 * timer past it. At least a minute; at most half the project's budget in
 * hours (`maxMinutes`, from the backend - see
 * Dashboard-Backend/src/modules/projects/idle-time.js).
 */
export const IDLE_TIME_MIN_MINUTES = 1

export function validateIdleTimeMinutes(value: string, maxMinutes: number | null = null): string | null {
  const minutes = Number(value)
  if (!value.trim() || !Number.isFinite(minutes)) return "Enter the idle time in minutes."
  if (minutes < IDLE_TIME_MIN_MINUTES) return `Idle time must be at least ${IDLE_TIME_MIN_MINUTES} minute.`
  if (maxMinutes !== null && minutes > maxMinutes) {
    return `Idle time can be at most ${formatMinutesAsDuration(maxMinutes)} on this project.`
  }
  return null
}

export function validateProjectNames(names: string[]): string | null {
  if (names.length === 0) return "Enter at least one project name."
  return null
}

export type ProjectBudgetFieldErrors = {
  budgetTotal?: string | null
  budgetNotifyAt?: string | null
  budgetStopTimersAt?: string | null
  memberLimit?: string | null
  memberLimitNotifyAt?: string | null
}

export function validateBudgetTotalValue(value: string): string | null {
  if (!value.trim()) return "Enter a budget greater than zero."
  return parsePositiveNumber(value) === null ? "Enter a budget greater than zero." : null
}

export function validateBudgetNotifyAtValue(value: string): string | null {
  if (!value.trim()) return null
  return parsePercentage(value) === null
    ? "Budget notification threshold must be between 0 and 100."
    : null
}

export function validateBudgetStopTimersAtValue(value: string): string | null {
  if (!value.trim()) return null
  return parsePercentage(value) === null
    ? "Stop timers threshold must be between 0 and 100."
    : null
}

export function validateMemberLimitValue(value: string): string | null {
  if (!value.trim()) return null
  return parseNonNegativeNumber(value) === null ? "Member limit must be a valid number." : null
}

export function validateMemberLimitNotifyAtValue(value: string): string | null {
  if (!value.trim()) return null
  return parsePercentage(value) === null
    ? "Member limit notification threshold must be between 0 and 100."
    : null
}

export function getProjectBudgetFieldErrors(form: {
  budgetTotal: string
  budgetNotifyAt: string
  budgetStopTimersAt: string
  memberLimit: string
  memberLimitNotifyAt: string
}): ProjectBudgetFieldErrors {
  return {
    budgetTotal: validateBudgetTotalValue(form.budgetTotal),
    budgetNotifyAt: validateBudgetNotifyAtValue(form.budgetNotifyAt),
    budgetStopTimersAt: validateBudgetStopTimersAtValue(form.budgetStopTimersAt),
    memberLimit: validateMemberLimitValue(form.memberLimit),
    memberLimitNotifyAt: validateMemberLimitNotifyAtValue(form.memberLimitNotifyAt),
  }
}

export function validateProjectBudgetFields(form: {
  budgetTotal: string
  budgetNotifyAt: string
  budgetStopTimersAt: string
  memberLimit: string
  memberLimitNotifyAt: string
}): string | null {
  const errors = getProjectBudgetFieldErrors(form)
  return firstValidationError(
    errors.budgetTotal ?? null,
    errors.budgetNotifyAt ?? null,
    errors.budgetStopTimersAt ?? null,
    errors.memberLimit ?? null,
    errors.memberLimitNotifyAt ?? null,
  )
}
