import { validatePassword } from "../../../config/password-policy/index.js";
import { normalizePasswordInput } from "../security/password-request-guard.js";

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
