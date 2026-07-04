/** Password policy config — all backend validation uses this. */

export const PASSWORD_POLICY_VERSION = "1.0.0";

export const PASSWORD_POLICY_LAST_UPDATED = "2026-06-11T00:00:00.000Z";

/** @type {const} */
export const PASSWORD_POLICY = {
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
};
