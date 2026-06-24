import { getApiBaseUrl } from "@/infrastructure/api/url"

export type PresenceDelta = {
  memberId: string
  status: "online" | "idle" | "offline"
  lastSeenAt: number
  lastActivityAt: number
}

const RECONNECT_MS = 5_000

let source: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let intentionalClose = false
const listeners = new Set<(delta: PresenceDelta) => void>()

function httpBaseUrl(): string {
  return getApiBaseUrl()
}

function dispatchDelta(delta: PresenceDelta) {
  for (const listener of listeners) listener(delta)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vt-presence-delta", { detail: delta }))
  }
}

async function getIdToken(): Promise<string | null> {
  const { getFirebaseAuth } = await import("@/infrastructure/firebase/config")
  const user = getFirebaseAuth().currentUser
  if (!user) return null
  return user.getIdToken()
}

function scheduleReconnect() {
  if (intentionalClose || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void openPresenceEventStream()
  }, RECONNECT_MS)
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

/**
 * SSE subscription to `/api/presence/events` (Firebase RTD fan-out).
 */
export async function openPresenceEventStream(): Promise<boolean> {
  if (typeof window === "undefined") return false
  if (source && source.readyState !== EventSource.CLOSED) return true

  const token = await getIdToken()
  if (!token) return false

  intentionalClose = false
  clearReconnect()

  const url = `${httpBaseUrl()}/api/presence/events?token=${encodeURIComponent(token)}`
  const es = new EventSource(url)
  source = es

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data)) as { type?: string; memberId?: string; status?: PresenceDelta["status"]; lastSeenAt?: number; lastActivityAt?: number }
      if (data.type !== "presence" || !data.memberId || !data.status) return
      dispatchDelta({
        memberId: data.memberId,
        status: data.status,
        lastSeenAt: data.lastSeenAt ?? Date.now(),
        lastActivityAt: data.lastActivityAt ?? data.lastSeenAt ?? Date.now(),
      })
    } catch {
      /* ignore */
    }
  }

  es.onerror = () => {
    es.close()
    source = null
    scheduleReconnect()
  }

  return true
}

export function closePresenceEventStream() {
  intentionalClose = true
  clearReconnect()
  source?.close()
  source = null
}

export function subscribePresenceDeltas(handler: (delta: PresenceDelta) => void): () => void {
  listeners.add(handler)
  return () => listeners.delete(handler)
}
