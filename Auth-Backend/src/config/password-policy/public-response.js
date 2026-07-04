import {
  PASSWORD_POLICY,
  PASSWORD_POLICY_LAST_UPDATED,
  PASSWORD_POLICY_VERSION,
} from "./definition.js";

// Password policy for UI — no blacklists or scoring internals.
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
