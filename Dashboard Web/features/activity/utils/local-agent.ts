const DEFAULT_AGENT_AUTH_PORT = 17389

export interface LocalAgentHealth {
  ok: boolean
  agent?: string
}

/** Ping the local Python/Electron agent auth server. */
export async function pingLocalAgent(port = DEFAULT_AGENT_AUTH_PORT): Promise<boolean> {
  if (typeof window === "undefined") return false
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "GET",
      cache: "no-store",
    })
    if (!res.ok) return false
    const json = (await res.json()) as LocalAgentHealth
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
