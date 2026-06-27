import { validatePassword } from "../config/password-policy/index.js";
import { normalizePasswordInput } from "./password-request-guard.js";

/**
 * Registration password gate — backend is authoritative (Engineering Constitution §3–4).
 * Never log the password argument.
 *
 * @param {unknown} password
 * @param {{ confirmPassword?: unknown, requireConfirm?: boolean }} [options]
 * @returns {{ valid: boolean, error: string | null }}
 */
export function validateRegistrationPassword(password, options = {}) {
  const passwordError = normalizePasswordInput(password);
  if (passwordError) {
    return { valid: false, error: passwordError };
  }

  const confirmPassword = typeof options.confirmPassword === "string" ? options.confirmPassword : undefined;
  if (typeof confirmPassword === "string") {
    const confirmError = normalizePasswordInput(confirmPassword);
    if (confirmError) {
      return { valid: false, error: confirmError };
    }
  }
  const result = validatePassword(password, {
    confirmPassword,
    requireConfirm: options.requireConfirm === true,
  });

  return {
    valid: result.valid,
    error: result.error,
  };
}
