"use client"

import {
  createTask,
  deleteTask as deleteTaskApi,
  getTask,
  getTasks,
  updateTask as updateTaskApi,
  createTaskHours,
  updateTaskHours,
  submitTaskReview,
  type CreateTaskInput,
  type TaskHours,
  type UpdateTaskInput,
} from "@/infrastructure/api"
import {
  type Task,
  type TaskStatus,
  type Member,
  type Priority,
  TASK_PROJECT_COLORS,
  MEMBER_COLORS,
} from "@/features/projects/constants"
import { countWorkingDaysBetween } from "@/features/tasks/utils/working-days"

// Helper to map api tasks
function mapApiTask(row: any): Task {
  const durationHoursPerDayRaw = row.durationHoursPerDay ?? row.duration_hours_per_day
  const durationHoursPerDay =
    durationHoursPerDayRaw === null || durationHoursPerDayRaw === undefined || durationHoursPerDayRaw === ""
      ? null
      : Number(durationHoursPerDayRaw)
  
  const durationDaysRaw = row.durationDays ?? row.duration_days
  const durationDays =
    durationDaysRaw === null || durationDaysRaw === undefined || durationDaysRaw === ""
      ? null
      : Number(durationDaysRaw)
  
  const overtimeHoursPerDayRaw = row.overtimeHoursPerDay ?? row.overtime_hours_per_day
  const overtimeHoursPerDay =
    overtimeHoursPerDayRaw === null || overtimeHoursPerDayRaw === undefined || overtimeHoursPerDayRaw === ""
      ? null
      : Number(overtimeHoursPerDayRaw)
  
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? "Untitled task"),
    description: String(row.description ?? ""),
    status: (row.status ?? "todo") as TaskStatus,
    priority: (row.priority ?? "medium") as Priority,
    orderIndex: Number(row.orderIndex ?? row.order_index ?? 0),
    assignedTo: (row.assignedTo as string) || (row.assigned_to as string) || null,
    assigneeIds: Array.isArray(row.assigneeIds)
      ? (row.assigneeIds as string[])
      : Array.isArray(row.assignee_ids)
        ? (row.assignee_ids as string[])
        : undefined,
    projectId: String(row.projectId ?? row.project_id ?? "p1"),
    teamId: (row.teamId as string) || (row.team_id as string) || null,
    durationHoursPerDay: Number.isFinite(durationHoursPerDay) ? durationHoursPerDay : null,
    durationDays: Number.isFinite(durationDays) ? durationDays : null,
    overtimeHoursPerDay: Number.isFinite(overtimeHoursPerDay) ? overtimeHoursPerDay : null,
    startDate: (row.startDate as string) || (row.start_date as string) || null,
    dueDate: (row.dueDate as string) || (row.due_date as string) || null,
    completed: (row.status ?? "todo") === "done",
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
    createdBy: String(row.createdBy ?? row.created_by ?? ""),
    updatedBy: String(row.updatedBy ?? row.updated_by ?? ""),
    reviewState: asStringOrNull(row.reviewState ?? row.review_state),
    reviewedBy: asStringOrNull(row.reviewedBy ?? row.reviewed_by),
    reviewedAt: asStringOrNull(row.reviewedAt ?? row.reviewed_at),
    totalAssignees: asNumberOrNull(row.totalAssignees ?? row.total_assignees),
    startedAssignees: asNumberOrNull(row.startedAssignees ?? row.started_assignees),
    notStartedAssignees: asNumberOrNull(row.notStartedAssignees ?? row.not_started_assignees),
    participationPercent: asNumberOrNull(row.participationPercent ?? row.participation_percent),
    allAssigneesStarted: row.allAssigneesStarted === true || row.all_assignees_started === true,
  }
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function asStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  return String(value)
}

interface UseTaskMutationsProps {
  selectedProjectId: string
  selectedTaskId: string | null
  setSelectedTaskId: (id: string | null) => void
  taskPreview: { taskId: string; anchor: any } | null
  setTaskPreview: (preview: { taskId: string; anchor: any } | null) => void
  setTasks: (value: Task[] | ((prev: Task[]) => Task[])) => void
  setShowCompleted: (show: boolean) => void
  currentMemberId: string | undefined
  canMarkCompleted?: boolean
}

