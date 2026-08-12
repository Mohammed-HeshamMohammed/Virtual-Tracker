import { apiPath } from "@/infrastructure/api/path"
import { extractApiError, apiFetch, fetchJsonWithRetry, type RequestOptions } from "@/infrastructure/api/http"
import { syncTaskAssignments } from "@/features/tasks/api/task-assignments-api"

type Envelope<T> = { success?: boolean; error?: string; data?: T; task?: T; tasks?: T }

export type TaskStatus = "todo" | "in_progress" | "in_review" | "blocked" | "done"
export type TaskPriority = "low" | "medium" | "high" | "urgent"

// Helper functions
function asString(value: unknown, fallback = ""): string {
  return String(value ?? fallback)
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback
}

function pickPayload<T>(json: Envelope<T>): T | undefined {
  return json.data ?? (json.task as T) ?? (json.tasks as T)
}

function normalizeSubtask(input: any): TaskSubtask {
  return {
    id: asString(input.id),
    taskId: asString(input.taskId || input.task_id),
    title: asString(input.title),
    completed: asBoolean(input.completed),
    orderIndex: asNumber(input.orderIndex || input.order_index),
    createdAt: asString(input.createdAt || input.created_at),
    createdBy: asString(input.createdBy || input.created_by),
    updatedBy: asString(input.updatedBy || input.updated_by),
  }
}

function normalizeTask(input: any): Task {
  const subtasks = Array.isArray(input.subtasks)
    ? input.subtasks.map((s: any) => normalizeSubtask(s))
    : []

  const durationHoursPerDayRaw = input.durationHoursPerDay ?? input.duration_hours_per_day
  const durationHoursPerDay =
    durationHoursPerDayRaw === null || durationHoursPerDayRaw === undefined || durationHoursPerDayRaw === ""
      ? null
      : asNumber(durationHoursPerDayRaw, NaN)

  const durationDaysRaw = input.durationDays ?? input.duration_days
  const durationDays =
    durationDaysRaw === null || durationDaysRaw === undefined || durationDaysRaw === ""
      ? null
      : asNumber(durationDaysRaw, NaN)

  const overtimeHoursPerDayRaw = input.overtimeHoursPerDay ?? input.overtime_hours_per_day
  const overtimeHoursPerDay =
    overtimeHoursPerDayRaw === null || overtimeHoursPerDayRaw === undefined || overtimeHoursPerDayRaw === ""
      ? null
      : asNumber(overtimeHoursPerDayRaw, NaN)

  const workingDaysRaw = input.workingDays ?? input.working_days
  const workingDays =
    workingDaysRaw === null || workingDaysRaw === undefined || workingDaysRaw === ""
      ? null
      : asNumber(workingDaysRaw, NaN)

  return {
    id: asString(input.id),
    projectId: asString(input.projectId || input.project_id),
    teamId:
      input.team_id || input.teamId
        ? asString(input.team_id || input.teamId)
        : null,
    title: asString(input.title),
    description: asString(input.description),
    status: (asString(input.status, "todo") as TaskStatus),
    priority: (asString(input.priority, "medium") as TaskPriority),
    orderIndex: asNumber(input.orderIndex || input.order_index),
    durationHoursPerDay: Number.isFinite(durationHoursPerDay) ? durationHoursPerDay : null,
    workingDays: Number.isFinite(workingDays) ? workingDays : Number.isFinite(durationDays) ? durationDays : null,
    durationDays: Number.isFinite(durationDays) ? durationDays : null,
    overtimeHoursPerDay: Number.isFinite(overtimeHoursPerDay) ? overtimeHoursPerDay : null,
    assignedTo: input.assigned_to || input.assignedTo ? asString(input.assigned_to || input.assignedTo) : null,
    assigneeIds: Array.isArray(input.assigneeIds)
      ? (input.assigneeIds as string[])
      : Array.isArray(input.assignee_ids)
        ? (input.assignee_ids as string[])
        : undefined,
    startDate: input.start_date || input.startDate ? asString(input.start_date || input.startDate) : null,
    dueDate: input.due_date || input.dueDate ? asString(input.due_date || input.dueDate) : null,
    completed: input.status === "done" || asBoolean(input.completed),
    subtasks,
    createdAt: asString(input.createdAt || input.created_at),
    createdBy: asString(input.createdBy || input.created_by),
    updatedBy: asString(input.updatedBy || input.updated_by),
    updatedAt: input.updatedAt || input.updated_at ? asString(input.updatedAt || input.updated_at) : undefined,
    comments: input.comments,
    attachments: input.attachments,
    reviewState: input.reviewState ?? input.review_state ? asString(input.reviewState ?? input.review_state) : null,
    reviewedBy: input.reviewedBy ?? input.reviewed_by ? asString(input.reviewedBy ?? input.reviewed_by) : null,
    reviewedAt: input.reviewedAt ?? input.reviewed_at ? asString(input.reviewedAt ?? input.reviewed_at) : null,
    rollingHourCap: asBoolean(input.rollingHourCap ?? input.rolling_hour_cap),
    sharedTaskBudget: asBoolean(input.sharedTaskBudget ?? input.shared_task_budget),
  }
}

