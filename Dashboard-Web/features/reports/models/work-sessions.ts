export type WorkSessionGroupBy = "date" | "member" | "project" | "client"

export type WorkSessionScope = "me" | "all"

export interface WorkSessionRow {
  id: string
  date: string
  client: string
  projectName: string
  projectLetter: string
  projectColor: string
  memberId: string
  memberName: string
  memberInitials: string
  todoJob: string
  manualPct: number
  startedLabel: string
  stoppedLabel: string
  durationHms: string
  activityPct: number
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
