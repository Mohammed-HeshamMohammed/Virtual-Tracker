import { ZxcvbnFactory, Options } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary as commonDictionary } from "@zxcvbn-ts/language-common";
import { translations, dictionary as enDictionary } from "@zxcvbn-ts/language-en";
import { PASSWORD_POLICY } from "./definition.js";
import { CUSTOM_DICTIONARY } from "./blacklists.js";

/* ------------------------------------------------------------------ */
/*  One-time zxcvbn configuration (runs on first import)              */
/* ------------------------------------------------------------------ */

const zxcvbnOptions = new Options({
  translations,
  graphs: adjacencyGraphs,
  dictionary: {
    ...commonDictionary,
    ...enDictionary,
    /* Application-specific terms injected alongside the standard dicts */
    userInputs: CUSTOM_DICTIONARY.map((w) => w.toLowerCase()),
  },
});

const zxcvbnInstance = new ZxcvbnFactory(zxcvbnOptions);

/* ------------------------------------------------------------------ */
/*  Strength labels                                                   */
/* ------------------------------------------------------------------ */

export const STRENGTH_LABELS = ["Weak", "Fair", "Good", "Strong", "Very Strong"];

const SCORE_TO_STRENGTH = ["weak", "fair", "good", "strong", "very-strong"];

/* ------------------------------------------------------------------ */
/*  Structural pre-checks (fast, before calling zxcvbn)               */
/* ------------------------------------------------------------------ */

const UPPERCASE_RE = /[A-Z]/;
const LOWERCASE_RE = /[a-z]/;
const NUMBER_RE = /[0-9]/;
const SPECIAL_RE = /[^A-Za-z0-9]/;

/**
 * Returns the first structural (character-class / length) error, or null.
 * These run before zxcvbn so callers get instant feedback on basic rules.
 */
function getStructuralError(password) {
  if (!password) return "Password is required.";

  if (password.length < PASSWORD_POLICY.minLength) {
    return `Password must be at least ${PASSWORD_POLICY.minLength} characters.`;
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    return `Password must be at most ${PASSWORD_POLICY.maxLength} characters.`;
  }
  if (PASSWORD_POLICY.requireUppercase && !UPPERCASE_RE.test(password)) {
    return "Password must contain at least one uppercase letter.";
  }
  if (PASSWORD_POLICY.requireLowercase && !LOWERCASE_RE.test(password)) {
    return "Password must contain at least one lowercase letter.";
  }
  if (PASSWORD_POLICY.requireNumber && !NUMBER_RE.test(password)) {
    return "Password must contain at least one number.";
  }
  if (PASSWORD_POLICY.requireSpecial && !SPECIAL_RE.test(password)) {
    return "Password must contain at least one special character.";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Core analysis (zxcvbn-powered)                                    */
/* ------------------------------------------------------------------ */

/**
 * Full password analysis. This is the main entry point.
 *
 * @param {string} password
 * @param {{ confirmPassword?: string; userInputs?: string[] }} [options]
 */
export function analyzePassword(password, options = {}) {
  const confirmPassword = options.confirmPassword;
  const hasConfirm = typeof confirmPassword === "string";

  /* --- Structural requirements (character-class checks) --- */
  const structReqs = {
    minLength: password.length >= PASSWORD_POLICY.minLength,
    maxLength: password.length <= PASSWORD_POLICY.maxLength,
    uppercase: !PASSWORD_POLICY.requireUppercase || UPPERCASE_RE.test(password),
    lowercase: !PASSWORD_POLICY.requireLowercase || LOWERCASE_RE.test(password),
    number: !PASSWORD_POLICY.requireNumber || NUMBER_RE.test(password),
    special: !PASSWORD_POLICY.requireSpecial || SPECIAL_RE.test(password),
  };

  const structuralOk = Object.values(structReqs).every(Boolean);

  /* --- zxcvbn entropy analysis --- */
  const zResult = password.length > 0 ? zxcvbnInstance.check(password) : null;
  const score = zResult ? zResult.score : 0; // 0-4
  const meetsEntropy = score >= PASSWORD_POLICY.minZxcvbnScore;

  /* --- Derived requirements exposed in the API response --- */
  const requirements = {
    ...structReqs,
    // `notBlocked` and `notSimplePattern` are kept for backward compat.
    // zxcvbn subsumes both: a blocked/patterned password scores 0-1.
    notBlocked: meetsEntropy,
    notSimplePattern: meetsEntropy,
    passwordsMatch: hasConfirm ? password === confirmPassword && password.length > 0 : null,
  };

  const coreValid =
    structuralOk &&
    meetsEntropy &&
    (hasConfirm ? requirements.passwordsMatch === true : true);

  return {
    requirements,
    strength: SCORE_TO_STRENGTH[score] || "weak",
    valid: coreValid,
    firstError: getFirstPasswordError(password, options),
    /* zxcvbn details (useful for debugging; not exposed to the client) */
    zxcvbn: zResult
      ? {
          score: zResult.score,
          warning: zResult.feedback?.warning || "",
          suggestions: zResult.feedback?.suggestions || [],
          guesses: zResult.guesses,
          calcTime: zResult.calcTime,
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Error messages                                                    */
/* ------------------------------------------------------------------ */

/**
 * Returns the first human-readable validation error, or null if valid.
 *
 * @param {string} password
 * @param {{ confirmPassword?: string; requireConfirm?: boolean; userInputs?: string[] }} [options]
 */
export function getFirstPasswordError(password, options = {}) {
  /* Fast structural check */
  const structError = getStructuralError(password);
  if (structError) return structError;

  /* zxcvbn entropy check */
  const zResult = zxcvbnInstance.check(password);

  if (zResult.score < PASSWORD_POLICY.minZxcvbnScore) {
    // Return the library's own user-friendly warning when available
    if (zResult.feedback?.warning) {
      return zResult.feedback.warning;
    }
    // Otherwise fall back to a generic message
    return "This password is too easy to guess. Try adding more uncommon words or mixing in symbols.";
  }

  /* Confirm check */
  const confirmPassword = options.confirmPassword;
  if (options.requireConfirm || typeof confirmPassword === "string") {
    if (password !== confirmPassword) {
      return "Passwords do not match.";
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Convenience helpers                                               */
/* ------------------------------------------------------------------ */

export function strengthToLabel(strength) {
  switch (strength) {
    case "weak":
      return "Weak";
    case "fair":
      return "Fair";
    case "good":
      return "Good";
    case "strong":
      return "Strong";
    case "very-strong":
      return "Very Strong";
    default:
      return "Weak";
  }
}

/**
 * Top-level validate helper — backward-compatible return shape.
 *
 * @param {string} password
 * @param {{ confirmPassword?: string; requireConfirm?: boolean; userInputs?: string[] }} [options]
 */
export function validatePassword(password, options = {}) {
  const analysis = analyzePassword(password, options);
  const error = analysis.firstError;
  return {
    valid: analysis.valid && !error,
    error,
    analysis,
  };
}
