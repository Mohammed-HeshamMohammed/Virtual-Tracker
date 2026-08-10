import { getEnv } from "../config/env.js";

// Root domain for credentialed session-cookie routes only; other routes use wildcard CORS.
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

/** Wildcard CORS for Bearer-auth API. Session-cookie routes need `{ credentials: true }`. */
/**
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
