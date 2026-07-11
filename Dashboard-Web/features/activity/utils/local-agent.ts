const DEFAULT_AGENT_AUTH_PORT = 17389

export interface LocalAgentHealth {
  ok: boolean
  agent?: string
  authenticated?: boolean
  linkPending?: boolean
  linkToken?: string
}

/** Fetch health payload from the local desktop agent. */
export async function fetchLocalAgentHealth(
  port = DEFAULT_AGENT_AUTH_PORT,
): Promise<LocalAgentHealth | null> {
  if (typeof window === "undefined") return null
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "GET",
      cache: "no-store",
    })
    if (!res.ok) return null
    return (await res.json()) as LocalAgentHealth
  } catch {
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

export function openAgentAuthPage(webUrl: string, port = DEFAULT_AGENT_AUTH_PORT): void {
  if (typeof window === "undefined") return
  window.open(`${webUrl.replace(/\/$/, "")}/?port=${port}`, "_blank", "noopener,noreferrer")
}

export { DEFAULT_AGENT_AUTH_PORT }
