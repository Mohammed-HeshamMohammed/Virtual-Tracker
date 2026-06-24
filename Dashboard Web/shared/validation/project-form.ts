import { firstValidationError, parseNonNegativeNumber, parsePercentage } from "@/shared/validation"

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

export function validateBudgetTotalValue(value: string, hasBudget: boolean): string | null {
  if (!hasBudget || !value.trim()) return null
  return parseNonNegativeNumber(value) === null ? "Budget total must be a valid number." : null
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
  hasBudget: boolean
  budgetTotal: string
  budgetNotifyAt: string
  budgetStopTimersAt: string
  memberLimit: string
  memberLimitNotifyAt: string
}): ProjectBudgetFieldErrors {
  return {
    budgetTotal: validateBudgetTotalValue(form.budgetTotal, form.hasBudget),
    budgetNotifyAt: validateBudgetNotifyAtValue(form.budgetNotifyAt),
    budgetStopTimersAt: validateBudgetStopTimersAtValue(form.budgetStopTimersAt),
    memberLimit: validateMemberLimitValue(form.memberLimit),
    memberLimitNotifyAt: validateMemberLimitNotifyAtValue(form.memberLimitNotifyAt),
  }
}

export function validateProjectBudgetFields(form: {
  hasBudget: boolean
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
