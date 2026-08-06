import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"


export interface ReviewQueueRow {
  assignmentId: string
  taskId: string
  userId: string
  employeeName: string
  projectId: string | null
  projectName: string
  taskTitle: string
  priority: string
  assignmentStatus: string
  participationStatus?: string
  taskStatus: string
  expectedSeconds: number | null
  loggedSeconds: number
  progressPercent: number | null
  enteredReviewAt: string | null
  lastActivityAt: string | null
  startedAt: string | null
  reviewNotes: string
  isPriorityMonitor: boolean
  needsReview: boolean
  totalAssignees?: number | null
  startedAssignees?: number | null
  notStartedAssignees?: number | null
  participationPercent?: number | null
  allAssigneesStarted?: boolean
}

export interface TaskAssignmentParticipation {
  assignmentId: string
  userId: string
  employeeName: string
  status: string
  participationStatus: string
  started: boolean
  startedAt: string | null
  activeSeconds: number
  isSelf?: boolean
}

export interface TaskParticipationResult {
  taskId: string
  taskStatus: string
  totalAssignees?: number
  startedAssignees?: number
  notStartedAssignees?: number
  participationPercent?: number | null
  allAssigneesStarted?: boolean
  myAssignment?: TaskAssignmentParticipation | null
  assignments: TaskAssignmentParticipation[]
}

export interface ReviewQueueResult {
  needsReview: ReviewQueueRow[]
  priorityMonitor: ReviewQueueRow[]
}

export async function fetchReviewQueue(filters?: {
  projectId?: string
  memberId?: string
  priority?: string
  status?: string
}): Promise<ReviewQueueResult> {
  const params = new URLSearchParams()
  if (filters?.projectId) params.set("projectId", filters.projectId)
  if (filters?.memberId) params.set("memberId", filters.memberId)
  if (filters?.priority) params.set("priority", filters.priority)
  if (filters?.status) params.set("status", filters.status)
  const qs = params.toString()
  const res = await apiFetch(apiPath(`/api/task-assignments/review-queue${qs ? `?${qs}` : ""}`))
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to load review queue.")
  }
  return json?.data ?? { needsReview: [], priorityMonitor: [] }
}

export async function reviewAssignment(
  assignmentId: string,
  decision: "approve" | "reject",
  notes?: string,
): Promise<{ assignmentStatus: string; taskStatus: string } | null> {
  const res = await apiFetch(apiPath(`/api/task-assignments/${encodeURIComponent(assignmentId)}/review`), {
    method: "POST",
    body: JSON.stringify({ decision, notes: notes ?? "" }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to review assignment.")
  }
  return json?.data ?? null
}

export async function syncTaskAssignments(
  taskId: string,
  assigneeIds: string[],
  options?: { removeUnlisted?: boolean },
): Promise<unknown[]> {
  const res = await apiFetch(apiPath(`/api/tasks/${encodeURIComponent(taskId)}/assignments`), {
    method: "POST",
    body: JSON.stringify({
      assigneeIds,
      removeUnlisted: options?.removeUnlisted ?? true,
    }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to sync task assignments.")
  }
  return json?.data ?? []
}

export async function fetchTaskParticipation(
  taskId: string,
  options?: { manage?: boolean },
): Promise<TaskParticipationResult> {
  const params = new URLSearchParams()
  if (options?.manage) params.set("manage", "1")
  const qs = params.toString()
  const res = await apiFetch(
    apiPath(`/api/tasks/${encodeURIComponent(taskId)}/assignments${qs ? `?${qs}` : ""}`),
  )
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to load task assignments.")
  }
  if (!json?.data) {
    throw new Error("No assignment data in response.")
  }
  return json.data
}

export async function startTaskAssignment(
  taskId: string,
): Promise<{
  assignmentStatus: string
  taskStatus: string
  statusChanged?: boolean
  totalAssignees?: number
  startedAssignees?: number
  notStartedAssignees?: number
  participationPercent?: number | null
  allAssigneesStarted?: boolean
} | null> {
  try {
    const res = await apiFetch(apiPath(`/api/tasks/${encodeURIComponent(taskId)}/assignments/start`), {
      method: "POST",
      body: JSON.stringify({}),
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch {
    return null
  }
}

/** Self-service "I'm blocked, waiting on X" - blocks only the caller's own
 * assignment, not the whole task. Mirrors startTaskAssignment. */
export async function blockTaskAssignment(
  taskId: string,
): Promise<{
  assignmentStatus: string
  taskStatus: string
  statusChanged?: boolean
  totalAssignees?: number
  startedAssignees?: number
  notStartedAssignees?: number
  participationPercent?: number | null
  allAssigneesStarted?: boolean
} | null> {
  try {
    const res = await apiFetch(apiPath(`/api/tasks/${encodeURIComponent(taskId)}/assignments/block`), {
      method: "POST",
      body: JSON.stringify({}),
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch {
    return null
  }
}
