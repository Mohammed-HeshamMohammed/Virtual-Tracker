"use client"

import { AlertTriangle } from "lucide-react"
import { useAuth } from "@/shared/providers/app"

/** Info banner when member needs hierarchy assignment (backend enforces access). */
export function HierarchyAssignmentBanner() {
  const { currentMember } = useAuth()
  const hierarchyStatus = currentMember?.hierarchy_status

  if (hierarchyStatus !== "hierarchy_assignment_required") {
    return null
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">Hierarchy assignment required</p>
        <p className="mt-0.5 text-amber-800 dark:text-amber-200/90">
          Your account needs to be assigned to a team before you can access projects, tasks, teams, and member management.
          An administrator has been notified.
        </p>
      </div>
    </div>
  )
}
