import type { ChecklistItem, PasswordPolicyRules } from "@/features/auth/services/password-policy/types"

export function buildPasswordChecklist(policy: PasswordPolicyRules): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { key: "minLength", label: `Minimum ${policy.minLength} characters` },
  ]

  if (policy.requireUppercase) {
    items.push({ key: "uppercase", label: "Uppercase letter" })
  }
  if (policy.requireLowercase) {
    items.push({ key: "lowercase", label: "Lowercase letter" })
  }
  if (policy.requireNumber) {
    items.push({ key: "number", label: "Number" })
  }
  if (policy.requireSpecial) {
    items.push({ key: "special", label: "Special character" })
  }
  if (
    policy.blockedPasswordsEnabled ||
    policy.examplePasswordBlacklistEnabled
  ) {
    items.push({ key: "notBlocked", label: "Not a common password" })
  }
  if (policy.sequenceDetectionEnabled || policy.repeatedPatternDetectionEnabled) {
    items.push({ key: "notSimplePattern", label: "Not a simple pattern" })
  }

  items.push({ key: "passwordsMatch", label: "Passwords match", showWhenEmpty: true })
  return items
}
