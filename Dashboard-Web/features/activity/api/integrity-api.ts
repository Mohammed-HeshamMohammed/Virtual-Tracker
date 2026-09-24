import { apiPath } from "@/infrastructure/api/path"
import { fetchJsonWithRetry } from "@/infrastructure/api/http"

export type IntegrityFlag = {
  id: string
  sessionId: string
  flagType: string
  label: string
  penalty: number
  detail: string
  detectedAt: string
  contested: boolean
  contestedAt: string | null
  contestedNote: string | null
}

export async function getIntegrityFlags(memberId?: string): Promise<IntegrityFlag[]> {
  const qs = memberId ? `?memberId=${encodeURIComponent(memberId)}` : ""
  const { res, json } = await fetchJsonWithRetry<{ success?: boolean; data?: IntegrityFlag[]; error?: string }>(
    apiPath(`/api/activity/integrity/flags${qs}`),
    {},
    { retries: 1 },
  )
  if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load integrity flags.")
  return json.data ?? []
}

export async function contestIntegrityFlag(flagId: string, note: string): Promise<IntegrityFlag | null> {
  const { res, json } = await fetchJsonWithRetry<{ success?: boolean; data?: IntegrityFlag; error?: string }>(
    apiPath(`/api/activity/integrity/flags/${encodeURIComponent(flagId)}/contest`),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) },
    { retries: 0 },
  )
  if (!res.ok || !json?.success) throw new Error(json?.error || "Could not submit your response.")
  return json.data ?? null
}