export function useTaskMutations({
  selectedProjectId,
  selectedTaskId,
  setSelectedTaskId,
  taskPreview,
  setTaskPreview,
  setTasks,
  setShowCompleted,
  currentMemberId,
  canMarkCompleted = false,
}: UseTaskMutationsProps) {

  function applyTaskToState(mapped: Task, taskId?: string) {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === (taskId ?? mapped.id) ? { ...mapped, completed: mapped.status === "done" } : task,
      ),
    )
  }

  async function deleteTask(id: string) {
    if (selectedTaskId === id) setSelectedTaskId(null)
    if (taskPreview?.taskId === id) setTaskPreview(null)
    
    // Optimistic update
    setTasks((prev) => prev.filter((task) => task.id !== id))

    try {
      await deleteTaskApi(id)
    } catch {
      // Re-fetch on error
      const fetched = await getTasks(
        { projectId: selectedProjectId },
        {
          fields: [
            "id", "title", "description", "status", "priority", "order_index", "assigned_to",
            "project_id", "team_id", "duration_hours_per_day", "duration_days",
            "overtime_hours_per_day", "start_date", "due_date", "created_at", "created_by",
            "updated_by", "review_state", "reviewed_by", "reviewed_at"
          ],
        },
      )
      setTasks((fetched ?? []).map(mapApiTask))
    }
  }

  async function updateTask(id: string, patch: Partial<Task>) {
    if (patch.status === "in_review") {
      throw new Error("Tasks enter In Review automatically when logged hours reach the expected workload.")
    }
    if ((patch.status === "done" || patch.completed === true) && !canMarkCompleted) {
      throw new Error("Only management can mark tasks as Completed via the timesheet approval workflow.")
    }
    if (patch.status === "done" || patch.completed === true) setShowCompleted(true)

    setTasks((prev) => {
      const exists = prev.some((task) => task.id === id)
      if (!exists) return [...prev, patch as Task]
      return prev.map((task) => (task.id === id ? { ...task, ...patch } : task))
    })

    const apiPayload: Record<string, any> = {}
    if (patch.title !== undefined) apiPayload.title = patch.title
    if (patch.description !== undefined) apiPayload.description = patch.description
    if (patch.status !== undefined) apiPayload.status = patch.status
    if (patch.priority !== undefined) apiPayload.priority = patch.priority
    if (patch.orderIndex !== undefined) apiPayload.orderIndex = patch.orderIndex
    if (patch.assignedTo !== undefined) apiPayload.assignedTo = patch.assignedTo
    if (patch.teamId !== undefined) apiPayload.teamId = patch.teamId
    if (patch.startDate !== undefined) apiPayload.startDate = patch.startDate
    if (patch.dueDate !== undefined) apiPayload.dueDate = patch.dueDate
    if (patch.durationHoursPerDay !== undefined) apiPayload.durationHoursPerDay = patch.durationHoursPerDay
    if (patch.durationDays !== undefined) apiPayload.durationDays = patch.durationDays
    if (patch.overtimeHoursPerDay !== undefined) apiPayload.overtimeHoursPerDay = patch.overtimeHoursPerDay
    if ((patch as { assigneeIds?: string[] }).assigneeIds !== undefined) {
      apiPayload.assigneeIds = (patch as { assigneeIds?: string[] }).assigneeIds
    }

    try {
      const updated = await updateTaskApi(id, apiPayload)
      applyTaskToState(mapApiTask(updated as unknown as Record<string, unknown>), id)
    } catch (error) {
      const fetched = await getTasks(
        { projectId: selectedProjectId },
        {
          fields: [
            "id", "title", "description", "status", "priority", "order_index", "assigned_to",
            "project_id", "team_id", "duration_hours_per_day", "duration_days",
            "overtime_hours_per_day", "start_date", "due_date", "created_at", "created_by",
            "updated_by", "review_state", "reviewed_by", "reviewed_at"
          ],
        },
      )
      setTasks((fetched ?? []).map(r => mapApiTask(r as unknown as Record<string, unknown>)))
    }
  }

  async function duplicateTask(task: Task) {
    if (!selectedProjectId) return
    const assigneeIds = task.assigneeIds?.length
      ? task.assigneeIds
      : task.assignedTo
        ? [task.assignedTo]
        : []
    const created = await createTask({
      projectId: selectedProjectId,
      teamId: task.teamId,
      title: `${task.title} (copy)`,
      description: task.description,
      status: task.status === "in_review" ? "todo" : task.status,
      priority: task.priority,
      assignedTo: task.assignedTo,
      assigneeIds,
      durationHoursPerDay: task.durationHoursPerDay,
      durationDays: task.durationDays,
      overtimeHoursPerDay: task.overtimeHoursPerDay,
      startDate: task.startDate,
      dueDate: task.dueDate,
    })
    const fresh = await getTask(created.id)
    const createdTask = mapApiTask(fresh as unknown as Record<string, unknown>)
    setTasks((prev) => [...prev, createdTask])
    setSelectedTaskId(createdTask.id)
  }

  async function handleSaveTaskForm(
    editingId: string | null,
    formValues: {
      title: string
      description: string
      teamId: string | null
      status: TaskStatus
      priority: Priority
      assignedTo: string | null
      assigneeIds?: string[]
      startDate: string
      dueDate: string
      durationHoursPerDay: string
      overtimeHoursPerDay: string
      position: "Top" | "Bottom"
      /** Optimistic-concurrency token (§6.9) - the task's updatedAt when
       * the form loaded, sent back unchanged so a stale write 409s. */
      expectedUpdatedAt?: string
    }
  ) {
    const durationHoursPerDay = formValues.durationHoursPerDay.trim() ? Number(formValues.durationHoursPerDay) : null
    const overtimeHoursPerDay = formValues.overtimeHoursPerDay.trim() ? Number(formValues.overtimeHoursPerDay) : null

    const startDate = formValues.startDate.trim() || null
    const dueDate = formValues.dueDate.trim() || null

    const workingDays = countWorkingDaysBetween(startDate, dueDate)
    let durationDays: number | null = workingDays
    if (durationDays == null && startDate && dueDate) {
      const start = new Date(startDate)
      const end = new Date(dueDate)
      const diffTime = end.getTime() - start.getTime()
      durationDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      if (durationDays < 0) durationDays = 0
    }

    if (formValues.status === "in_review") {
      throw new Error("Tasks enter In Review automatically when logged hours reach the expected workload.")
    }

    const assigneeIds = formValues.assigneeIds?.length
      ? formValues.assigneeIds
      : formValues.assignedTo
        ? [formValues.assignedTo]
        : []
    const primaryAssignee = assigneeIds[0] ?? formValues.assignedTo ?? null

    const completed = formValues.status === "done"

    const durationFields: Pick<
      UpdateTaskInput,
      "startDate" | "dueDate" | "durationHoursPerDay" | "workingDays" | "durationDays" | "overtimeHoursPerDay"
    > = {
      startDate,
      dueDate,
      durationHoursPerDay,
      workingDays,
      durationDays,
      overtimeHoursPerDay,
    }

    if (editingId) {
      const updatePayload: UpdateTaskInput = {
        title: formValues.title.trim(),
        description: formValues.description.trim(),
        teamId: formValues.teamId,
        status: formValues.status,
        priority: formValues.priority,
        assignedTo: primaryAssignee,
        assigneeIds,
        ...durationFields,
        expectedUpdatedAt: formValues.expectedUpdatedAt,
      }
      // §6.9 - a 409 here (stale write) is left to propagate: the modal's
      // own submit handler shows a reload/keep-editing notice instead of a
      // generic save error.
      await updateTaskApi(editingId, updatePayload)
      const fresh = await getTask(editingId)
      applyTaskToState(mapApiTask(fresh as unknown as Record<string, unknown>), editingId)
      if (completed) setShowCompleted(true)
    } else {
      if (!selectedProjectId) return
      const createPayload: CreateTaskInput = {
        projectId: selectedProjectId,
        teamId: formValues.teamId,
        title: formValues.title.trim(),
        description: formValues.description.trim(),
        status: formValues.status,
        priority: formValues.priority,
        assignedTo: primaryAssignee,
        assigneeIds,
        ...durationFields,
      }
      const created = await createTask(createPayload)
      const fresh = await getTask(created.id)
      const createdTask = mapApiTask(fresh as unknown as Record<string, unknown>)
      setTasks((prev) => {
        if (formValues.position === "Top") {
          return [createdTask, ...prev]
        }
        return [...prev, createdTask]
      })
    }
  }

  async function submitHoursSpent(taskId: string, hours: number, taskHoursList: TaskHours[]) {
    if (!currentMemberId) throw new Error("Sign in to submit hours")

    const existingHours = taskHoursList.find((h) => h.userId === currentMemberId)

    if (existingHours) {
      await updateTaskHours(taskId, existingHours.id, { hoursSpent: hours, status: "submitted" })
    } else {
      await createTaskHours({ taskId, userId: currentMemberId, hoursSpent: hours })
    }
  }

  async function submitReviewDecision(taskId: string, decision: "approved" | "rejected") {
    if (!currentMemberId) throw new Error("Sign in to review tasks")
    await submitTaskReview(taskId, decision, currentMemberId)
    const fresh = await getTask(taskId)
    applyTaskToState(mapApiTask(fresh as unknown as Record<string, unknown>), taskId)
  }

  return {
    deleteTask,
    updateTask,
    duplicateTask,
    handleSaveTaskForm,
    submitHoursSpent,
    submitReviewDecision,
  }
}
