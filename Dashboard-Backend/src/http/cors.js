import { getEnv } from "../config/env.js";

/**
 * Registrable root domain derived from the configured frontend URL
 * (e.g. "app.myvirtualtracker.com" -> "myvirtualtracker.com"). Used only to
 * scope the credentialed session-cookie endpoints below — every other route
 * stays wildcard CORS since it never sends cookies.
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
 * CORS: this API authenticates every request with a Firebase Bearer token
 * (never cookies), so there is no credentialed cross-origin request to
 * protect against — allow any origin to read responses.
 *
 * The one exception is the session-cookie endpoints (used to share
 * sign-in state between the landing page and the dashboard subdomain),
 * which need `Access-Control-Allow-Credentials` and an explicit origin.
 * Pass `{ credentials: true }` only for those routes.
 *
 * @param {string | undefined} [origin]
 * @param {{ credentials?: boolean }} [opts]
 */
export function corsHeaders(origin, opts = {}) {
  if (opts.credentials && isCredentialedOriginAllowed(origin)) {
    return {
      "Access-Control-Allow-Origin": /** @type {string} */ (origin),
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      Vary: "Origin",
    };
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  };
}

export function applyCors(res, origin, opts) {
  const headers = corsHeaders(origin, opts);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}
