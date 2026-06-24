import { getApiBaseUrl } from "@/infrastructure/api/url"

/** Full URL for a Backend API path (path must start with `/api/`). */
export function apiPath(path: string): string {
  const base = getApiBaseUrl()
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`
}
