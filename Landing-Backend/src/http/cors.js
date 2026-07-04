import { getEnv } from "../config/env.js";

/**
 * Registrable root domain derived from the configured frontend URL
 * (e.g. "myvirtualtracker.com" or "www.myvirtualtracker.com" -> "myvirtualtracker.com").
 * Used only to scope the credentialed session-proxy endpoints below — every
 * other route (contact form, health) stays wildcard CORS.
 */
function getCredentialedRootDomain() {
  try {
    const frontend = getEnv().urls.frontendOrigin || getEnv().urls.appPublicUrl;
    if (!frontend) return "";
    const host = new URL(frontend).hostname;
    if (host === "localhost" || /^[\d.]+$/.test(host)) return host;
    const parts = host.split(".");
    return parts.length <= 2 ? host : parts.slice(-2).join(".");
  } catch {
    return "";
  }
}

export function isCredentialedOriginAllowed(origin) {
  if (!origin) return false;
  const root = getCredentialedRootDomain();
  if (!root) return false;
  try {
    const host = new URL(origin).hostname;
    return host === root || host.endsWith(`.${root}`);
  } catch {
    return false;
  }
}

/**
 * CORS: the contact form and health check need no credentials, so they get
 * wildcard access. The session-status/session-logout proxy forwards the
 * shared session cookie and needs `Access-Control-Allow-Credentials` with an
 * explicit origin — pass `{ credentials: true }` only for those routes.
 *
 * @param {string | undefined} [origin]
 * @param {{ credentials?: boolean }} [opts]
 */
export function corsHeaders(origin, opts = {}) {
  if (opts.credentials && isCredentialedOriginAllowed(origin)) {
    return {
      "Access-Control-Allow-Origin": /** @type {string} */ (origin),
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function applyCors(res, origin, opts) {
  const headers = corsHeaders(origin, opts);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}
