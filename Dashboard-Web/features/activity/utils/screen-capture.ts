
export type ScreenCaptureState = "inactive" | "active" | "denied"

type Listener = (state: ScreenCaptureState, label: string) => void

let stream: MediaStream | null = null
let videoEl: HTMLVideoElement | null = null
let captureLabel = ""
let state: ScreenCaptureState = "inactive"
const listeners = new Set<Listener>()

function notify(): void {
  for (const fn of listeners) fn(state, captureLabel)
}

export function getScreenCaptureState(): ScreenCaptureState {
  return state
}

export function getScreenCaptureLabel(): string {
  return captureLabel
}

export function isScreenCaptureActive(): boolean {
  return state === "active" && stream !== null
}

export function subscribeScreenCapture(fn: Listener): () => void {
  listeners.add(fn)
  fn(state, captureLabel)
  return () => listeners.delete(fn)
}

function ensureVideo(): HTMLVideoElement {
  if (!videoEl) {
    videoEl = document.createElement("video")
    videoEl.muted = true
    videoEl.playsInline = true
    videoEl.style.display = "none"
    document.body.appendChild(videoEl)
  }
  return videoEl
}

export async function requestScreenCapture(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    state = "denied"
    notify()
    return { ok: false, reason: "Screen capture is not supported in this browser." }
  }

  try {
    stopScreenCapture()

    const options: DisplayMediaStreamOptions & {
      preferCurrentTab?: boolean
      selfBrowserSurface?: string
    } = {
      video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 1, max: 5 },
      },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    }

    stream = await navigator.mediaDevices.getDisplayMedia(options)
    const track = stream.getVideoTracks()[0]
    if (!track) {
      stopScreenCapture()
      state = "denied"
      notify()
      return { ok: false, reason: "No video track in capture stream." }
    }

    captureLabel = track.label?.trim() || "Shared screen"
    track.addEventListener("ended", () => {
      stopScreenCapture()
    })

    const video = ensureVideo()
    video.srcObject = stream
    await video.play()

    state = "active"
    notify()
    return { ok: true }
  } catch (error: unknown) {
    stopScreenCapture()
    state = "denied"
    notify()
    const message = error instanceof Error ? error.message : "Permission denied"
    return { ok: false, reason: message }
  }
}

export function stopScreenCapture(): void {
  if (stream) {
    for (const track of stream.getTracks()) track.stop()
  }
  stream = null
  if (videoEl) {
    videoEl.srcObject = null
  }
  captureLabel = ""
  if (state === "active") {
    state = "inactive"
    notify()
  }
}

export async function captureScreenFrame(): Promise<string> {
  if (!stream || !videoEl || state !== "active") return ""

  try {
    const vw = videoEl.videoWidth
    const vh = videoEl.videoHeight
    if (!vw || !vh) return ""

    const maxW = 1280
    const scale = vw > maxW ? maxW / vw : 1
    const w = Math.round(vw * scale)
    const h = Math.round(vh * scale)

    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return ""
    ctx.drawImage(videoEl, 0, 0, w, h)
    return canvas.toDataURL("image/jpeg", 0.72)
  } catch {
    return ""
  }
}

function isInvalidCaptureLabel(label: string): boolean {
  const lower = label.toLowerCase()
  return lower.includes("://") || lower.includes("media-stream") || lower.startsWith("current-web-contents")
}

export function captureAppName(): string {
  if (!isScreenCaptureActive()) return "Browser · Virtual Tracker"
  const label = captureLabel.trim()
  if (!label || isInvalidCaptureLabel(label)) return "Browser · Virtual Tracker"
  if (/virtual tracker/i.test(label)) return `Browser · ${label}`
  if (/chrome|edge|firefox|safari|browser|tab/i.test(label)) return `Browser · ${label}`
  return label
}
