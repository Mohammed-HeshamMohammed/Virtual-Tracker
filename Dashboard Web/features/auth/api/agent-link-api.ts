import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"


export async function completeAgentLink(
  linkToken: string,
  refreshToken = "",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(apiPath("/api/activity/agent/link/complete"), {
      method: "POST",
      body: JSON.stringify({
        linkToken,
        refreshToken,
        source: "python",
      }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      return { ok: false, error: json.error || "Failed to complete agent link" }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: "Network error while completing agent link" }
  }
}
