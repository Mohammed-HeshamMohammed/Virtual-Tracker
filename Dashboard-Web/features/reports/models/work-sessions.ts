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
  memberAvatarUrl?: string | null
  todoJob: string
  manualPct: number
  startedLabel: string
  stoppedLabel: string
  /** Why the session ended, in words ("Idle past the project's allowance",
   *  "Agent closed"). Null while running, and for sessions from before the
   *  server recorded reasons. */
  stoppedBy?: string | null
  /** Short zone of the member who worked the shift ("CDT"), so the start and
   *  stop times above are never ambiguous about whose clock they are on. */
  timezoneLabel?: string
  durationHms: string
  /** The average of the session's screenshot activity levels - the same activity the
   *  Screenshots, Apps, URLs and Time & Activity pages show. */
  activityPct: number
  activitySum: number
  /** Screenshots in the session; 0 means its activity is unknown. */
  activityCount: number
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
