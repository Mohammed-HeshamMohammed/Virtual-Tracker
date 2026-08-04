/** `/api/auth/*` routes served by this service (authentication only). */

const AUTHN_EXACT = new Set([
  "/api/auth/firebase-config",
  "/api/auth/readiness",
  "/api/auth/password-policy",
  "/api/auth/validate-password",
  "/api/auth/verify",
  "/api/auth/resolve-sign-in-methods",
  "/api/auth/google/start",
  "/api/auth/google/callback",
]);

/**
 * @param {string} pathname
 */
export function isAuthnApiPath(pathname) {
  const path = pathname.replace(/^\/api\/v1\//, "/api/").split("?")[0] ?? pathname;
  return AUTHN_EXACT.has(path);
}
