import { getEnv } from "../../config/env.js";

export async function validatePasswordViaAuthBackend(password, options = {}) {
  const env = getEnv();
  const baseUrl = env.auth.backendUrl.replace(/\/+$/, "");

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
