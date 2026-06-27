/**
 * Paths routed to Auth-Backend (must stay in sync with Virtual-Tracker/deploy/Caddyfile).
 */
export function isAuthBackendApiPath(pathname: string): boolean {
  const path = pathname.replace(/^\/api\/v1/, "/api").split("?")[0] ?? pathname;
  return path.startsWith("/api/auth/");
}
