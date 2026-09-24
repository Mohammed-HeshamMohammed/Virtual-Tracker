import { apiPath } from "@/infrastructure/api/path"
import { fetchJsonWithRetry } from "@/infrastructure/api/http"

export type CaptureSettings = {
  screenshotMinDelaySec: number
  screenshotMaxDelaySec: number
  blurDefault: boolean
  workStartMin: number | null
  workEndMin: number | null
  captureBlocked: boolean
  captureBlockReason: "break" | "outside_work_hours" | null
}

export type CaptureSettingsPatch = Partial<
  Pick<CaptureSettings, "screenshotMinDelaySec" | "screenshotMaxDelaySec" | "blurDefault" | "workStartMin" | "workEndMin">
>

async function call(memberId: string, init?: RequestInit): Promise<CaptureSettings | null> {
  const { res, json } = await fetchJsonWithRetry<{ success?: boolean; data?: CaptureSettings; error?: string }>(
    apiPath(`/api/activity/members/${memberId}/capture-settings`),
    init ?? {},
    { retries: 1 },
  )
  if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load capture settings.")
  return json.data ?? null
}

export function getCaptureSettings(memberId: string) {
  return call(memberId)
}

export function saveCaptureSettings(memberId: string, patch: CaptureSettingsPatch) {
  return call(memberId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
}

export type CaptureSummary = {
  timezone: string
  screenshots: number
  appEvents: number
  apps: number
  domains: number
  activeSeconds: number
}

export async function getMyCaptureSummary(): Promise<CaptureSummary | null> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const { res, json } = await fetchJsonWithRetry<{ success?: boolean; data?: CaptureSummary; error?: string }>(
    apiPath(`/api/activity/my-capture-summary?tz=${encodeURIComponent(tz || "UTC")}`),
    {},
    { retries: 1 },
  )
  if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load your capture summary.")
  return json.data ?? null
}
