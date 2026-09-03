import { estimateAssignmentSeconds } from "@/features/tasks/utils/working-days"

export type TimerTaskRef = {
  id: string
  title: string
  durationHoursPerDay?: number | null
  durationDays?: number | null
  overtimeHoursPerDay?: number | null
  startDate?: string | null
  dueDate?: string | null
  workingDays?: number | null
}

export type TaskTimerState = {
  activeSeconds: number
  idleSeconds: number
}

const EMPTY_TIMER: TaskTimerState = { activeSeconds: 0, idleSeconds: 0 }

let scopedMemberId: string | null = null

export function configureTimerStorageScope(memberId: string | null | undefined): void {
  scopedMemberId = typeof memberId === "string" && memberId.trim() ? memberId.trim() : null
}

function timersStorageKey(): string {
  return scopedMemberId ? `vt-task-timers:${scopedMemberId}` : "vt-task-timers:anonymous"
}

function selectedTaskStorageKey(): string {
  return scopedMemberId ? `vt-timer-task:${scopedMemberId}` : "vt-timer-task:anonymous"
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(key, value)
    sessionStorage.setItem(key, value)
  } catch {
    /* ignore quota */
  }
}

function removeStorage(key: string): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function readTimersMap(): Record<string, TaskTimerState> {
  try {
    const raw = readStorage(timersStorageKey())
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, TaskTimerState>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeTimersMap(map: Record<string, TaskTimerState>): void {
  writeStorage(timersStorageKey(), JSON.stringify(map))
}

export function getTaskTimerLimitSeconds(task: TimerTaskRef | null | undefined): number | null {
  if (!task) return null
  return estimateAssignmentSeconds({
    durationHoursPerDay: task.durationHoursPerDay,
    overtimeHoursPerDay: task.overtimeHoursPerDay,
    startDate: task.startDate,
    dueDate: task.dueDate,
    durationDays: task.durationDays,
    workingDays: task.workingDays,
  })
}

export function getTaskTimerState(taskId: string): TaskTimerState {
  const map = readTimersMap()
  const entry = map[taskId]
  if (!entry) return { ...EMPTY_TIMER }
  return {
    activeSeconds: Math.max(0, Math.floor(entry.activeSeconds ?? 0)),
    idleSeconds: Math.max(0, Math.floor(entry.idleSeconds ?? 0)),
  }
}

export function setTaskTimerState(taskId: string, state: TaskTimerState): void {
  const map = readTimersMap()
  map[taskId] = {
    activeSeconds: Math.max(0, Math.floor(state.activeSeconds)),
    idleSeconds: Math.max(0, Math.floor(state.idleSeconds)),
  }
  writeTimersMap(map)
}

export function resetTaskTimerState(taskId: string): void {
  const map = readTimersMap()
  delete map[taskId]
  writeTimersMap(map)
}

export function clearAllTaskTimerStateForScope(): void {
  removeStorage(timersStorageKey())
  removeStorage(selectedTaskStorageKey())
}

export function setTimerTask(task: TimerTaskRef | null): void {
  if (typeof window === "undefined") return
  try {
    const key = selectedTaskStorageKey()
    if (!task) {
      removeStorage(key)
      return
    }
    writeStorage(
      key,
      JSON.stringify({
        id: task.id,
        title: task.title,
        durationHoursPerDay: task.durationHoursPerDay ?? null,
        durationDays: task.durationDays ?? null,
        overtimeHoursPerDay: task.overtimeHoursPerDay ?? null,
        startDate: task.startDate ?? null,
        dueDate: task.dueDate ?? null,
        workingDays: task.workingDays ?? null,
      } satisfies TimerTaskRef),
    )
  } catch {
    /* ignore quota */
  }
}

export function getTimerTask(): TimerTaskRef | null {
  try {
    const raw = readStorage(selectedTaskStorageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as TimerTaskRef
    if (!parsed?.id || !parsed?.title) return null
    return parsed
  } catch {
    return null
  }
}

export function applyBackendTaskTimerState(
  taskId: string,
  state: TaskTimerState,
  options?: { preferLocalIfHigher?: boolean },
): TaskTimerState {
  const local = getTaskTimerState(taskId)
  const normalized: TaskTimerState = {
    activeSeconds: Math.max(0, Math.floor(state.activeSeconds ?? 0)),
    idleSeconds: Math.max(0, Math.floor(state.idleSeconds ?? 0)),
  }
  const merged: TaskTimerState =
    options?.preferLocalIfHigher === true
      ? {
          activeSeconds: Math.max(local.activeSeconds, normalized.activeSeconds),
          idleSeconds: Math.max(local.idleSeconds, normalized.idleSeconds),
        }
      : normalized
  setTaskTimerState(taskId, merged)
  return merged
}
