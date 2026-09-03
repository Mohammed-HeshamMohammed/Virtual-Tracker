import { getActivityLevel } from "@/features/activity/utils/activity-level"

const INPUT_IDLE_MS = 90_000

type IdleDetectorInstance = {
  userState: "active" | "idle"
  addEventListener(type: "change", listener: () => void): void
  start(): Promise<void>
}

type IdleDetectorConstructor = {
  requestPermission(): Promise<"granted" | "denied">
  new (): IdleDetectorInstance
}

export function startIdleWatch(onIdle: () => void): () => void {
  if (typeof window === "undefined") return () => {}

  let stopped = false
  let lastInputAt = Date.now()
  let idleDetector: IdleDetectorInstance | null = null

  const bump = () => {
    lastInputAt = Date.now()
  }
  const opts: AddEventListenerOptions = { passive: true }
  window.addEventListener("mousemove", bump, opts)
  window.addEventListener("keydown", bump)
  window.addEventListener("click", bump, opts)

  const poll = window.setInterval(() => {
    if (stopped) return
    const msSinceInput = Date.now() - lastInputAt
    if (msSinceInput >= INPUT_IDLE_MS && getActivityLevel() <= 10) {
      onIdle()
    }
  }, 15_000)

  void (async () => {
    const IdleDetectorApi = (window as Window & { IdleDetector?: IdleDetectorConstructor }).IdleDetector
    if (stopped || !IdleDetectorApi) return
    try {
      const perm = await IdleDetectorApi.requestPermission()
      if (perm !== "granted" || stopped) return
      idleDetector = new IdleDetectorApi()
      idleDetector.addEventListener("change", () => {
        if (stopped) return
        if (idleDetector?.userState === "idle") onIdle()
      })
      await idleDetector.start()
    } catch {
      /* fallback poll only */
    }
  })()

  return () => {
    stopped = true
    clearInterval(poll)
    window.removeEventListener("mousemove", bump)
    window.removeEventListener("keydown", bump)
    window.removeEventListener("click", bump)
    idleDetector = null
  }
}
