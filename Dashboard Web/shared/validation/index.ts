import { getStructuralPasswordError } from "@/features/auth/services/password-policy/analyze"
import { FALLBACK_PASSWORD_POLICY } from "@/features/auth/services/password-policy/defaults"
import type { PasswordPolicyRules } from "@/features/auth/services/password-policy/types"
import { validateNamePart } from "@/shared/validation/person-name"

export { isEmailLikeNamePart, sanitizePersonNameInput, validateNamePart } from "@/shared/validation/person-name"

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isNonEmptyTrimmed(value: string): boolean {
  return value.trim().length > 0
}

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim())
}

export function isOptionalEmail(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length === 0 || isValidEmail(trimmed)
}

export function parseNonNegativeNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

export function parsePositiveNumber(value: string): number | null {
  const parsed = parseNonNegativeNumber(value)
  if (parsed === null || parsed <= 0) return null
  return parsed
}

export function parsePercentage(value: string): number | null {
  const parsed = parseNonNegativeNumber(value)
  if (parsed === null || parsed > 100) return null
  return parsed
}

export function validatePassword(
  password: string,
  options?: {
    confirmPassword?: string
    requireConfirm?: boolean
    policy?: PasswordPolicyRules
  },
): string | null {
  const policy = options?.policy ?? FALLBACK_PASSWORD_POLICY.passwordPolicy
  return getStructuralPasswordError(password, policy, options ?? {})
}

export function validatePasswordMatch(password: string, confirm: string): string | null {
  if (password !== confirm) return "Passwords do not match."
  return null
}

export function validateRequiredText(value: string, label: string): string | null {
  if (!isNonEmptyTrimmed(value)) return `${label} is required.`
  return null
}

export function validateEmailField(
  value: string,
  options: { required?: boolean; label?: string } = {},
): string | null {
  const { required = true, label = "Email" } = options
  const trimmed = value.trim()
  if (!trimmed) return required ? `${label} is required.` : null
  if (!isValidEmail(trimmed)) return `Enter a valid ${label.toLowerCase()}.`
  return null
}

export function validatePayRate(value: string, required = false): string | null {
  const trimmed = value.trim()
  if (!trimmed) return required ? "Pay rate is required." : null
  if (parseNonNegativeNumber(trimmed) === null) return "Enter a valid pay rate."
  return null
}

export function validatePersonName(first: string, last: string): string | null {
  if (!isNonEmptyTrimmed(first) && !isNonEmptyTrimmed(last)) {
    return "First or last name is required."
  }
  return firstValidationError(validateNamePart(first, "First name"), validateNamePart(last, "Last name"))
}

export function validatePhoneField(
  value: string,
  options: { required?: boolean; label?: string } = {},
): string | null {
  const { required = false, label = "Phone number" } = options
  const trimmed = value.trim()
  if (!trimmed) return required ? `${label} is required.` : null
  if (trimmed.length > 40) return `${label} must be at most 40 characters.`
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 7) return `Enter a valid ${label.toLowerCase()}.`
  if (!/^[\d\s\-+().]+$/.test(trimmed)) return `Enter a valid ${label.toLowerCase()}.`
  return null
}

export function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((email) => email.trim())
    .filter(Boolean)
}

export function validateEmailList(raw: string, options: { required?: boolean } = {}): string | null {
  const { required = true } = options
  const emails = parseEmailList(raw)
  if (emails.length === 0) return required ? "At least one email address is required." : null
  const invalid = emails.find((email) => !isValidEmail(email))
  if (invalid) return `Invalid email: ${invalid}`
  return null
}

export function validateNonEmptySelection<T>(values: T[], label: string): string | null {
  if (values.length === 0) return `Select at least one ${label}.`
  return null
}

export function validateHoursInput(value: string): string | null {
  if (!isNonEmptyTrimmed(value)) return "Please enter hours spent."
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return "Please enter a valid number."
  return null
}

export function firstValidationError(
  ...errors: Array<string | null | undefined>
): string | null {
  for (const error of errors) {
    if (error) return error
  }
  return null
}
