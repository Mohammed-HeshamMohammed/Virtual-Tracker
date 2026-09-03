import { resolveApiBaseUrlForPath } from "@/infrastructure/api/url"

export function apiPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = resolveApiBaseUrlForPath(normalized);
  return `${base}${normalized}`;
}
