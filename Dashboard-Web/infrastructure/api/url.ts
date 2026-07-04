import { isAuthBackendApiPath } from "@/infrastructure/api/api-backend-routes"
import { getSecureApiBaseUrl } from "@/infrastructure/api/secure-transport"

// Local-dev-only fallbacks — never used in a production build (guarded below).
// These exist so `next dev` works without a `.env.local` file.
const AUTH_DEV_PORT = 5712;
const DASHBOARD_DEV_PORT = 5713;
const isProductionBuild = process.env.NODE_ENV === "production";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

/** True when a single gateway URL serves both backends (production Docker / VPS). */
export function isUnifiedApiGatewayMode(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_URL?.trim());
}

function readGatewayUrl(): string | null {
  const gateway = process.env.NEXT_PUBLIC_API_URL?.trim();
  return gateway ? getSecureApiBaseUrl(trimTrailingSlash(gateway)) : null;
}

/** Auth-Backend base URL (no trailing slash). */
export function getAuthApiBaseUrl(): string {
  const gateway = readGatewayUrl();
  if (gateway) return gateway;

  const authConfigured = process.env.NEXT_PUBLIC_AUTH_API_URL?.trim();
  if (authConfigured) return getSecureApiBaseUrl(trimTrailingSlash(authConfigured));

  if (isProductionBuild) {
    throw new Error(
      "Auth-Backend URL is not configured. Set NEXT_PUBLIC_API_URL (unified gateway) or NEXT_PUBLIC_AUTH_API_URL as a build-time variable and rebuild.",
    );
  }
  return `http://127.0.0.1:${AUTH_DEV_PORT}`;
}

/** Dashboard-Backend base URL (no trailing slash). */
export function getDashboardApiBaseUrl(): string {
  const gateway = readGatewayUrl();
  if (gateway) return gateway;

  const dashboardConfigured = process.env.NEXT_PUBLIC_DASHBOARD_API_URL?.trim();
  if (dashboardConfigured) return getSecureApiBaseUrl(trimTrailingSlash(dashboardConfigured));

  if (isProductionBuild) {
    throw new Error(
      "Dashboard-Backend URL is not configured. Set NEXT_PUBLIC_API_URL (unified gateway) or NEXT_PUBLIC_DASHBOARD_API_URL as a build-time variable and rebuild.",
    );
  }
  return `http://127.0.0.1:${DASHBOARD_DEV_PORT}`;
}

/** Pick Auth vs Dashboard base from an `/api/...` path. */
export function resolveApiBaseUrlForPath(apiPath: string): string {
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  if (isAuthBackendApiPath(path)) return getAuthApiBaseUrl();
  return getDashboardApiBaseUrl();
}

/**
 * Dashboard-Backend base URL only — does not route Auth-Backend paths.
 * Prefer `apiPath("/api/...")` so auth vs dashboard hosts are chosen automatically.
 * @deprecated Use `apiPath()` for request URLs; use `getDashboardApiBaseUrl()` if you need the base alone.
 */
export function getApiBaseUrl(): string {
  return getDashboardApiBaseUrl();
}

/**
 * Direct API URL in the browser (bypasses Next.js dev rewrites).
 * Split dev: dashboard port; unified: configured gateway.
 */
export function getDirectApiBaseUrl(): string {
  if (isUnifiedApiGatewayMode()) {
    return readGatewayUrl() ?? getDashboardApiBaseUrl();
  }
  return getDashboardApiBaseUrl();
}
