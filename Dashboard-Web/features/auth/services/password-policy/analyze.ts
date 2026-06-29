import type {
  BackendPasswordRequirements,
} from "@/features/auth/services/password-policy/use-password-backend-check"
import type {
  PasswordAnalysis,
  PasswordPolicyRules,
  PasswordRequirementKey,
  PasswordRequirements,
  PasswordStrength,
} from "@/features/auth/services/password-policy/types"

const UPPERCASE_RE = /[A-Z]/
const LOWERCASE_RE = /[a-z]/
const NUMBER_RE = /[0-9]/
const SPECIAL_RE = /[^A-Za-z0-9]/

const SEQUENTIAL_PATTERNS = [
  "abcdefghijklmnopqrstuvwxyz",
  "zyxwvutsrqponmlkjihgfedcba",
  "0123456789",
  "9876543210",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
]

export function strengthToLabel(strength: PasswordStrength): string {
  switch (strength) {
    case "weak":
      return "Weak"
    case "fair":
      return "Fair"
    case "good":
      return "Good"
    case "strong":
      return "Strong"
    case "very-strong":
      return "Very Strong"
    default:
      return "Weak"
  }
}

function hasSequentialPattern(password: string, enabled: boolean): boolean {
  if (!enabled) return false
  const lower = password.toLowerCase()
  for (const seq of SEQUENTIAL_PATTERNS) {
    const minChunk = Math.min(6, seq.length)
    for (let len = seq.length; len >= minChunk; len--) {
      for (let i = 0; i <= seq.length - len; i++) {
        const chunk = seq.slice(i, i + len)
        if (chunk.length >= 4 && lower.includes(chunk)) {
          return true
        }
      }
    }
  }
  return false
}

function hasRepeatedPattern(password: string, enabled: boolean): boolean {
  if (!enabled || !password) return false
  if (/(.)\1{5,}/.test(password)) return true
  if (password.length >= 4 && /^(.)\1+$/.test(password)) return true
  if (/(.{2})\1{4,}/.test(password)) return true
  if (/(.{3})\1{3,}/.test(password)) return true
  return false
}

function clientSimplePatternFails(password: string, policy: PasswordPolicyRules): boolean {
  return (
    hasSequentialPattern(password, policy.sequenceDetectionEnabled) ||
    hasRepeatedPattern(password, policy.repeatedPatternDetectionEnabled)
  )
}

function calculateStructuralStrength(password: string, requirements: PasswordRequirements): PasswordStrength {
  if (!password) return "weak"

  let score = 0
  const length = password.length

  if (requirements.minLength) score += 12
  if (length >= 12) score += 8
  if (length >= 16) score += 10
  if (length >= 20) score += 10
  if (length >= 24) score += 5

  const variety =
    Number(UPPERCASE_RE.test(password)) +
    Number(LOWERCASE_RE.test(password)) +
    Number(NUMBER_RE.test(password)) +
    Number(SPECIAL_RE.test(password))
  score += variety * 4

  const uniqueChars = new Set(password).size
  score += Math.round((uniqueChars / password.length) * 12)

  if (requirements.notBlocked === true) score += 8
  if (requirements.notSimplePattern === true) score += 8
  if (requirements.notBlocked === false || requirements.notSimplePattern === false) {
    score = Math.min(score, 25)
  }

  score = Math.max(0, Math.min(100, score))

  if (score < 20) return "weak"
  if (score < 40) return "fair"
  if (score < 60) return "good"
  if (score < 80) return "strong"
  return "very-strong"
}

