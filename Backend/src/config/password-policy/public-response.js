import { PASSWORD_POLICY } from "./definition.js";

/**
 * Public-safe password policy payload for UI guidance.
 * Consumers: GET /api/auth/password-policy
 */
export function getPublicPasswordPolicyResponse() {
  return {
    passwordPolicy: {
      minLength: PASSWORD_POLICY.minLength,
      maxLength: PASSWORD_POLICY.maxLength,
      requireUppercase: PASSWORD_POLICY.requireUppercase,
      requireLowercase: PASSWORD_POLICY.requireLowercase,
      requireNumber: PASSWORD_POLICY.requireNumber,
      requireSpecial: PASSWORD_POLICY.requireSpecial,
      blockedPasswordsEnabled: PASSWORD_POLICY.blockedPasswordsEnabled,
      sequenceDetectionEnabled: PASSWORD_POLICY.sequenceDetectionEnabled,
      repeatedPatternDetectionEnabled: PASSWORD_POLICY.repeatedPatternDetectionEnabled,
      examplePasswordBlacklistEnabled: PASSWORD_POLICY.examplePasswordBlacklistEnabled,
      passwordExpirationDays: PASSWORD_POLICY.passwordExpirationDays,
      requireMfa: PASSWORD_POLICY.requireMfa,
      entropyCheckEnabled: true,
      minZxcvbnScore: PASSWORD_POLICY.minZxcvbnScore,
    },
  };
}
