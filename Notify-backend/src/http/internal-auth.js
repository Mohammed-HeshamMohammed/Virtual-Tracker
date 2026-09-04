import { timingSafeEqual } from "node:crypto";
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
  if (!safeEqual(token, secret)) {
    sendJson(res, origin, 401, { success: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

requireInternalAuth._warnedOnce = false;

/**
 * Constant-time comparison of the presented token against the shared secret.
 *
 * `token !== secret` short-circuits at the first differing byte, so response
 * time leaks how much of the secret a guess got right - enough to recover it
 * byte by byte from off-box. timingSafeEqual has no such shortcut, but it
 * throws on length mismatch, so lengths are compared first and that comparison
 * is the only thing this leaks (the length of a secret is not the secret).
 */
function safeEqual(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function resolveSecret() {
  try {
    return { secret: getEnv().security.internalServiceSecret || "" };
  } catch {
    return { secret: "" };
  }
}