// Types
export interface TaskSubtask {
  id: string
  taskId: string
  title: string
  completed: boolean
  orderIndex: number
  createdAt: string
  createdBy: string
  updatedBy: string
}

export interface Task {
  id: string
  projectId: string
  teamId: string | null
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  orderIndex: number
  durationHoursPerDay: number | null
  /** Mon–Fri count between start and due date. */
  workingDays?: number | null
  durationDays: number | null
  overtimeHoursPerDay: number | null
  /** When true, timer-limit.service.js's daily-hour cap for this task sums
   * the currently-open session's continuous elapsed time (clock-in to
   * clock-out) instead of resetting at the midnight day-bucket boundary. */
  rollingHourCap: boolean
  /** When true, this task's total-hours estimate is one pool shared by every
   * assignee combined, instead of each assignee getting their own full
   * allotment independently. */
  sharedTaskBudget: boolean
  assignedTo: string | null
  assigneeIds?: string[]
  startDate: string | null
  dueDate: string | null
  completed: boolean
  subtasks: TaskSubtask[]
  createdAt: string
  createdBy: string
  updatedBy: string
  /** Optimistic-concurrency token (§6.9) - sent back unchanged on save. */
  updatedAt?: string
  comments?: TaskComment[]
  attachments?: TaskAttachment[]
  reviewState: string | null
  reviewedBy: string | null
  reviewedAt: string | null
}

export interface TaskComment {
  id: string
  taskId: string
  body: string
  createdAt: string
  createdBy: string
  updatedBy: string
}

export interface TaskAttachment {
  id: string
  taskId: string
  fileUrl: string
  fileName: string
  uploadedAt: string
  uploadedBy: string
}

export interface CreateTaskInput {
  projectId: string
  teamId?: string | null
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  orderIndex?: number
  durationHoursPerDay?: number | null
  /** Mon–Fri count between start and due date (derived when saving). */
  workingDays?: number | null
  durationDays?: number | null
  overtimeHoursPerDay?: number | null
  rollingHourCap?: boolean
  sharedTaskBudget?: boolean
  assignedTo?: string | null
  assigneeIds?: string[]
  startDate?: string | null
  dueDate?: string | null
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  orderIndex?: number
  teamId?: string | null
  durationHoursPerDay?: number | null
  /** Mon–Fri count between start and due date (derived when saving). */
  workingDays?: number | null
  durationDays?: number | null
  overtimeHoursPerDay?: number | null
  rollingHourCap?: boolean
  sharedTaskBudget?: boolean
  assignedTo?: string | null
  assigneeIds?: string[]
  startDate?: string | null
  dueDate?: string | null
  reviewState?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  /** Optimistic-concurrency token (§6.9) - the updatedAt the form loaded
   * the task with. Optional: omitting it keeps the old blind-write
   * behavior. */
  expectedUpdatedAt?: string
}

