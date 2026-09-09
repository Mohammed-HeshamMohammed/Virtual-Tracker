import { apiFetch } from "@/lib/api/http"

export type MyActivitySummary = {
  stats: {
    workedTodayHours: number
    workedWeekHours: number
    activityTodayPercent: number
    activityWeekPercent: number
  }
  todos: Array<{ id: string; title: string; projectName: string; status: string; priority: string }>
  recentProjects: Array<{ id: string; name: string; progress: number; memberCount: number }>
  weeklyActivity: Array<{ key: string; label: string; activeHours: number; idleHours: number }>
  topApps: Array<{ name: string; totalSeconds: number; percent: number }>
}

export async function fetchMyActivitySummary(): Promise<MyActivitySummary | null> {
  const res = await apiFetch("/api/dashboard/general", { method: "GET" })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok || !data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    return null
  }
  const me = (data as { data?: { me?: unknown } }).data?.me
  if (!me || typeof me !== "object") return null
  return me as MyActivitySummary
}
