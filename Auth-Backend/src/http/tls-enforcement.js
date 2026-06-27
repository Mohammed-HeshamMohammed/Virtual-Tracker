import { getEnv } from "../config/env.js";

/**
 * Enforce HTTPS for production API traffic behind reverse proxies.
 * Development localhost HTTP remains allowed.
 */

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {{ status: number, error: string } | null}
 */
export function assertSecureTransport(req) {
  const { isProduction, security } = getEnv();
  if (!isProduction) return null;
  if (security.allowInsecureHttp) return null;

  const host = typeof req.headers.host === "string" ? req.headers.host : "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return null;
  }

  const forwarded = typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"] : "";
  if (forwarded && forwarded !== "https") {
    return { status: 403, error: "HTTPS is required." };
  }

  return null;
}
