import { sendJson } from "./response.js";

/**
 * @param {number} status
 * @param {string} [message]
 */
export function inferErrorCode(status, message = "") {
  const lower = message.toLowerCase();
  if (status === 400) return "BAD_REQUEST";
  if (status === 404) return "NOT_FOUND";
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many")) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL_ERROR";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  return "REQUEST_FAILED";
}

/** Add errorDetail to legacy `{ success: false, error }` responses. */
export function enrichErrorPayload(status, payload) {
  if (!payload || typeof payload !== "object" || /** @type {{ success?: boolean }} */ (payload).success !== false) {
    return payload;
  }
  const body = /** @type {{ error?: string, errorDetail?: { code?: string, message?: string } }} */ (payload);
  if (typeof body.error !== "string" || !body.error.trim()) return payload;
  if (body.errorDetail && typeof body.errorDetail === "object" && body.errorDetail.code) return payload;
  return {
    ...body,
    errorDetail: {
      code: inferErrorCode(status, body.error),
      message: body.error,
    },
  };
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {import("node:http").IncomingMessage} [req]
 */
export function sendApiError(res, origin, status, code, message, req) {
  sendJson(
    res,
    origin,
    status,
    {
      success: false,
      error: message,
      errorDetail: {
        code,
        message,
      },
    },
    req,
  );
}
