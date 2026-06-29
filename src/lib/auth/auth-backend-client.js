/**
 * Calls Auth-Backend for password policy validation.
 * Dashboard-Backend must not duplicate password-policy logic.
 */
import { getEnv } from "../../config/env.js";

/**
 * @param {string} password
 * @param {{ confirmPassword?: string; requireConfirm?: boolean }} [options]
 * @returns {Promise<{ valid: boolean; error: string | null }>}
 */
export async function validatePasswordViaAuthBackend(password, options = {}) {
  const env = getEnv();
  const baseUrl = (env.auth.backendUrl || "http://localhost:5712").replace(/\/+$/, "");

  const body = { password };
  if (typeof options.confirmPassword === "string") {
    body.confirmPassword = options.confirmPassword;
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/api/auth/validate-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { valid: false, error: "Password validation is temporarily unavailable." };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    return { valid: false, error: "Password validation is temporarily unavailable." };
  }

  if (response.ok && payload?.success === true && payload?.valid === true) {
    return { valid: true, error: null };
  }

  const message =
    typeof payload?.error === "string" && payload.error.trim()
      ? payload.error
      : "Password does not meet security requirements.";
  return { valid: false, error: message };
}
