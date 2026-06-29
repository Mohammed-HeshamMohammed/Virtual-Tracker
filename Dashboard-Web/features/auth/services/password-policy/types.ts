export type PasswordPolicyRules = {
  minLength: number
  maxLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumber: boolean
  requireSpecial: boolean
  blockedPasswordsEnabled: boolean
  sequenceDetectionEnabled: boolean
  repeatedPatternDetectionEnabled: boolean
  examplePasswordBlacklistEnabled: boolean
  passwordExpirationDays: number | null
  requireMfa: boolean
}

export type PasswordPolicyResponse = {
  version: string
  lastUpdated: string
  passwordPolicy: PasswordPolicyRules
}

export type PasswordStrength = "weak" | "fair" | "good" | "strong" | "very-strong"

export type PasswordRequirementKey =
  | "minLength"
  | "maxLength"
  | "uppercase"
  | "lowercase"
  | "number"
  | "special"
  | "notBlocked"
  | "notSimplePattern"
  | "passwordsMatch"

export type PasswordRequirements = Record<PasswordRequirementKey, boolean | null>

export type PasswordAnalysis = {
  requirements: PasswordRequirements
  strength: PasswordStrength
  valid: boolean
  firstError: string | null
}

export type ChecklistItem = {
  key: PasswordRequirementKey
  label: string
  showWhenEmpty?: boolean
}
