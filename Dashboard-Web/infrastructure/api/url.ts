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
