"use client"

import { useEffect, useRef } from "react"
import { useActivityTracking } from "@/features/activity/components/activity-tracking-context"
import { setTimerTask, type TimerTaskRef } from "@/features/activity/utils/timer-task-storage"

type TimerTaskSelectionSyncProps = {
  selectedTaskForTimer: TimerTaskRef | null
}

function toTaskRef(task: TimerTaskRef): TimerTaskRef {
  return {
    id: task.id,
    title: task.title,
    durationHoursPerDay: task.durationHoursPerDay ?? null,
    durationDays: task.durationDays ?? null,
    overtimeHoursPerDay: task.overtimeHoursPerDay ?? null,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    workingDays: task.workingDays ?? null,
  }
}

/** Keeps activity timer context aligned with sidebar task selection (by task id only). */
export function TimerTaskSelectionSync({ selectedTaskForTimer }: TimerTaskSelectionSyncProps) {
  const { setCurrentTask, phase } = useActivityTracking()
  const syncedTaskIdRef = useRef<string | null>(null)

  useEffect(() => {
    const nextId = selectedTaskForTimer?.id ?? null

    // Do not wipe the running timer when sidebar state flickers or reloads with null.
    if (!nextId) {
      if (phase === "online") {
        syncedTaskIdRef.current = null
        setCurrentTask(null)
        setTimerTask(null)
      }
      return
    }

    if (syncedTaskIdRef.current === nextId) return

    const taskRef = toTaskRef(selectedTaskForTimer!)
    syncedTaskIdRef.current = nextId
    setTimerTask(taskRef)
    setCurrentTask(taskRef)
  }, [phase, selectedTaskForTimer, setCurrentTask])

  return null
}
