import {
  PASSWORD_POLICY,
  PASSWORD_POLICY_LAST_UPDATED,
  PASSWORD_POLICY_VERSION,
} from "./definition.js";

/**
 * Public-safe password policy payload for UI guidance.
 * Does not expose blacklists, scoring algorithms, or internal security data.
 */
export function getPublicPasswordPolicyResponse() {
  return {
    version: PASSWORD_POLICY_VERSION,
    lastUpdated: PASSWORD_POLICY_LAST_UPDATED,
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
    },
  };
}
