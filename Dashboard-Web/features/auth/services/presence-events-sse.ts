import { apiFetch } from "@/infrastructure/api/http"
import { ReconnectBackoff } from "@/features/auth/services/reconnect-backoff"

export type PresenceDelta = {
  memberId: string
  status: "online" | "idle" | "offline"
  lastSeenAt: number
  lastActivityAt: number
}

let streamController: AbortController | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let openingPromise: Promise<boolean> | null = null
let intentionalClose = false
let streamOpen = false
const reconnectBackoff = new ReconnectBackoff()
const listeners = new Set<(delta: PresenceDelta) => void>()

function dispatchDelta(delta: PresenceDelta) {
  for (const listener of listeners) listener(delta)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vt-presence-delta", { detail: delta }))
  }
}

function processEventFrame(frame: string): void {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
  if (!data) return

  try {
    const value = JSON.parse(data) as {
      type?: string
      memberId?: string
      status?: PresenceDelta["status"]
      lastSeenAt?: number
      lastActivityAt?: number
    }
    if (value.type !== "presence" || !value.memberId || !value.status) return
    dispatchDelta({
      memberId: value.memberId,
      status: value.status,
      lastSeenAt: value.lastSeenAt ?? Date.now(),
      lastActivityAt: value.lastActivityAt ?? value.lastSeenAt ?? Date.now(),
    })
  } catch {
    /* Ignore malformed event frames. */
  }
}

function clearReconnect(): void {
  if (!reconnectTimer) return
  clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function scheduleReconnect(): void {
  if (intentionalClose || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void openPresenceEventStream()
  }, reconnectBackoff.nextDelay())
}

async function consumeStream(response: Response, controller: AbortController): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Presence event stream has no response body.")

  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ""
      for (const frame of frames) processEventFrame(frame)
    }
  } finally {
    reader.releaseLock()
  }

  if (streamController === controller) {
    streamController = null
    streamOpen = false
    scheduleReconnect()
  }
}

async function connectStream(): Promise<boolean> {
  const controller = new AbortController()
  streamController = controller

  try {
    const response = await apiFetch(
      "/api/presence/events",
      {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      },
    )
    if (!response.ok || !response.body) {
      throw new Error(`Presence event stream returned HTTP ${response.status}.`)
    }

    if (controller.signal.aborted || intentionalClose) return false
    streamOpen = true
    reconnectBackoff.reset()
    void consumeStream(response, controller).catch(() => {
      if (streamController === controller) {
        streamController = null
        streamOpen = false
        scheduleReconnect()
      }
    })
    return true
  } catch {
    if (streamController === controller) {
      streamController = null
      streamOpen = false
    }
    scheduleReconnect()
    return false
  }
}

export function isPresenceEventStreamOpen(): boolean {
  return streamOpen && streamController != null
}

export async function openPresenceEventStream(): Promise<boolean> {
  if (typeof window === "undefined") return false
  if (streamController) return streamOpen

  intentionalClose = false
  clearReconnect()
  if (openingPromise) return openingPromise

  openingPromise = connectStream().finally(() => {
    openingPromise = null
  })
  return openingPromise
}

export function closePresenceEventStream(): void {
  intentionalClose = true
  clearReconnect()
  streamController?.abort()
  streamController = null
  streamOpen = false
}

export function subscribePresenceDeltas(handler: (delta: PresenceDelta) => void): () => void {
  listeners.add(handler)
  return () => listeners.delete(handler)
}
