import { getEnv } from "../config/env.js";
import { sendJson } from "./response.js";

export function requireInternalAuth(req, res, origin) {
  const { secret } = resolveSecret();

  if (!secret) {
    if (!requireInternalAuth._warnedOnce) {
      requireInternalAuth._warnedOnce = true;
      console.warn(
        "[auth] INTERNAL_SERVICE_SECRET is not set. " +
        "All requests are accepted. Set the secret before deploying to production.",
      );
    }
    return true;
  }

  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token !== secret) {
    sendJson(res, origin, 401, { success: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

requireInternalAuth._warnedOnce = false;

function resolveSecret() {
  try {
    return { secret: getEnv().security.internalServiceSecret || "" };
  } catch {
    return { secret: "" };
  }
}
