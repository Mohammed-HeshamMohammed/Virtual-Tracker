/** Dashboard app URL when deployed separately (e.g. https://app.yourdomain.com). */
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL?.trim() || "https://app.myvirtualtracker.com"

export function getDashboardUrl(): string | null {
  return DASHBOARD_URL.length > 0 ? DASHBOARD_URL : null
}

export function isDashboardConfigured(): boolean {
  return getDashboardUrl() !== null
}

/** Sign-in: dashboard when configured, otherwise the landing sign-in page. */
export function getSignInHref(): string {
  return getDashboardUrl() ?? "/sign-in"
}

/** Free trial / try now: dashboard when configured, otherwise the demo page. */
export function getTrialHref(): string {
  return getDashboardUrl() ?? "/demo"
}

import { safeHref } from "@/lib/safe"

export function isExternalHref(href: string): boolean {
  const value = safeHref(href, "")
  return value.startsWith("http://") || value.startsWith("https://")
}
