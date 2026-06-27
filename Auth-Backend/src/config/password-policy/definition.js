/**
 * Structural password rules enforced on top of zxcvbn entropy analysis.
 *
 * zxcvbn handles dictionary, l33t-speak, spatial keyboard, repeated pattern,
 * and sequence detection internally. The flags below are kept for the public
 * policy response consumed by the frontend UI (e.g. inline requirement chips)
 * and for the simple pre-checks that run *before* the heavier zxcvbn call.
 *
 * @type {const}
 */
export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 128,

  /* Structural character-class requirements (pre-check before zxcvbn). */
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,

  /**
   * Minimum zxcvbn score (0-4) a password must reach to be accepted.
   *   0 = too guessable
   *   1 = very guessable
   *   2 = somewhat guessable
   *   3 = safely unguessable          ← default threshold
   *   4 = very unguessable
   */
  minZxcvbnScore: 3,

  /* Legacy flags — these features are now handled by zxcvbn internally.
     Kept `true` so the public policy response still informs the frontend. */
  blockedPasswordsEnabled: true,
  sequenceDetectionEnabled: true,
  repeatedPatternDetectionEnabled: true,
  examplePasswordBlacklistEnabled: true,

  passwordExpirationDays: null,
  requireMfa: false,
};
