import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"


export interface TaskTimeTrackingRecord {
  id: string
  taskId: string
  userId: string
  projectId: string | null
  activeSeconds: number
  idleSeconds: number
  startedAt: string | null
  lastActivityAt: string | null
  sessionId: string | null
  reviewNotes: string
  createdAt: string | null
  updatedAt: string | null
}

export interface TaskTimeTrackingState {
  tracking: TaskTimeTrackingRecord | null
  activeSeconds: number
  idleSeconds: number
  taskStatus: string
  estimatedSeconds: number | null
  progressPercent: number | null
  totalActiveSeconds?: number
  totalIdleSeconds?: number
  aggregatedProgressPercent?: number | null
  memberContributions?: Array<{
    userId: string
    activeSeconds: number
    idleSeconds: number
    progressPercent: number | null
    lastActivityAt?: string | null
    employeeName?: string
  }> | null
  timerAllowance?: import("@/features/activity/utils/timer-limit").TimerAllowance | null
  timerCapped?: boolean
}

export interface ManagementTaskTrackingRow extends TaskTimeTrackingRecord {
  employeeName: string
  projectName: string
  taskName: string
  taskStatus: string
  estimatedSeconds: number | null
  progressPercent: number | null
}

export type TaskTimerSyncAction = "start" | "idle" | "resume" | "stop" | "sync"

export async function fetchTaskTimeTracking(taskId: string): Promise<TaskTimeTrackingState | null> {
  try {
    const res = await apiFetch(apiPath(`/api/tasks/${encodeURIComponent(taskId)}/time-tracking`))
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch {
    return null
  }
}

export async function syncTaskTimeTrackingApi(
  taskId: string,
  action: TaskTimerSyncAction,
  counters: { activeSeconds: number; idleSeconds: number; sessionId?: string | null },
): Promise<(TaskTimeTrackingState & { statusChanged?: boolean }) | null> {
  try {
    const res = await apiFetch(apiPath(`/api/tasks/${encodeURIComponent(taskId)}/time-tracking`), {
      method: "POST",
      body: JSON.stringify({
        action,
        activeSeconds: counters.activeSeconds,
        idleSeconds: counters.idleSeconds,
        sessionId: counters.sessionId ?? null,
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch {
    return null
  }
}

export async function fetchManagementTaskTracking(filters?: {
  projectId?: string
  memberId?: string
  status?: string
}): Promise<ManagementTaskTrackingRow[]> {
  const params = new URLSearchParams()
  if (filters?.projectId) params.set("projectId", filters.projectId)
  if (filters?.memberId) params.set("memberId", filters.memberId)
  if (filters?.status) params.set("status", filters.status)
  const qs = params.toString()
  try {
    const res = await apiFetch(apiPath(`/api/task-time-tracking/management${qs ? `)?${qs}` : ""}`)
    if (!res.ok) return []
    const json = await res.json()
    return json.data ?? []
  } catch {
    return []
  }
}

export async function reviewTaskTimeTracking(
  taskId: string,
  decision: "approve" | "rework",
  notes?: string,
): Promise<{ taskStatus: string } | null> {
  try {
    const res = await apiFetch(apiPath(`/api/tasks/${encodeURIComponent(taskId)}/time-tracking/review`), {
      method: "POST",
      body: JSON.stringify({ decision, notes: notes ?? "" }),
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch {
    return null
  }
}
