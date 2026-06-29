import { resolveApiBaseUrlForPath } from "@/infrastructure/api/url"

/** Full URL for a Backend API path (path must start with `/api/`). Routes auth vs dashboard automatically. */
export function apiPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = resolveApiBaseUrlForPath(normalized);
  return `${base}${normalized}`;
}
