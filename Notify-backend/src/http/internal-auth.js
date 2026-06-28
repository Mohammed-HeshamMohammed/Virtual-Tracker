/**
 * Internal auth guard.
 *
 * All requests to Notify-Backend must carry the shared secret in the
 * Authorization header: `Bearer <INTERNAL_SERVICE_SECRET>`.
 *
 * In development with no secret configured, the guard is skipped so
 * local smoke tests work without any credentials.
 */
import { getEnv } from "../config/env.js";
import { sendJson } from "./response.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @returns {boolean} true if the request is authorized (caller may continue)
 */
export function requireInternalAuth(req, res, origin) {
  const { secret } = resolveSecret();

  // Skip guard in dev when no secret is configured — warn once.
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
