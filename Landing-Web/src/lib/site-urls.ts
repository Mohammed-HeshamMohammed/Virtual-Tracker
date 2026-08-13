/** Dashboard app URL when deployed separately (e.g. https://app.yourdomain.com). */
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL?.trim() ?? ""

export function getDashboardUrl(): string | null {
  return DASHBOARD_URL.length > 0 ? DASHBOARD_URL : null
}

export function isDashboardConfigured(): boolean {
  return getDashboardUrl() !== null
}

/** Sign-in always happens on Landing-Web's own sign-in/sign-up page. */
export function getSignInHref(): string {
  return "/sign-in"
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

const LANDING_API_URL = process.env.NEXT_PUBLIC_LANDING_API_URL?.trim() ?? ""

export function getAgentDownloadUrl(platform: "windows" | "mac" | "linux" = "windows"): string {
  const base = LANDING_API_URL || ""
  return `${base}/api/download?platform=${platform}`
}

