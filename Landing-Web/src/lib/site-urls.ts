const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL?.trim() ?? ""

export function getDashboardUrl(): string | null {
  return DASHBOARD_URL.length > 0 ? DASHBOARD_URL : null
}

export function isDashboardConfigured(): boolean {
  return getDashboardUrl() !== null
}

export function getSignInHref(): string {
  return "/sign-in"
}

export function getTrialHref(): string {
  return getDashboardUrl() ?? "/demo"
}

import { safeHref } from "@/lib/safe"

export function isExternalHref(href: string): boolean {
  const value = safeHref(href, "")
  return value.startsWith("http://") || value.startsWith("https://")
}

const LANDING_API_URL = process.env.NEXT_PUBLIC_LANDING_API_URL?.trim() ?? ""

/** `arch` only matters for a Mac, which has two builds: "arm64" (Apple Silicon) or "x64" (Intel). */
/** "windows-legacy" is the build for Windows 7, 8 and 8.1 (Tauri-App-Extension/PLAN-windows-7-legacy-build.md). */
export function getAgentDownloadUrl(
  platform: "windows" | "windows-legacy" | "mac" | "linux" = "windows",
  arch?: "arm64" | "x64",
): string {
  const base = LANDING_API_URL || ""
  const archPart = platform === "mac" && arch ? `&arch=${arch}` : ""
  return `${base}/api/download?platform=${platform}${archPart}`
}

