/** Browser activity capture — real screen frames when opted in, tab thumbnail fallback. */

import { getActivityLevel } from "@/features/activity/utils/activity-level"
import { captureAppName, captureScreenFrame, isScreenCaptureActive } from "@/features/activity/utils/screen-capture"
import { getTimerTask } from "@/features/activity/utils/timer-task-storage"

export function currentAppName(): string {
  if (typeof document === "undefined") return "Unknown"
  const title = document.title?.trim() || "Browser"
  return title.length > 120 ? `${title.slice(0, 117)}...` : title
}

export function currentPageUrl(): string {
  if (typeof window === "undefined") return ""
  return window.location.href
}

export function randomActivityLevel(): number {
  return getActivityLevel()
}

export async function captureViewportThumbnail(): Promise<string> {
  if (typeof document === "undefined") return ""
  try {
    const canvas = document.createElement("canvas")
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext("2d")
    if (!ctx) return ""
    const grad = ctx.createLinearGradient(0, 0, 320, 180)
    grad.addColorStop(0, "#1e293b")
    grad.addColorStop(1, "#334155")
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 320, 180)
    ctx.fillStyle = "#f8fafc"
    ctx.font = "bold 13px system-ui, sans-serif"
    ctx.fillText("Virtual Tracker", 12, 28)
    ctx.font = "11px system-ui, sans-serif"
    ctx.fillStyle = "#cbd5e1"
    const title = document.title.slice(0, 42) || "Untitled"
    ctx.fillText(title, 12, 52)
    const task = getTimerTask()
    if (task) {
      ctx.fillStyle = "#86efac"
      ctx.font = "bold 11px system-ui, sans-serif"
      ctx.fillText(`Task: ${task.title.slice(0, 40)}`, 12, 72)
    }
    const url = window.location.hostname + window.location.pathname
    ctx.fillStyle = "#cbd5e1"
    ctx.font = "11px system-ui, sans-serif"
    ctx.fillText(url.slice(0, 48), 12, task ? 92 : 72)
    ctx.fillText(`Activity ${getActivityLevel()}% · ${new Date().toLocaleTimeString()}`, 12, task ? 112 : 92)
    return canvas.toDataURL("image/jpeg", 0.72)
  } catch {
    return ""
  }
}

export function randomScreenshotDelayMs(): number {
  return 90_000 + Math.floor(Math.random() * 120_000)
}

export function trackedAppName(): string {
  return isScreenCaptureActive() ? captureAppName() : "Browser · Virtual Tracker"
}

/** Real screen JPEG when capture is active; otherwise a tab summary thumbnail. */
export async function captureScreenshot(): Promise<string> {
  if (isScreenCaptureActive()) {
    const frame = await captureScreenFrame()
    if (frame) return frame
  }
  return captureViewportThumbnail()
}
