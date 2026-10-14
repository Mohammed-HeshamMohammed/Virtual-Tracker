import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import type { PdfOptions } from "@/shared/pdf-core/options"

/** The PDF look this member saved, or null if they never saved one. */
export async function fetchPdfSettings(): Promise<Partial<PdfOptions> | null> {
  const res = await apiFetch(apiPath("/api/reports/pdf-settings"))
  const json = (await res.json().catch(() => null)) as { data?: Partial<PdfOptions> | null; error?: string } | null
  if (!res.ok) throw new Error(json?.error || `Could not load PDF settings (${res.status}).`)
  return json?.data ?? null
}

export async function savePdfSettings(settings: Partial<PdfOptions>): Promise<void> {
  const res = await apiFetch(apiPath("/api/reports/pdf-settings"), {
    method: "PUT",
    body: JSON.stringify(settings),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(json?.error || `Could not save PDF settings (${res.status}).`)
  }
}
