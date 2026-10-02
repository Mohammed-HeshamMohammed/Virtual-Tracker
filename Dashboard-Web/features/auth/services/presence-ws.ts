import { getDashboardApiBaseUrl } from "@/infrastructure/api/url"
import { VT_AUTH_SESSION_RESTRICTED } from "@/features/auth/services/auth-session-errors"
import { syncSharedSessionCookie } from "@/features/auth/services/session-cookie-sync"
import { ReconnectBackoff } from "@/features/auth/services/reconnect-backoff"
import { apiFetch } from "@/infrastructure/api/http"

const HEARTBEAT_MS = 30_000
const reconnectBackoff = new ReconnectBackoff()

// Some corporate web filters block the WebSocket protocol outright (per
// domain, and not something a site can work around). When the socket cannot be
// established several times in a row we fall back to polling /api/presence/poll,
// which carries the same things over plain HTTPS: our own presence heartbeat and
// the force-sign-out / scope-changed frames. The socket is retried now and then
// and takes over again as soon as it works.
const WS_FAILURES_BEFORE_POLLING = 3
const POLL_VISIBLE_MS = 15_000
const POLL_HIDDEN_MS = 60_000
const WS_RETRY_WHILE_POLLING_MS = 5 * 60_000

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
let connectingPromise: Promise<boolean> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let intentionalClose = false
let activityHandler: (() => void) | null = null
let hasConnectedBefore = false

let wsFailures = 0
let pollActive = false
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollCursor: number | null = null
let pollActivityPending = false
let pollInFlight = false
const pollClientId = `c${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`

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
  }, pollActive ? WS_RETRY_WHILE_POLLING_MS : reconnectBackoff.nextDelay())
}

function handleServerMessage(data: PresenceServerMessage) {
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
}

function clearPollTimer() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function schedulePoll() {
  if (!pollActive || intentionalClose || pollTimer) return
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden"
  pollTimer = setTimeout(() => {
    pollTimer = null
    void pollOnce()
  }, hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)
}

async function pollOnce() {
  if (!pollActive || intentionalClose || pollInFlight) return
  pollInFlight = true
  const activity = pollActivityPending
  pollActivityPending = false
  try {
    const res = await apiFetch("/api/presence/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: pollClientId, since: pollCursor, activity }),
    })
    if (!res.ok) {
      pollActivityPending = pollActivityPending || activity
      return
    }
    const data = (await res.json().catch(() => null)) as {
      cursor?: number
      reset?: boolean
      events?: PresenceServerMessage[]
    } | null
    if (!data || typeof data.cursor !== "number") return
    const firstPoll = pollCursor === null
    pollCursor = data.cursor
    if (firstPoll) dispatchPresencePing()
    if (data.reset) {
      // We missed events the server no longer has - refetch instead.
      void import("@/infrastructure/api/change-events").then(({ dispatchReconnectRefetch }) => {
        dispatchReconnectRefetch()
      })
    }
    for (const event of data.events ?? []) handleServerMessage(event)
  } catch {
    pollActivityPending = pollActivityPending || activity
  } finally {
    pollInFlight = false
    schedulePoll()
  }
}

function startPolling() {
  if (pollActive || intentionalClose) return
  pollActive = true
  pollCursor = null
  pollActivityPending = true
  void pollOnce()
}

function stopPolling(options: { leave?: boolean } = {}) {
  if (!pollActive) return
  pollActive = false
  pollCursor = null
  clearPollTimer()
  if (options.leave) {
    void apiFetch("/api/presence/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: pollClientId, leave: true }),
    }).catch(() => {})
  }
}

function noteSocketFailure() {
  wsFailures += 1
  if (wsFailures >= WS_FAILURES_BEFORE_POLLING) startPolling()
}

export function isPresencePolling(): boolean {
  return pollActive
}

export function isPresenceWebSocketConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN
}

export async function connectPresenceWebSocket(): Promise<boolean> {
  if (typeof window === "undefined") return false
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket.readyState === WebSocket.OPEN
  }
  if (connectingPromise) return connectingPromise

  connectingPromise = connectWithSessionCookie().finally(() => {
    connectingPromise = null
  })
  return connectingPromise
}

async function connectWithSessionCookie(): Promise<boolean> {
  intentionalClose = false
  await syncSharedSessionCookie()
  if (intentionalClose) return false
  const url = `${wsBaseUrl()}/api/presence/ws`

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
      reconnectBackoff.reset()
      wsFailures = 0
      stopPolling({ leave: true })
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
        handleServerMessage(JSON.parse(String(event.data)) as PresenceServerMessage)
      } catch {
        /* ignore malformed frames */
      }
    }

    ws.onclose = () => {
      clearTimers()
      socket = null
      if (!settled) {
        settled = true
        noteSocketFailure()
        resolve(false)
      }
      scheduleReconnect(() => void connectPresenceWebSocket())
    }

    ws.onerror = () => {
      if (!settled) {
        settled = true
        noteSocketFailure()
        resolve(false)
      }
      scheduleReconnect(() => void connectPresenceWebSocket())
    }
  })
}

export function sendPresenceActivity() {
  if (pollActive) pollActivityPending = true
  sendMessage({ type: "activity" })
  dispatchPresencePing()
}

export function disconnectPresenceWebSocket() {
  intentionalClose = true
  clearTimers()
  stopPolling({ leave: true })
  wsFailures = 0
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
