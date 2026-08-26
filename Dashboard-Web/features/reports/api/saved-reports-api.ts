import { apiPath } from "@/infrastructure/api/path"
import { apiFetch, readJsonSafe } from "@/infrastructure/api/http"

export type SavedReport = {
  id: string
  pageId: string
  title: string
  tag: string
}

type Envelope<T> = { success?: boolean; error?: string; data?: T }

export async function fetchSavedReports(signal?: AbortSignal): Promise<SavedReport[]> {
  const res = await apiFetch(apiPath("/api/reports/saved"), { headers: { Accept: "application/json" }, signal })
  const json = await readJsonSafe<Envelope<SavedReport[]>>(res)
  if (!res.ok || !json?.success || !Array.isArray(json.data)) {
    throw new Error(json?.error || "Failed to load saved reports")
  }
  return json.data
}

export async function saveReport(input: { pageId: string; title: string; tag?: string }): Promise<SavedReport> {
  const res = await apiFetch(apiPath("/api/reports/saved"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  })
  const json = await readJsonSafe<Envelope<SavedReport>>(res)
  if (!res.ok || !json?.success || !json.data) throw new Error(json?.error || "Failed to save report")
  return json.data
}

export async function removeSavedReport(savedReportId: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/reports/saved/${encodeURIComponent(savedReportId)}`), { method: "DELETE" })
  if (!res.ok) {
    const json = await readJsonSafe<Envelope<unknown>>(res)
    throw new Error(json?.error || "Failed to remove saved report")
  }
}
