/**
 * Paths routed to Auth-Backend (must stay in sync with Virtual-Tracker/deploy/Caddyfile).
 */
export function isAuthBackendApiPath(pathname: string): boolean {
  const path = pathname.replace(/^\/api\/v1/, "/api").split("?")[0] ?? pathname;

  if (path.startsWith("/api/auth/")) return true;
  if (path.startsWith("/api/public/invites/")) return true;
  if (path === "/api/invites/open-link") return true;
  if (path === "/api/members/preprovision") return true;
  if (path === "/api/members/validate-add") return true;
  if (path.startsWith("/api/member-onboarding")) return true;
  if (/^\/api\/invites\/[^/]+\/(resend|link|renew)$/.test(path)) return true;
  if (/^\/api\/invites\/pa_[^/]+$/.test(path)) return true;

  return false;
}
