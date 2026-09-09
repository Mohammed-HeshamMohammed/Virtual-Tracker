
const AUTH_DEV_PORT = 5712
const DASHBOARD_DEV_PORT = 5713
const isProductionBuild = process.env.NODE_ENV === "production"

const AUTHN_EXACT = new Set([
  "/api/auth/firebase-config",
  "/api/auth/readiness",
  "/api/auth/password-policy",
  "/api/auth/validate-password",
  "/api/auth/verify",
  "/api/auth/resolve-sign-in-methods",
])

export function isAuthBackendApiPath(pathname: string): boolean {
  return AUTHN_EXACT.has(pathname.split("?")[0] ?? pathname)
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "")
}

function assertHttpsInProduction(baseUrl: string): string {
  const trimmed = trimTrailingSlash(baseUrl.trim())
  if (!trimmed) return trimmed
  if (isProductionBuild && trimmed.startsWith("http://")) {
    const host = trimmed.replace(/^https?:\/\//, "").split("/")[0]?.split(":")[0] ?? ""
    if (!/^(localhost|127\.0\.0\.1)$/i.test(host)) {
      throw new Error("API requests must use HTTPS in production.")
    }
  }
  return trimmed
}

export function getAuthApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_AUTH_API_URL?.trim()
  if (configured) return assertHttpsInProduction(configured)
  if (isProductionBuild) {
    throw new Error("Auth-Backend URL is not configured. Set NEXT_PUBLIC_AUTH_API_URL as a build-time variable and rebuild.")
  }
  return `http://127.0.0.1:${AUTH_DEV_PORT}`
}

export function getDashboardApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DASHBOARD_API_URL?.trim()
  if (configured) return assertHttpsInProduction(configured)
  if (isProductionBuild) {
    throw new Error("Dashboard-Backend URL is not configured. Set NEXT_PUBLIC_DASHBOARD_API_URL as a build-time variable and rebuild.")
  }
  return `http://127.0.0.1:${DASHBOARD_DEV_PORT}`
}

export function apiPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  const base = isAuthBackendApiPath(normalized) ? getAuthApiBaseUrl() : getDashboardApiBaseUrl()
  return `${base}${normalized}`
}
