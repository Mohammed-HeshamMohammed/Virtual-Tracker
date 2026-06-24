/** Rolling input-activity score (0–100) from mouse/keyboard/scroll in the current tab. */

const WINDOW_MS = 60_000

let inputCount = 0
let windowStart = Date.now()
let listenersAttached = false

function onInput(): void {
  inputCount += 1
}

function attachListeners(): void {
  if (listenersAttached || typeof window === "undefined") return
  listenersAttached = true
  const opts: AddEventListenerOptions = { passive: true }
  window.addEventListener("mousemove", onInput, opts)
  window.addEventListener("keydown", onInput)
  window.addEventListener("scroll", onInput, opts)
  window.addEventListener("click", onInput, opts)
  window.addEventListener("touchstart", onInput, opts)
}

export function ensureActivityLevelListeners(): void {
  attachListeners()
}

/** Returns 0–100 based on inputs in the last minute (saturates around 120 events/min). */
export function getActivityLevel(): number {
  const now = Date.now()
  if (now - windowStart > WINDOW_MS) {
    inputCount = 0
    windowStart = now
  }
  const score = Math.round(Math.min(100, (inputCount / 120) * 100))
  return Math.max(5, score)
}

export function resetActivityLevelWindow(): void {
  inputCount = 0
  windowStart = Date.now()
}
