export type WorkSessionGroupBy = "date" | "member" | "project" | "client"

export type WorkSessionScope = "me" | "all"

export interface WorkSessionRow {
  id: string
  /** Local calendar day (YYYY-MM-DD). */
  date: string
  client: string
  projectName: string
  projectLetter: string
  /** CSS color for project badge. */
  projectColor: string
  memberId: string
  memberName: string
  memberInitials: string
  todoJob: string
  manualPct: number
  startedLabel: string
  stoppedLabel: string
  /** H:MM:SS or HH:MM:SS */
  durationHms: string
  activityPct: number
  /** Optional break within session (demo). */
  breakHms?: string
}

export type WorkSessionColumnKey =
  | "client"
  | "project"
  | "member"
  | "todo"
  | "manual"
  | "started"
  | "stopped"
  | "duration"
  | "activity"
