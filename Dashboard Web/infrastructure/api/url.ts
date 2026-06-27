import { getSecureApiBaseUrl } from "@/infrastructure/api/secure-transport"

const DASHBOARD_API_DEV_DEFAULT = "http://localhost:5713"

function requireProductionAuthApiUrl(): string {
  throw new Error(
    "NEXT_PUBLIC_AUTH_API_URL must be set at build time (e.g. https://auth.yourdomain.com)",
  )
}

/** Base URL for the dashboard Node API (no trailing slash). */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "")
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    return getDirectApiBaseUrl()
  }
  if (configured) return getSecureApiBaseUrl(configured)
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_API_URL must be set at build time")
  }
  return DASHBOARD_API_DEV_DEFAULT
}

/** Base URL for the auth Node API (no trailing slash). */
export function getAuthApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_AUTH_API_URL?.trim().replace(/\/$/, "")
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    return getDirectAuthApiBaseUrl()
  }
  if (configured) return getSecureApiBaseUrl(configured)
  if (process.env.NODE_ENV === "production") {
    return requireProductionAuthApiUrl()
  }
  return getDirectAuthApiBaseUrl()
}

/**
 * Direct dashboard backend URL (bypasses Next.js dev rewrite proxy).
 */
export function getDirectApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "")
  if (configured) {
    return getSecureApiBaseUrl(configured)
  }
  return DASHBOARD_API_DEV_DEFAULT
}

/** Direct auth backend URL (bypasses Next.js dev rewrite proxy). */
export function getDirectAuthApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_AUTH_API_URL?.trim().replace(/\/$/, "")
  if (configured) {
    return getSecureApiBaseUrl(configured)
  }
  if (process.env.NODE_ENV === "production") {
    return requireProductionAuthApiUrl()
  }
  return "http://localhost:5712"
}
