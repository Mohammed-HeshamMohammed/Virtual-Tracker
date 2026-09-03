let wakeLock: WakeLockSentinel | null = null

export async function acquireWakeLock(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return false
  try {
    if (wakeLock && !wakeLock.released) return true
    wakeLock = await navigator.wakeLock.request("screen")
    wakeLock.addEventListener("release", () => {
      wakeLock = null
    })
    return true
  } catch {
    return false
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release()
  } catch {
    /* ignore */
  }
  wakeLock = null
}

export function bindWakeLockVisibility(releaseOnHide = false): () => void {
  if (typeof document === "undefined") return () => {}
  const onVis = () => {
    if (document.visibilityState === "visible") {
      void acquireWakeLock()
    } else if (releaseOnHide) {
      void releaseWakeLock()
    }
  }
  document.addEventListener("visibilitychange", onVis)
  return () => document.removeEventListener("visibilitychange", onVis)
}
