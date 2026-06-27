import { PASSWORD_POLICY } from "./definition.js";
import {
  COMMON_PASSWORD_SET,
  EXAMPLE_PASSWORD_SET,
  SEQUENTIAL_PATTERNS,
} from "./blacklists.js";

export const STRENGTH_LABELS = ["Weak", "Fair", "Good", "Strong", "Very Strong"];

const UPPERCASE_RE = /[A-Z]/;
const LOWERCASE_RE = /[a-z]/;
const NUMBER_RE = /[0-9]/;
const SPECIAL_RE = /[^A-Za-z0-9]/;

/**
 * @param {string} password
 */
function hasSequentialPattern(password) {
  if (!PASSWORD_POLICY.sequenceDetectionEnabled) return false;
  const lower = password.toLowerCase();
  for (const seq of SEQUENTIAL_PATTERNS) {
    const minChunk = Math.min(6, seq.length);
    for (let len = seq.length; len >= minChunk; len--) {
      for (let i = 0; i <= seq.length - len; i++) {
        const chunk = seq.slice(i, i + len);
        if (chunk.length >= 4 && lower.includes(chunk)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * @param {string} password
 */
function hasRepeatedPattern(password) {
  if (!PASSWORD_POLICY.repeatedPatternDetectionEnabled) return false;
  if (!password) return false;
  if (/(.)\1{5,}/.test(password)) return true;
  if (password.length >= PASSWORD_POLICY.minLength && /^(.)\1+$/.test(password)) return true;
  if (/(.{2})\1{4,}/.test(password)) return true;
  if (/(.{3})\1{3,}/.test(password)) return true;
  return false;
}

/**
 * @param {string} password
 */
function isCommonPassword(password) {
  if (!PASSWORD_POLICY.blockedPasswordsEnabled) return false;
  const normalized = password.trim().toLowerCase();
  if (COMMON_PASSWORD_SET.has(normalized)) return true;
  const alnum = normalized.replace(/[^a-z0-9]/g, "");
  return alnum.length > 0 && COMMON_PASSWORD_SET.has(alnum);
}

/**
 * @param {string} password
 */
function isExamplePassword(password) {
  if (!PASSWORD_POLICY.examplePasswordBlacklistEnabled) return false;
  return EXAMPLE_PASSWORD_SET.has(password.trim().toLowerCase());
}

/**
 * @param {string} password
 */
function isSimplePattern(password) {
  return hasSequentialPattern(password) || hasRepeatedPattern(password);
}

/**
 * @param {string} password
 * @param {{ confirmPassword?: string }} [options]
 */
export function analyzePassword(password, options = {}) {
  const confirmPassword = options.confirmPassword;
  const hasConfirm = typeof confirmPassword === "string";

  const requirements = {
    minLength: password.length >= PASSWORD_POLICY.minLength,
    maxLength: password.length <= PASSWORD_POLICY.maxLength,
    uppercase: !PASSWORD_POLICY.requireUppercase || UPPERCASE_RE.test(password),
    lowercase: !PASSWORD_POLICY.requireLowercase || LOWERCASE_RE.test(password),
    number: !PASSWORD_POLICY.requireNumber || NUMBER_RE.test(password),
    special: !PASSWORD_POLICY.requireSpecial || SPECIAL_RE.test(password),
    notBlocked:
      password.length > 0 ? !isCommonPassword(password) && !isExamplePassword(password) : false,
    notSimplePattern: password.length > 0 ? !isSimplePattern(password) : false,
    passwordsMatch: hasConfirm ? password === confirmPassword && password.length > 0 : null,
  };

  const coreValid =
    requirements.minLength &&
    requirements.maxLength &&
    requirements.uppercase &&
    requirements.lowercase &&
    requirements.number &&
    requirements.special &&
    requirements.notBlocked &&
    requirements.notSimplePattern;

  const valid = coreValid && (hasConfirm ? requirements.passwordsMatch === true : true);

  return {
    requirements,
    strength: calculateStrength(password, requirements),
    valid,
    firstError: getFirstPasswordError(password, options),
  };
}

/**
 * @param {string} password
 * @param {ReturnType<typeof analyzePassword>["requirements"]} requirements
 * @returns {"weak" | "fair" | "good" | "strong" | "very-strong"}
 */
function calculateStrength(password, requirements) {
  if (!password) return "weak";

  let score = 0;
  const length = password.length;

  if (length >= PASSWORD_POLICY.minLength) score += 12;
  if (length >= 12) score += 8;
  if (length >= 16) score += 10;
  if (length >= 20) score += 10;
  if (length >= 24) score += 5;

  const variety =
    Number(UPPERCASE_RE.test(password)) +
    Number(LOWERCASE_RE.test(password)) +
    Number(NUMBER_RE.test(password)) +
    Number(SPECIAL_RE.test(password));
  score += variety * 4;

  const uniqueChars = new Set(password).size;
  score += Math.round((uniqueChars / password.length) * 12);

  if (requirements.notBlocked) score += 8;
  if (requirements.notSimplePattern) score += 8;

  if (isCommonPassword(password) || isExamplePassword(password)) {
    score = Math.min(score, 15);
  } else if (isSimplePattern(password)) {
    score = Math.min(score, 25);
  }

  score = Math.max(0, Math.min(100, score));

  if (score < 20) return "weak";
  if (score < 40) return "fair";
  if (score < 60) return "good";
  if (score < 80) return "strong";
  return "very-strong";
}

/**
 * @param {"weak" | "fair" | "good" | "strong" | "very-strong"} strength
 */
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
 * @param {string} password
 * @param {{ confirmPassword?: string, requireConfirm?: boolean }} [options]
 * @returns {string | null}
 */
export function getFirstPasswordError(password, options = {}) {
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
  if (isExamplePassword(password)) {
    return "This password is not allowed. Choose a unique password that is not used in examples.";
  }
  if (isCommonPassword(password)) {
    return "This password is too common. Choose a more unique password.";
  }
  if (isSimplePattern(password)) {
    return "This password contains an obvious pattern. Choose something less predictable.";
  }

  const confirmPassword = options.confirmPassword;
  if (options.requireConfirm || typeof confirmPassword === "string") {
    if (password !== confirmPassword) {
      return "Passwords do not match.";
    }
  }

  return null;
}

/**
 * @param {string} password
 * @param {{ confirmPassword?: string, requireConfirm?: boolean }} [options]
 */
export function validatePassword(password, options = {}) {
  const analysis = analyzePassword(password, options);
  const error = getFirstPasswordError(password, options);
  return {
    valid: analysis.valid && !error,
    error,
    analysis,
  };
}
