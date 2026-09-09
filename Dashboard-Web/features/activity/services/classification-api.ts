import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import type { ActivityCategory } from "@/features/activity/utils/activity-categories"

export interface ClassificationRow {
  id: string
  matchType: "app" | "domain" | "window_title"
  pattern: string
  category: ActivityCategory
  displayName: string | null
  isGlobalDefault: boolean
  updatedAt?: string
}

type Envelope<T> = { success?: boolean; error?: string; data?: T }

async function readEnvelope<T>(res: Response, fallback: string): Promise<T> {
  const json = (await res.json().catch(() => null)) as Envelope<T> | null
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || fallback)
  }
  return (json?.data ?? null) as T
}

export async function fetchClassifications(): Promise<ClassificationRow[]> {
  const res = await apiFetch(apiPath("/api/classification/categories"), {
    headers: { Accept: "application/json" },
  })
  const rows = await readEnvelope<ClassificationRow[]>(res, "Failed to load classifications.")
  return Array.isArray(rows) ? rows : []
}

export async function saveClassification(input: {
  matchType: "app" | "domain" | "window_title"
  pattern: string
  category: ActivityCategory
  displayName?: string | null
}): Promise<ClassificationRow | null> {
  const res = await apiFetch(apiPath("/api/classification/categories"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      matchType: input.matchType,
      pattern: input.pattern,
      category: input.category,
      ...(input.displayName !== undefined ? { displayName: input.displayName ?? "" } : {}),
    }),
  })
  return readEnvelope<ClassificationRow | null>(res, "Failed to save classification.")
}

export async function deleteClassification(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/classification/categories/${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers: { Accept: "application/json" },
  })
  await readEnvelope<null>(res, "Failed to remove classification.")
}

export function classificationKey(matchType: "app" | "domain" | "window_title", pattern: string): string {
  return `${matchType}:${pattern.trim().toLowerCase()}`
}

export function toClassificationMap(rows: ClassificationRow[]): Map<string, ClassificationRow> {
  const map = new Map<string, ClassificationRow>()
  for (const row of rows) {
    if (!row?.pattern) continue
    map.set(classificationKey(row.matchType, row.pattern), row)
  }
  return map
}