export interface TaskHours {
  id: string
  taskId: string
  userId: string
  hoursSpent: number
  status: "pending" | "submitted" | "approved" | "rejected"
  submittedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTaskHoursInput {
  taskId: string
  userId: string
  hoursSpent: number
}

export interface UpdateTaskHoursInput {
  hoursSpent?: number
  status?: "pending" | "submitted" | "approved" | "rejected"
}

function normalizeTaskHours(input: Record<string, unknown>): TaskHours {
  return {
    id: asString(input.id),
    taskId: asString(input.taskId ?? input.task_id),
    userId: asString(input.userId ?? input.user_id),
    hoursSpent: asNumber(input.hoursSpent ?? input.hours_spent),
    status: asString(input.status, "pending") as TaskHours["status"],
    submittedAt: input.submittedAt ?? input.submitted_at ? asString(input.submittedAt ?? input.submitted_at) : null,
    createdAt: asString(input.createdAt ?? input.created_at),
    updatedAt: asString(input.updatedAt ?? input.updated_at),
  }
}

// API Functions

async function enrichTasksWithAssigneeFields(tasks: Task[]): Promise<Task[]> {
  if (!tasks.length) return tasks
  const needsEnrich = tasks.some((task) => !task.assigneeIds?.length)
  if (!needsEnrich) return tasks

  const res = await apiFetch(apiPath("/api/tasks/enrich"), {
    method: "POST",
    body: JSON.stringify({ taskIds: tasks.map((task) => task.id) }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !Array.isArray(json?.data)) return tasks

  const byId = new Map(
    (json.data as Record<string, unknown>[]).map((row) => [String(row.id ?? ""), normalizeTask(row)]),
  )
  return tasks.map((task) => {
    const enriched = byId.get(task.id)
    if (!enriched) return task
    return {
      ...task,
      assignedTo: enriched.assignedTo ?? task.assignedTo,
      assigneeIds: enriched.assigneeIds?.length ? enriched.assigneeIds : task.assigneeIds,
    }
  })
}

async function applyAssigneeSync(taskId: string, assigneeIds: string[] | undefined): Promise<void> {
  if (!assigneeIds?.length) return
  await syncTaskAssignments(taskId, assigneeIds, { removeUnlisted: true })
}

export async function getTasks(
  filters?: { projectId?: string; teamId?: string; status?: string; assignedTo?: string },
  options: RequestOptions & { fields?: string[] } = {},
): Promise<Task[]> {
  const params = new URLSearchParams()
  if (filters?.projectId) params.append("project_id", filters.projectId)
  if (filters?.teamId) params.append("team_id", filters.teamId)
  if (filters?.status) params.append("status", filters.status)
  if (filters?.assignedTo) params.append("assigned_to", filters.assignedTo)
  if (options.fields?.length) params.append("fields", options.fields.join(","))

  const query = params.toString() ? `?${params.toString()}` : ""
  const { res, json } = await fetchJsonWithRetry<Envelope<Task[]>>(apiPath(`/api/tasks${query}`), {}, { ...options, retries: 1 })

  if (!res.ok) throw extractApiError(res.status, "Failed to fetch tasks", json)
  if (!json) throw new Error("Failed to parse tasks response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json) ?? []
  const tasks = Array.isArray(data) ? data.map(normalizeTask) : []
  if (!filters?.assignedTo && tasks.length > 0) {
    return enrichTasksWithAssigneeFields(tasks)
  }
  return tasks
}

export async function getTask(id: string, options?: RequestOptions): Promise<Task> {
  const { res, json } = await fetchJsonWithRetry<Envelope<Task>>(apiPath(`/api/tasks/${id}`), {}, { ...options })

  if (!res.ok) throw extractApiError(res.status, "Failed to fetch task", json)
  if (!json) throw new Error("Failed to parse task response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json)
  if (!data) throw new Error("No task data in response")

  return normalizeTask(data)
}

export async function createTask(input: CreateTaskInput, options?: RequestOptions): Promise<Task> {
  const payload: Record<string, unknown> = {
    project_id: input.projectId,
    title: input.title,
    description: input.description || "",
    status: input.status || "todo",
    priority: input.priority || "medium",
    order_index: input.orderIndex || 0,
    assigned_to: input.assignedTo || input.assigneeIds?.[0] || null,
    start_date: input.startDate || null,
    due_date: input.dueDate || null,
  }
  if (input.teamId) payload.team_id = input.teamId
  if (input.durationHoursPerDay != null && input.durationHoursPerDay >= 0) {
    payload.duration_hours_per_day = input.durationHoursPerDay
  }
  if (input.workingDays != null && input.workingDays >= 0) {
    payload.working_days = input.workingDays
  }
  if (input.durationDays != null && input.durationDays >= 0) {
    payload.duration_days = input.durationDays
  }
  if (input.overtimeHoursPerDay != null && input.overtimeHoursPerDay >= 0) {
    payload.overtime_hours_per_day = input.overtimeHoursPerDay
  }
  if (input.rollingHourCap !== undefined) {
    payload.rolling_hour_cap = input.rollingHourCap
  }
  if (input.sharedTaskBudget !== undefined) {
    payload.shared_task_budget = input.sharedTaskBudget
  }

  const assigneeIds = input.assigneeIds?.length ? input.assigneeIds : undefined

  const { res, json } = await fetchJsonWithRetry<Envelope<Task>>(apiPath("/api/tasks"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, { ...options })

  if (!res.ok) throw extractApiError(res.status, "Failed to create task", json)
  if (!json) throw new Error("Failed to parse create response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json)
  if (!data) throw new Error("No task data in response")

  const created = normalizeTask(data)
  if (assigneeIds?.length) {
    await applyAssigneeSync(created.id, assigneeIds)
    return getTask(created.id, options)
  }
  return created
}

export async function updateTask(id: string, input: UpdateTaskInput, options?: RequestOptions): Promise<Task> {
  const assigneeIds = input.assigneeIds

  const payload: Record<string, unknown> = {}
  if (input.title !== undefined) payload.title = input.title
  if (input.description !== undefined) payload.description = input.description
  if (input.status !== undefined) payload.status = input.status
  if (input.priority !== undefined) payload.priority = input.priority
  if (input.orderIndex !== undefined) payload.order_index = input.orderIndex
  if (input.teamId !== undefined) payload.team_id = input.teamId
  if (input.durationHoursPerDay !== undefined) payload.duration_hours_per_day = input.durationHoursPerDay
  if (input.workingDays !== undefined) payload.working_days = input.workingDays
  if (input.durationDays !== undefined) payload.duration_days = input.durationDays
  if (input.overtimeHoursPerDay !== undefined) payload.overtime_hours_per_day = input.overtimeHoursPerDay
  if (input.rollingHourCap !== undefined) payload.rolling_hour_cap = input.rollingHourCap
  if (input.sharedTaskBudget !== undefined) payload.shared_task_budget = input.sharedTaskBudget
  if (input.assignedTo !== undefined) payload.assigned_to = input.assignedTo
  if (input.startDate !== undefined) payload.start_date = input.startDate
  if (input.dueDate !== undefined) payload.due_date = input.dueDate
  if (input.reviewState !== undefined) payload.review_state = input.reviewState
  if (input.reviewedBy !== undefined) payload.reviewed_by = input.reviewedBy
  if (input.reviewedAt !== undefined) payload.reviewed_at = input.reviewedAt
  if (input.expectedUpdatedAt !== undefined) payload.expected_updated_at = input.expectedUpdatedAt

  if (Object.keys(payload).length > 0) {
    const { res, json } = await fetchJsonWithRetry<Envelope<Task>>(apiPath(`/api/tasks/${id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, { ...options })

    if (!res.ok) {
      // §6.9 - same convention updateProject uses: attach .status so the
      // caller can branch on a stale-write conflict instead of treating it
      // like any other failed save.
      const err = extractApiError(res.status, "Failed to update task", json) as Error & {
        status?: number
        conflictData?: unknown
      }
      err.status = res.status
      if (res.status === 409) err.conflictData = json?.data
      throw err
    }
    if (!json) throw new Error("Failed to parse update response")
    if (!json.success && json.error) throw new Error(json.error)
  }

  if (assigneeIds !== undefined) {
    await applyAssigneeSync(id, assigneeIds)
  }

  return getTask(id, options)
}

export async function deleteTask(id: string, options?: RequestOptions): Promise<void> {
  const { res, json } = await fetchJsonWithRetry<Envelope<unknown>>(apiPath(`/api/tasks/${id}`), { method: "DELETE" }, { ...options })

  if (res.status === 404) return
  if (!res.ok) throw extractApiError(res.status, "Failed to delete task", json)
  if (json && !json.success && json.error) throw new Error(json.error)
}

export interface ReorderTaskUpdate {
  id: string
  orderIndex: number
}

async function reorderTasks(updates: ReorderTaskUpdate[], options?: RequestOptions): Promise<Task[]> {
  const payload = {
    updates: updates.map((u) => ({
      id: u.id,
      order_index: u.orderIndex,
    })),
  }

  const { res, json } = await fetchJsonWithRetry<Envelope<Task[]>>(apiPath("/api/tasks/batch/reorder"), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, { ...options })

  if (!res.ok) throw extractApiError(res.status, "Failed to reorder tasks", json)
  if (!json) throw new Error("Failed to parse reorder response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json) ?? []
  return Array.isArray(data) ? data.map(normalizeTask) : []
}

// Subtask Functions
async function createSubtask(taskId: string, title: string, options?: RequestOptions): Promise<TaskSubtask> {
  const payload = {
    task_id: taskId,
    title,
    completed: false,
  }

  const { res, json } = await fetchJsonWithRetry<Envelope<TaskSubtask>>(apiPath("/api/task-subtasks"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, { ...options })

  if (!res.ok) throw extractApiError(res.status, "Failed to create subtask", json)
  if (!json) throw new Error("Failed to parse create response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json)
  if (!data) throw new Error("No subtask data in response")

  return normalizeSubtask(data)
}

async function updateSubtask(id: string, input: Partial<TaskSubtask>, options?: RequestOptions): Promise<TaskSubtask> {
  const payload: Record<string, unknown> = {}
  if (input.title !== undefined) payload.title = input.title
  if (input.completed !== undefined) payload.completed = input.completed
  if (input.orderIndex !== undefined) payload.order_index = input.orderIndex

  const { res, json } = await fetchJsonWithRetry<Envelope<TaskSubtask>>(apiPath(`/api/task-subtasks/${id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, { ...options })

  if (!res.ok) throw extractApiError(res.status, "Failed to update subtask", json)
  if (!json) throw new Error("Failed to parse update response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json)
  if (!data) throw new Error("No subtask data in response")

  return normalizeSubtask(data)
}

async function deleteSubtask(id: string, options?: RequestOptions): Promise<void> {
  const { res, json } = await fetchJsonWithRetry<Envelope<unknown>>(apiPath(`/api/task-subtasks/${id}`), { method: "DELETE" }, { ...options })

  if (!res.ok) throw extractApiError(res.status, "Failed to delete subtask", json)
  if (json && !json.success && json.error) throw new Error(json.error)
}

// Task Comments
async function getTaskComments(taskId?: string): Promise<TaskComment[]> {
  const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : ""
  const res = await apiFetch(apiPath(`/api/task-comments${query}`))
  if (!res.ok) throw new Error(`Failed to fetch comments: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch comments")
  return json.data
}

async function createTaskComment(taskId: string, body: string, createdBy?: string): Promise<TaskComment> {
  const res = await apiFetch(apiPath("/api/task-comments"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId, body, created_by: createdBy }),
  })
  if (!res.ok) throw new Error(`Failed to create comment: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to create comment")
  return json.data
}

async function updateTaskComment(id: string, body: string, updatedBy?: string): Promise<TaskComment> {
  const res = await apiFetch(apiPath(`/api/task-comments/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, updated_by: updatedBy }),
  })
  if (!res.ok) throw new Error(`Failed to update comment: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to update comment")
  return json.data
}

async function deleteTaskComment(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/task-comments/${id}`), { method: "DELETE" })
  if (!res.ok) throw new Error(`Failed to delete comment: ${res.status}`)
}

// Task Attachments
async function getTaskAttachments(taskId?: string): Promise<TaskAttachment[]> {
  const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : ""
  const res = await apiFetch(apiPath(`/api/task-attachments${query}`))
  if (!res.ok) throw new Error(`Failed to fetch attachments: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to fetch attachments")
  return json.data
}

async function createTaskAttachment(taskId: string, fileUrl: string, fileName: string, uploadedBy?: string): Promise<TaskAttachment> {
  const res = await apiFetch(apiPath("/api/task-attachments"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, fileUrl, fileName, uploadedBy }),
  })
  if (!res.ok) throw new Error(`Failed to create attachment: ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || "Failed to create attachment")
  return json.data
}

async function deleteTaskAttachment(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/task-attachments/${id}`), { method: "DELETE" })
  if (!res.ok) throw new Error(`Failed to delete attachment: ${res.status}`)
}

// Task Hours Functions
export async function getTaskHours(taskId: string, options?: RequestOptions): Promise<TaskHours[]> {
  const { res, json } = await fetchJsonWithRetry<Envelope<Record<string, unknown>[]>>(apiPath(`/api/tasks/${taskId}/hours`), {}, { ...options })

  if (!res.ok) throw extractApiError(res.status, "Failed to fetch task hours", json)
  if (!json) throw new Error("Failed to parse task hours response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json) ?? []
  return Array.isArray(data) ? data.map((row) => normalizeTaskHours(row)) : []
}

async function getTaskHoursForUser(taskId: string, userId: string, options?: RequestOptions): Promise<TaskHours | null> {
  const { res, json } = await fetchJsonWithRetry<Envelope<Record<string, unknown>[]>>(apiPath(`/api/tasks/${taskId}/hours/${userId}`), {}, { ...options })

  if (!res.ok) throw extractApiError(res.status, "Failed to fetch task hours for user", json)
  if (!json) throw new Error("Failed to parse task hours response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json)
  if (!Array.isArray(data) || data.length === 0) return null
  return normalizeTaskHours(data[0]!)
}

export async function createTaskHours(input: CreateTaskHoursInput, options?: RequestOptions): Promise<TaskHours> {
  const payload = {
    user_id: input.userId,
    hours_spent: input.hoursSpent,
  }

  const { res, json } = await fetchJsonWithRetry<Envelope<Record<string, unknown>>>(
    apiPath(`/api/tasks/${input.taskId}/hours`),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    { ...options },
  )

  if (!res.ok) throw extractApiError(res.status, "Failed to create task hours", json)
  if (!json) throw new Error("Failed to parse create response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json)
  if (!data) throw new Error("No task hours data in response")

  return normalizeTaskHours(data)
}

export async function updateTaskHours(
  taskId: string,
  hoursId: string,
  input: UpdateTaskHoursInput,
  options?: RequestOptions,
): Promise<TaskHours> {
  const payload: Record<string, unknown> = {}
  if (input.hoursSpent !== undefined) payload.hours_spent = input.hoursSpent
  if (input.status !== undefined) payload.status = input.status

  const { res, json } = await fetchJsonWithRetry<Envelope<Record<string, unknown>>>(
    apiPath(`/api/tasks/${taskId}/hours/${hoursId}`),
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    { ...options },
  )

  if (!res.ok) throw extractApiError(res.status, "Failed to update task hours", json)
  if (!json) throw new Error("Failed to parse update response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json)
  if (!data) throw new Error("No task hours data in response")

  return normalizeTaskHours(data)
}

export async function submitTaskReview(
  taskId: string,
  decision: "approved" | "rejected",
  reviewedBy: string,
  options?: RequestOptions,
): Promise<Task> {
  const payload = {
    decision,
    reviewed_by: reviewedBy,
  }

  const { res, json } = await fetchJsonWithRetry<Envelope<Task>>(
    apiPath(`/api/tasks/${taskId}/review`),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    { ...options },
  )

  if (!res.ok) throw extractApiError(res.status, "Failed to submit task review", json)
  if (!json) throw new Error("Failed to parse review response")
  if (!json.success && json.error) throw new Error(json.error)

  const data = pickPayload(json)
  if (!data) throw new Error("No task data in response")

  return normalizeTask(data)
}
