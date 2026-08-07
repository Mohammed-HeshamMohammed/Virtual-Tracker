import { getDashboardApiBaseUrl } from "@/infrastructure/api/url"
import { VT_AUTH_SESSION_RESTRICTED } from "@/features/auth/services/auth-session-errors"

const HEARTBEAT_MS = 30_000
const RECONNECT_MS = 5_000

function wsBaseUrl(): string {
  const httpBase = getDashboardApiBaseUrl()
  return httpBase.replace(/^http/i, (scheme) => (scheme.toLowerCase() === "https" ? "wss" : "ws"))
}

type PresenceWsStatus = "online" | "idle" | "offline"

type PresenceHelloMessage = {
  type: "hello"
  status: PresenceWsStatus
  memberId?: string
}

type ChangedMessage = { type: "changed"; resource: string; id: string; action: "created" | "updated" | "deleted"; actor?: string; at: number }
type ScopeChangedMessage = { type: "scope-changed"; reason: "role" | "project-access" | "team" | "ban" | "hierarchy"; at: number }

type PresenceServerMessage =
  | PresenceHelloMessage
  | { type: "pong" }
  | { type: "force-sign-out" }
  | ChangedMessage
  | ScopeChangedMessage

type PresenceClientMessage = { type: "ping" } | { type: "activity" }

let socket: WebSocket | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let intentionalClose = false
let activityHandler: (() => void) | null = null
// Distinguishes the very first connect (fresh mount-time fetches already
// cover it) from a reconnect after a drop (§6.10 - frames missed while
// down are gone, so a reconnect must force a full refetch instead).
let hasConnectedBefore = false

function clearTimers() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function sendMessage(message: PresenceClientMessage) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(message))
}

function dispatchPresencePing() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("vt-presence-ping"))
  }
}

function scheduleReconnect(connect: () => void) {
  if (intentionalClose || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_MS)
}

async function getIdToken(): Promise<string | null> {
  const { getFirebaseAuth } = await import("@/infrastructure/firebase/config")
  const user = getFirebaseAuth().currentUser
  if (!user) return null
  return user.getIdToken()
}

export function isPresenceWebSocketConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN
}

/** Auth presence WS — online only after connect succeeds. */
export async function connectPresenceWebSocket(): Promise<boolean> {
  if (typeof window === "undefined") return false
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket.readyState === WebSocket.OPEN
  }

  const token = await getIdToken()
  if (!token) {
    scheduleReconnect(() => void connectPresenceWebSocket())
    return false
  }

  intentionalClose = false
  const url = `${wsBaseUrl()}/api/presence/ws?token=${encodeURIComponent(token)}`

  return new Promise((resolve) => {
    const ws = new WebSocket(url)
    socket = ws
    let settled = false

    ws.onopen = () => {
      if (!settled) {
        settled = true
        resolve(true)
      }
      clearTimers()
      heartbeatTimer = setInterval(() => sendMessage({ type: "ping" }), HEARTBEAT_MS)
      if (hasConnectedBefore) {
        void import("@/infrastructure/api/change-events").then(({ dispatchReconnectRefetch }) => {
          dispatchReconnectRefetch()
        })
      }
      hasConnectedBefore = true
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as PresenceServerMessage
        if (data.type === "hello") {
          dispatchPresencePing()
        } else if (data.type === "force-sign-out") {
          window.dispatchEvent(
            new CustomEvent(VT_AUTH_SESSION_RESTRICTED, {
              detail: { message: "You were signed out from another page." },
            }),
          )
        } else if (data.type === "changed") {
          void import("@/infrastructure/api/change-events").then(({ dispatchChanged }) => {
            dispatchChanged(data)
          })
        } else if (data.type === "scope-changed") {
          void import("@/infrastructure/api/change-events").then(({ handleScopeChanged }) => {
            void handleScopeChanged(data)
          })
        }
      } catch {
        /* ignore malformed frames */
      }
    }

    ws.onclose = () => {
      clearTimers()
      socket = null
      if (!settled) {
        settled = true
        resolve(false)
      }
      scheduleReconnect(() => void connectPresenceWebSocket())
    }

    ws.onerror = () => {
      if (!settled) {
        settled = true
        resolve(false)
      }
      scheduleReconnect(() => void connectPresenceWebSocket())
    }
  })
}

export function sendPresenceActivity() {
  sendMessage({ type: "activity" })
  dispatchPresencePing()
}

export function disconnectPresenceWebSocket() {
  intentionalClose = true
  clearTimers()
  if (socket) {
    socket.close()
    socket = null
  }
}

export function bindPresenceActivityListeners(handler: () => void): () => void {
  activityHandler = handler
  return () => {
    if (activityHandler === handler) activityHandler = null
  }
}

export function notifyPresenceActivity() {
  activityHandler?.()
}
