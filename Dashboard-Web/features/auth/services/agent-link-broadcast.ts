const CHANNEL_NAME = "vt-agent-link"
const STORAGE_KEY = "vt-agent-linked-ping"
const DASHBOARD_PING_TYPE = "vt-dashboard-ping"
const DASHBOARD_PONG_TYPE = "vt-dashboard-pong"
const DASHBOARD_PING_STORAGE_KEY = "vt-dashboard-ping"
const DASHBOARD_PONG_STORAGE_KEY = "vt-dashboard-pong"

export function broadcastAgentLinked(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event("vt-agent-linked"))
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage({ type: "vt-agent-linked", at: Date.now() })
    channel.close()
  } catch {
    /* BroadcastChannel unavailable */
  }
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
  } catch {
    /* storage blocked */
  }
}

export function subscribeAgentLinked(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {}

  const onEvent = () => handler()
  window.addEventListener("vt-agent-linked", onEvent)

  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event) => {
      if (event.data?.type === "vt-agent-linked") handler()
    }
  } catch {
    /* ignore */
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) handler()
  }
  window.addEventListener("storage", onStorage)

  return () => {
    window.removeEventListener("vt-agent-linked", onEvent)
    window.removeEventListener("storage", onStorage)
    channel?.close()
  }
}

export function pingDashboardTab(timeoutMs = 400): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false)

  const pingId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  return new Promise((resolve) => {
    let settled = false
    const done = (found: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      channel?.close()
      window.removeEventListener("storage", onStorage)
      resolve(found)
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== DASHBOARD_PONG_STORAGE_KEY || !event.newValue) return
      try {
        const data = JSON.parse(event.newValue) as { pingId?: string }
        if (data.pingId === pingId) done(true)
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("storage", onStorage)

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = (event) => {
        if (event.data?.type === DASHBOARD_PONG_TYPE && event.data?.pingId === pingId) {
          done(true)
        }
      }
      channel.postMessage({ type: DASHBOARD_PING_TYPE, pingId })
    } catch {
      /* BroadcastChannel unavailable */
    }

    try {
      localStorage.setItem(
        DASHBOARD_PING_STORAGE_KEY,
        JSON.stringify({ pingId, at: Date.now() }),
      )
    } catch {
      /* storage blocked */
    }

    const timer = setTimeout(() => done(false), timeoutMs)
  })
}

export function registerDashboardPresence(): () => void {
  if (typeof window === "undefined") return () => {}

  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event) => {
      if (event.data?.type === DASHBOARD_PING_TYPE && event.data?.pingId) {
        channel?.postMessage({ type: DASHBOARD_PONG_TYPE, pingId: event.data.pingId })
      }
    }
  } catch {
    /* BroadcastChannel unavailable */
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== DASHBOARD_PING_STORAGE_KEY || !event.newValue) return
    try {
      const data = JSON.parse(event.newValue) as { pingId?: string }
      if (!data.pingId) return
      localStorage.setItem(
        DASHBOARD_PONG_STORAGE_KEY,
        JSON.stringify({ pingId: data.pingId, at: Date.now() }),
      )
    } catch {
      /* ignore */
    }
  }
  window.addEventListener("storage", onStorage)

  return () => {
    channel?.close()
    window.removeEventListener("storage", onStorage)
  }
}
