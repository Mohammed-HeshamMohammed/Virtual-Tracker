import { postActivityEvents, type ActivityEvent } from "@/features/activity/services/activity-api"
import {
  captureScreenshot,
  currentAppName,
  currentPageUrl,
  randomScreenshotDelayMs,
  trackedAppName,
} from "@/features/activity/utils/capture"
import { ensureActivityLevelListeners, getActivityLevel, resetActivityLevelWindow } from "@/features/activity/utils/activity-level"
import { getTimerTask } from "@/features/activity/utils/timer-task-storage"

const APP_LOG_INTERVAL_MS = 30_000
const MAX_BATCH = 20

export type WebActivityTrackerOptions = {
  sessionId: string
  isActive: () => boolean
  onFlush?: () => void
}

/** Browser-tab activity capture while the task timer is active (replaces desktop agent for web users). */
export function createWebActivityTracker(options: WebActivityTrackerOptions) {
  const { sessionId, isActive, onFlush } = options
  let appInterval: ReturnType<typeof setInterval> | null = null
  let screenshotTimeout: ReturnType<typeof setTimeout> | null = null
  let lastUrl = ""
  let lastUrlAt = Date.now()
  let stopped = false

  function taskPageTitle(base: string): string {
    const task = getTimerTask()
    if (!task) return base
    return `${base} · Task: ${task.title}`
  }

  async function flush(events: ActivityEvent[]): Promise<void> {
    if (stopped || events.length === 0 || !isActive()) return
    const batch = events.slice(0, MAX_BATCH)
    const ok = await postActivityEvents(sessionId, batch)
    if (ok) onFlush?.()
  }

  function urlDurationSeconds(): number {
    const sec = Math.round((Date.now() - lastUrlAt) / 1000)
    return Math.max(5, Math.min(sec, APP_LOG_INTERVAL_MS / 1000 + 5))
  }

  async function recordUrlChange(force = false): Promise<void> {
    if (!isActive()) return
    const url = currentPageUrl()
    if (!url) return
    if (!force && url === lastUrl) return

    const events: ActivityEvent[] = []
    if (lastUrl && lastUrl !== url) {
      events.push({
        type: "url",
        url: lastUrl,
        pageTitle: taskPageTitle(document.title || "Virtual Tracker"),
        durationSeconds: urlDurationSeconds(),
      })
    }

    lastUrl = url
    lastUrlAt = Date.now()

    if (events.length > 0) await flush(events)
  }

  async function recordAppSlice(): Promise<void> {
    if (!isActive() || document.visibilityState === "hidden") return
    await recordUrlChange(true)
    await flush([
      {
        type: "app",
        appName: trackedAppName(),
        durationSeconds: APP_LOG_INTERVAL_MS / 1000,
      },
      {
        type: "url",
        url: currentPageUrl(),
        pageTitle: taskPageTitle(currentAppName()),
        durationSeconds: APP_LOG_INTERVAL_MS / 1000,
      },
    ])
    resetActivityLevelWindow()
  }

  async function recordScreenshot(): Promise<void> {
    if (!isActive() || document.visibilityState === "hidden") return
    const imageData = await captureScreenshot()
    if (!imageData) return
    await flush([
      {
        type: "screenshot",
        imageData,
        appName: trackedAppName(),
        pageTitle: taskPageTitle(document.title || "Virtual Tracker"),
        activityLevel: getActivityLevel(),
      },
    ])
  }

  function scheduleScreenshot(): void {
    if (screenshotTimeout) clearTimeout(screenshotTimeout)
    screenshotTimeout = setTimeout(() => {
      void recordScreenshot().finally(() => {
        if (!stopped && isActive()) scheduleScreenshot()
      })
    }, randomScreenshotDelayMs())
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      void recordUrlChange(true)
      return
    }
    lastUrlAt = Date.now()
  }

  function start(): void {
    stopped = false
    ensureActivityLevelListeners()
    lastUrl = ""
    lastUrlAt = Date.now()
    void recordUrlChange(true)
    void recordAppSlice()

    appInterval = setInterval(() => {
      void recordAppSlice()
    }, APP_LOG_INTERVAL_MS)

    scheduleScreenshot()
    document.addEventListener("visibilitychange", onVisibilityChange)
  }

  function stop(): void {
    stopped = true
    if (appInterval) clearInterval(appInterval)
    appInterval = null
    if (screenshotTimeout) clearTimeout(screenshotTimeout)
    screenshotTimeout = null
    document.removeEventListener("visibilitychange", onVisibilityChange)
    void recordUrlChange(true)
  }

  function onRouteChange(): void {
    void recordUrlChange(true)
  }

  return { start, stop, onRouteChange }
}
