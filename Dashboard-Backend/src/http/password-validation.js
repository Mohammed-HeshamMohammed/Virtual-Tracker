import { validatePasswordViaAuthBackend } from "../lib/auth/auth-backend-client.js";
import { normalizePasswordInput } from "./password-request-guard.js";

/**
 * Registration password gate — Auth-Backend is authoritative.
 * Never log the password argument.
 *
 * @param {unknown} password
 * @param {{ confirmPassword?: unknown, requireConfirm?: boolean }} [options]
 * @returns {Promise<{ valid: boolean, error: string | null }>}
 */
export async function validateRegistrationPassword(password, options = {}) {
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

  return validatePasswordViaAuthBackend(password, {
    confirmPassword,
    requireConfirm: options.requireConfirm === true,
  });
}
