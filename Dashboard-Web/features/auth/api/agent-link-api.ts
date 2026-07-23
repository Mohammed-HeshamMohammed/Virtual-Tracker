import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"


export async function completeAgentLink(
  linkToken: string,
  refreshToken = "",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(
      apiPath("/api/activity/agent/link/complete"),
      {
        method: "POST",
        body: JSON.stringify({
          linkToken,
          refreshToken,
          source: "tauri",
        }),
      },
      { json: true },
    )
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: json.error || "Failed to complete agent link" }
    }
    if (json.success === false) {
      return { ok: false, error: json.error || "Failed to complete agent link" }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: "Network error while completing agent link" }
  }
}
