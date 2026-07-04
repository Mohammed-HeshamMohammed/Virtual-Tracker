import { getEnv } from "../../config/env.js";

const SESSION_COOKIE_NAME = "vt_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

const SESSION_COOKIE_PATHS = new Set([
  "/api/auth/session-cookie",
  "/api/auth/session-status",
  "/api/auth/session-logout",
  "/api/v1/auth/session-cookie",
  "/api/v1/auth/session-status",
  "/api/v1/auth/session-logout",
]);

/** @param {string} pathname */
export function isSessionCookiePath(pathname) {
  return SESSION_COOKIE_PATHS.has(pathname);
}

/** Parent domain so the cookie is readable from both the landing page and the dashboard subdomain. */
function getCookieDomain() {
  try {
    const frontend = getEnv().urls.frontendOrigin || getEnv().urls.appPublicUrl;
    if (!frontend) return "";
    const host = new URL(frontend).hostname;
    if (host === "localhost" || /^[\d.]+$/.test(host)) return "";
    const parts = host.split(".");
    if (parts.length <= 2) return "";
    return `.${parts.slice(-2).join(".")}`;
  } catch {
    return "";
  }
}

/** @param {string} sessionCookieValue */
export function buildSessionCookieHeader(sessionCookieValue) {
  const domain = getCookieDomain();
  const secure = getEnv().isProduction ? "; Secure" : "";
  const domainPart = domain ? `; Domain=${domain}` : "";
  return `${SESSION_COOKIE_NAME}=${sessionCookieValue}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${domainPart}${secure}`;
}

export function buildClearSessionCookieHeader() {
  const domain = getCookieDomain();
  const secure = getEnv().isProduction ? "; Secure" : "";
  const domainPart = domain ? `; Domain=${domain}` : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${domainPart}${secure}`;
}

/** @param {import("node:http").IncomingMessage} req */
export function readSessionCookie(req) {
  const header = req.headers.cookie;
  if (!header) return "";
  const match = header.match(new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}
