const CHANNEL_NAME = "vt-auth-session"
const STORAGE_KEY = "vt-auth-session-ready"

export function broadcastAuthSessionReady(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event("vt-auth-session-ready"))
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage({ type: "vt-auth-session-ready", at: Date.now() })
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

export function subscribeAuthSessionReady(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {}

  const onEvent = () => handler()
  window.addEventListener("vt-auth-session-ready", onEvent)

  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event) => {
      if (event.data?.type === "vt-auth-session-ready") handler()
    }
  } catch {
    /* ignore */
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) handler()
  }
  window.addEventListener("storage", onStorage)

  return () => {
    window.removeEventListener("vt-auth-session-ready", onEvent)
    window.removeEventListener("storage", onStorage)
    channel?.close()
  }
}
