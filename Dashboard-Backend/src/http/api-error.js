import { sendJson } from "./response.js";

export function inferErrorCode(status, message = "") {
  const lower = message.toLowerCase();
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 410) return "GONE";
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many")) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL_ERROR";
  if (status === 400) return "BAD_REQUEST";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  return "REQUEST_FAILED";
}

export function enrichErrorPayload(status, payload) {
  if (!payload || typeof payload !== "object" || (payload).success !== false) {
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

export function sendPgConstraintError(res, origin, err, req) {
  if (!err || typeof err !== "object" || (err).code !== "23503") {
    return false;
  }
  sendApiError(
    res,
    origin,
    409,
    "stale_reference",
    "Someone deleted one of the selected items while you were editing. Reload to continue.",
    req,
  );
  return true;
}

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
