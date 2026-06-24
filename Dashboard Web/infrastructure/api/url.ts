import { getSecureApiBaseUrl } from "@/infrastructure/api/secure-transport"

/** Base URL for the Node API (no trailing slash). In browser dev, calls the API directly to avoid flaky Next.js proxy resets. */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "")
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    return getDirectApiBaseUrl()
  }
  if (configured) return getSecureApiBaseUrl(configured)
  return process.env.NODE_ENV === "production" ? getSecureApiBaseUrl("https://localhost:5712") : "http://localhost:5712"
}

/**
 * Direct Backend URL (bypasses Next.js dev rewrite proxy).
 * Uses 127.0.0.1 to avoid Windows resolving localhost to ::1 when the API is IPv4-only.
 */
export function getDirectApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "")
  if (configured) {
    return getSecureApiBaseUrl(configured)
  }
  return "http://localhost:5712"
}
