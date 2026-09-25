import { apiPath } from "@/infrastructure/api/path"
import { fetchJsonWithRetry } from "@/infrastructure/api/http"

export type MonitoringCapability = {
  capability: string
  enabled: boolean
  /** False when nothing reads this flag, so the UI never shows a dead switch. */
  enforced: boolean
  jurisdictionProfile: string | null
  lawfulBasis: string | null
  enabledBy: string | null
  enabledAt: string | null
  updatedAt: string | null
}

export type RetentionSetting = {
  dataType: string
  retentionDays: number
  updatedBy?: string | null
  updatedAt?: string | null
}

export type ScreenshotAccessEntry = {
  id?: string
  screenshotId?: string
  viewerId?: string
  viewerName?: string
  accessedAt?: string
  reason?: string
}

async function call<T>(path: string, init?: RequestInit, fallback = "Request failed."): Promise<T> {
  const { res, json } = await fetchJsonWithRetry<{ success?: boolean; data?: T; error?: string }>(
    apiPath(path),
    init ?? {},
    { retries: init?.method && init.method !== "GET" ? 0 : 1 },
  )
  if (!res.ok || !json?.success) throw new Error(json?.error || fallback)
  return json.data as T
}

export function getMonitoringPolicy() {
  return call<MonitoringCapability[]>("/api/compliance/monitoring-policy", undefined, "Could not load the monitoring policy.")
}

export function setMonitoringCapability(input: {
  capability: string
  enabled: boolean
  jurisdictionProfile?: string
  lawfulBasis?: string | null
}) {
  return call<MonitoringCapability>(
    "/api/compliance/monitoring-policy",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    "Could not update the monitoring policy.",
  )
}

export function getRetentionSettings() {
  return call<RetentionSetting[]>("/api/compliance/retention-settings", undefined, "Could not load retention settings.")
}

export function setRetentionDays(dataType: string, retentionDays: number) {
  return call<RetentionSetting>(
    "/api/compliance/retention-settings",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataType, retentionDays }) },
    "Could not update retention settings.",
  )
}

export function getScreenshotAccessLog(memberId?: string) {
  const suffix = memberId ? `/${encodeURIComponent(memberId)}` : ""
  return call<ScreenshotAccessEntry[]>(
    `/api/compliance/screenshot-access-log${suffix}`,
    undefined,
    "Could not load the screenshot access log.",
  )
}

export type CaptureExclusion = { id: string; matchType: string; pattern: string; note?: string | null }

export function getCaptureExclusions() {
  return call<CaptureExclusion[]>("/api/compliance/capture-exclusions", undefined, "Could not load capture exclusions.")
}

export function addCaptureExclusion(matchType: string, pattern: string, note?: string) {
  return call<CaptureExclusion>(
    "/api/compliance/capture-exclusions",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matchType, pattern, note }) },
    "Could not add the exclusion.",
  )
}

export function removeCaptureExclusion(id: string) {
  return call<unknown>(
    `/api/compliance/capture-exclusions/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "Could not remove the exclusion.",
  )
}

export type AgentDevice = {
  device_id: string
  member_id: string
  member_name?: string
  agent_source?: string
  ownership?: string
  last_seen_at?: string | null
  created_at?: string | null
}

export function getActiveDevices() {
  return call<AgentDevice[]>("/api/compliance/devices/all", undefined, "Could not load linked devices.")
}

export function revokeDevice(deviceId: string) {
  return call<unknown>(
    `/api/compliance/devices/${encodeURIComponent(deviceId)}`,
    { method: "DELETE" },
    "Could not revoke the device.",
  )
}

export type IsolationReport = {
  status: "enforced" | "not-enforced" | "unknown"
  critical: boolean
  summary: string
  reasons: string[]
  customerTenants: number
}

export function getTenantIsolation() {
  return call<IsolationReport>("/api/customer-accounts/isolation", undefined, "Could not check tenant isolation.")
}