export function getStructuralPasswordError(
  password: string,
  policy: PasswordPolicyRules,
  options: { confirmPassword?: string; requireConfirm?: boolean } = {},
): string | null {
  if (!password) return "Password is required."

  if (password.length < policy.minLength) {
    return `Password must be at least ${policy.minLength} characters.`
  }
  if (password.length > policy.maxLength) {
    return `Password must be at most ${policy.maxLength} characters.`
  }
  if (policy.requireUppercase && !UPPERCASE_RE.test(password)) {
    return "Password must contain at least one uppercase letter."
  }
  if (policy.requireLowercase && !LOWERCASE_RE.test(password)) {
    return "Password must contain at least one lowercase letter."
  }
  if (policy.requireNumber && !NUMBER_RE.test(password)) {
    return "Password must contain at least one number."
  }
  if (policy.requireSpecial && !SPECIAL_RE.test(password)) {
    return "Password must contain at least one special character."
  }

  const confirmPassword = options.confirmPassword
  if (options.requireConfirm || typeof confirmPassword === "string") {
    if (password !== confirmPassword) {
      return "Passwords do not match."
    }
  }

  return null
}

function resolveBlockedRequirement(
  password: string,
  policy: PasswordPolicyRules,
  backendRequirements?: BackendPasswordRequirements,
  backendSecurityValid?: boolean | null,
): boolean | null {
  const needsCheck = policy.blockedPasswordsEnabled || policy.examplePasswordBlacklistEnabled
  if (!needsCheck) return password.length > 0 ? true : false
  if (!password) return false
  if (backendRequirements?.notBlocked === true) return true
  if (backendRequirements?.notBlocked === false) return false
  if (backendSecurityValid === true) return true
  return null
}

function resolveSimplePatternRequirement(
  password: string,
  policy: PasswordPolicyRules,
  backendRequirements?: BackendPasswordRequirements,
): boolean | null {
  const needsCheck = policy.sequenceDetectionEnabled || policy.repeatedPatternDetectionEnabled
  if (!needsCheck) return password.length > 0 ? true : false
  if (!password) return false
  if (clientSimplePatternFails(password, policy)) return false
  if (backendRequirements?.notSimplePattern === false) return false
  return true
}

export function analyzePassword(
  password: string,
  policy: PasswordPolicyRules,
  options: {
    confirmPassword?: string
    backendSecurityValid?: boolean | null
    backendSecurityError?: string | null
    backendRequirements?: BackendPasswordRequirements
  } = {},
): PasswordAnalysis {
  const confirmPassword = options.confirmPassword
  const hasConfirm = typeof confirmPassword === "string"
  const needsSecurityCheck =
    policy.blockedPasswordsEnabled ||
    policy.examplePasswordBlacklistEnabled ||
    policy.sequenceDetectionEnabled ||
    policy.repeatedPatternDetectionEnabled

  const requirements: PasswordRequirements = {
    minLength: password.length >= policy.minLength,
    maxLength: password.length <= policy.maxLength,
    uppercase: !policy.requireUppercase || UPPERCASE_RE.test(password),
    lowercase: !policy.requireLowercase || LOWERCASE_RE.test(password),
    number: !policy.requireNumber || NUMBER_RE.test(password),
    special: !policy.requireSpecial || SPECIAL_RE.test(password),
    notBlocked: resolveBlockedRequirement(
      password,
      policy,
      options.backendRequirements,
      options.backendSecurityValid,
    ),
    notSimplePattern: resolveSimplePatternRequirement(password, policy, options.backendRequirements),
    passwordsMatch: hasConfirm ? password === confirmPassword && password.length > 0 : null,
  }

  const structuralValid =
    requirements.minLength === true &&
    requirements.maxLength === true &&
    requirements.uppercase === true &&
    requirements.lowercase === true &&
    requirements.number === true &&
    requirements.special === true &&
    (hasConfirm ? requirements.passwordsMatch === true : true)

  const securityValid =
    !needsSecurityCheck ||
    (password.length > 0 &&
      requirements.notBlocked === true &&
      requirements.notSimplePattern === true)

  const valid = structuralValid && securityValid

  const firstError =
    getStructuralPasswordError(password, policy, options) ??
    (options.backendSecurityValid === false
      ? options.backendSecurityError ?? "Password does not meet security requirements."
      : null)

  return {
    requirements,
    strength: calculateStructuralStrength(password, requirements),
    valid,
    firstError,
  }
}

export function isRequirementMet(
  key: PasswordRequirementKey,
  value: boolean | null,
): boolean {
  if (key === "passwordsMatch") return value === true
  return value === true
}
