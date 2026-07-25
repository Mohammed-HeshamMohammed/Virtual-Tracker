const DEFAULT_AGENT_AUTH_PORT = 17389

/** Chrome Local Network Access: mark loopback fetches from the public dashboard origin. */
type LoopbackFetchInit = RequestInit & { targetAddressSpace?: "loopback" }

function loopbackFetch(url: string, init: LoopbackFetchInit = {}): Promise<Response> {
  // targetAddressSpace is a Chrome LNA extension not yet in lib.dom RequestInit.
  return fetch(url, { ...init, targetAddressSpace: "loopback" } as RequestInit)
}

let lastHealthCheckErrorLogged: string | null = null

/** Surface loopback fetch failures once per distinct error so DevTools shows the real cause. */
function logHealthCheckFailure(url: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const key = `${url}::${message}`
  if (key === lastHealthCheckErrorLogged) return
  lastHealthCheckErrorLogged = key
  console.warn(`[VT agent-check] loopback fetch to ${url} failed: ${message}`)
}

/** Prime Chrome loopback permission (LNA) before POSTing credentials to the agent. */
export async function ensureLoopbackAgentAccess(port = DEFAULT_AGENT_AUTH_PORT): Promise<boolean> {
  if (typeof window === "undefined") return false
  try {
    await loopbackFetch(`http://127.0.0.1:${port}/health`, { method: "GET", cache: "no-store" })
    return true
  } catch {
    return false
  }
}

export interface LocalAgentHealth {
  ok: boolean
  agent?: string
  apiUrl?: string
  authenticated?: boolean
  linkPending?: boolean
  linkToken?: string
}

/** Fetch health payload from the local desktop agent. */
export async function fetchLocalAgentHealth(
  port = DEFAULT_AGENT_AUTH_PORT,
): Promise<LocalAgentHealth | null> {
  if (typeof window === "undefined") return null
  const url = `http://127.0.0.1:${port}/health`
  try {
    const res = await loopbackFetch(url, {
      method: "GET",
      cache: "no-store",
    })
    if (!res.ok) {
      logHealthCheckFailure(url, `HTTP ${res.status}`)
      return null
    }
    lastHealthCheckErrorLogged = null
    return (await res.json()) as LocalAgentHealth
  } catch (err) {
    logHealthCheckFailure(url, err)
    return null
  }
}

/** Ping the local Python/Electron agent auth server. */
export async function pingLocalAgent(port = DEFAULT_AGENT_AUTH_PORT): Promise<boolean> {
  const health = await fetchLocalAgentHealth(port)
  return health?.ok === true
}

export async function isLocalAgentAuthenticated(
  port = DEFAULT_AGENT_AUTH_PORT,
): Promise<boolean> {
  const health = await fetchLocalAgentHealth(port)
  return health?.ok === true && health.authenticated === true
}

export async function waitForLocalAgentAuthenticated(
  port = DEFAULT_AGENT_AUTH_PORT,
  timeoutMs = 45_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isLocalAgentAuthenticated(port)) return true
    await new Promise((resolve) => window.setTimeout(resolve, 1000))
  }
  return false
}

/** Ask the local agent to resume polling for linked credentials after web complete. */
export async function resumeLocalAgentLinkPoll(
  port = DEFAULT_AGENT_AUTH_PORT,
): Promise<boolean> {
  if (typeof window === "undefined") return false
  try {
    const res = await loopbackFetch(`http://127.0.0.1:${port}/link/resume`, {
      method: "POST",
      cache: "no-store",
    })
    if (!res.ok) return false
    const json = (await res.json()) as { ok?: boolean }
    return json.ok === true
  } catch {
    return false
  }
}

/** Best-effort localhost handoff; linking must succeed via backend link/exchange poll. */
export async function deliverLocalAgentCredentials(
  linkToken: string,
  idToken: string,
  refreshToken = "",
  port = DEFAULT_AGENT_AUTH_PORT,
): Promise<boolean> {
  if (typeof window === "undefined") return false
  if (!linkToken.trim() || !idToken.trim()) return false
  try {
    const res = await loopbackFetch(`http://127.0.0.1:${port}/link/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkToken, idToken, refreshToken }),
      cache: "no-store",
    })
    if (!res.ok) return false
    const json = (await res.json()) as { ok?: boolean }
    return json.ok === true
  } catch {
    return false
  }
}

export function openAgentAuthPage(webUrl: string, port = DEFAULT_AGENT_AUTH_PORT): void {
  if (typeof window === "undefined") return
  window.open(`${webUrl.replace(/\/$/, "")}/?port=${port}`, "_blank", "noopener,noreferrer")
}

export { DEFAULT_AGENT_AUTH_PORT }
