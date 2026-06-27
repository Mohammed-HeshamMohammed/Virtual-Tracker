import { getSecureApiBaseUrl } from "@/infrastructure/api/secure-transport"

const AUTH_API_DEV_DEFAULT = "http://localhost:5712"
const DASHBOARD_API_DEV_DEFAULT = "http://localhost:5713"

/** Base URL for the dashboard Node API (no trailing slash). */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "")
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    return getDirectApiBaseUrl()
  }
  if (configured) return getSecureApiBaseUrl(configured)
  return process.env.NODE_ENV === "production"
    ? getSecureApiBaseUrl("https://localhost:5713")
    : DASHBOARD_API_DEV_DEFAULT
}

/** Base URL for the auth Node API (no trailing slash). */
export function getAuthApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_AUTH_API_URL?.trim().replace(/\/$/, "")
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    return getDirectAuthApiBaseUrl()
  }
  if (configured) return getSecureApiBaseUrl(configured)
  return process.env.NODE_ENV === "production"
    ? getSecureApiBaseUrl("https://localhost:5712")
    : AUTH_API_DEV_DEFAULT
}

/**
 * Direct dashboard backend URL (bypasses Next.js dev rewrite proxy).
 * Uses 127.0.0.1 to avoid Windows resolving localhost to ::1 when the API is IPv4-only.
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
  return AUTH_API_DEV_DEFAULT
}
