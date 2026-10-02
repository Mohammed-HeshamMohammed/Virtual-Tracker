import { isAuthBackendApiPath } from "@/infrastructure/api/api-backend-routes"
import { getSecureApiBaseUrl } from "@/infrastructure/api/secure-transport"

const AUTH_DEV_PORT = 5712;
const DASHBOARD_DEV_PORT = 5713;
const isProductionBuild = process.env.NODE_ENV === "production";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

export function isUnifiedApiGatewayMode(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_URL?.trim());
}

function readGatewayUrl(): string | null {
  const gateway = process.env.NEXT_PUBLIC_API_URL?.trim();
  return gateway ? getSecureApiBaseUrl(trimTrailingSlash(gateway)) : null;
}

/**
 * Same-origin mode: the browser talks only to the dashboard's own host
 * (`/api/*` and the presence WebSocket), and Dashboard-Web's server forwards
 * those to the backends (see next.config.mjs). Corporate proxies / web filters
 * that block or redirect the separate `appapi.` and `auth.` hostnames - which
 * breaks CORS preflights - then only ever see the one host they already allow.
 * Build-time flag, like the other NEXT_PUBLIC_* variables.
 */
function readSameOriginBase(): string | null {
  if (process.env.NEXT_PUBLIC_API_SAME_ORIGIN !== "true") return null;
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function getAuthApiBaseUrl(): string {
  const sameOrigin = readSameOriginBase();
  if (sameOrigin !== null) return sameOrigin;
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

export function getDashboardApiBaseUrl(): string {
  const sameOrigin = readSameOriginBase();
  if (sameOrigin !== null) return sameOrigin;
  return getAgentApiBaseUrl();
}

/**
 * The backend host the desktop agent talks to. Unlike getDashboardApiBaseUrl()
 * this ignores same-origin mode, because the agent is built against the real
 * API host and the agent-link check compares against that.
 */
export function getAgentApiBaseUrl(): string {
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

export function resolveApiBaseUrlForPath(apiPath: string): string {
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  if (isAuthBackendApiPath(path)) return getAuthApiBaseUrl();
  return getDashboardApiBaseUrl();
}

export function getApiBaseUrl(): string {
  return getDashboardApiBaseUrl();
}

export function getDirectApiBaseUrl(): string {
  if (isUnifiedApiGatewayMode()) {
    return readGatewayUrl() ?? getDashboardApiBaseUrl();
  }
  return getDashboardApiBaseUrl();
}
