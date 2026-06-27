import { isAuthBackendApiPath } from "@/infrastructure/api/api-backend-routes"
import { getSecureApiBaseUrl } from "@/infrastructure/api/secure-transport"

const AUTH_DEV_PORT = 5712;
const DASHBOARD_DEV_PORT = 5713;

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

  return `http://127.0.0.1:${AUTH_DEV_PORT}`;
}

/** Dashboard-Backend base URL (no trailing slash). */
export function getDashboardApiBaseUrl(): string {
  const gateway = readGatewayUrl();
  if (gateway) return gateway;

  const dashboardConfigured = process.env.NEXT_PUBLIC_DASHBOARD_API_URL?.trim();
  if (dashboardConfigured) return getSecureApiBaseUrl(trimTrailingSlash(dashboardConfigured));

  return `http://127.0.0.1:${DASHBOARD_DEV_PORT}`;
}

/** Pick Auth vs Dashboard base from an `/api/...` path. */
export function resolveApiBaseUrlForPath(apiPath: string): string {
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  if (isAuthBackendApiPath(path)) return getAuthApiBaseUrl();
  return getDashboardApiBaseUrl();
}

/**
 * Default API base — Dashboard-Backend in split dev, gateway URL in production.
 * Prefer `apiPath()` when building full URLs so auth routes hit the correct service.
 */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "");
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development" && !configured) {
    return getDirectApiBaseUrl();
  }
  if (configured) return getSecureApiBaseUrl(configured);
  return process.env.NODE_ENV === "production"
    ? getSecureApiBaseUrl("https://localhost:5713")
    : getDashboardApiBaseUrl();
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
