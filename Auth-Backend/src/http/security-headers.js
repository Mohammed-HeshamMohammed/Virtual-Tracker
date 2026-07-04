/** Baseline security headers (HSTS in production over HTTPS). */

import { getEnv } from "../config/env.js";

/**
 * @param {import("node:http").IncomingMessage} [req]
 */
export function getSecurityHeaders(req) {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
    "Cache-Control": "no-store",
  };

  if (getEnv().isProduction) {
    const proto = typeof req?.headers?.["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"] : "";
    if (!proto || proto === "https") {
      headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    }
  }

  return headers;
}
