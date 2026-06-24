import type { PasswordPolicyResponse } from "@/features/auth/services/password-policy/types"

/** Safe fallback when the policy endpoint is temporarily unavailable. */
export const FALLBACK_PASSWORD_POLICY: PasswordPolicyResponse = {
  version: "1.0.0",
  lastUpdated: "2026-06-11T00:00:00.000Z",
  passwordPolicy: {
    minLength: 10,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
    blockedPasswordsEnabled: true,
    sequenceDetectionEnabled: true,
    repeatedPatternDetectionEnabled: true,
    examplePasswordBlacklistEnabled: true,
    passwordExpirationDays: null,
    requireMfa: false,
  },
}
