export type TimeActivityMetric = "total_hours" | "activity" | "total_spent"

export type TimeActivityGroupBy =
  | "date_per_day"
  | "date_per_week"
  | "member"
  | "project"
  | "client"
  | "team"

export interface TimeActivityDayRow {
  date: string
  dateLabel: string
  memberCount: number
  projectCount: number
  client: string
  team: string
  todo: string
  regularHours: string
  breakTime: string
  totalHours: string
  activityPct: number
  idlePct: string
  idleHr: string
  totalSpent: string
  trackedHours: number
  manualHours: number
}

export interface TimeActivityMemberSubRow {
  name: string
  avatar: string
  regularHours: string
  totalHours: string
  breakTime: string
  activityPct: number
  idlePct: string
  idleHr: string
  totalSpent: string
  trackedHours: number
  manualHours: number
  projectNames: string[]
}

/**
 * One (day, member, project) fact - finer-grained than TimeActivityDayRow's
 * own `members` (which collapses a member's whole day into one row with a
 * Set of project *names*, no per-project time). This is what the "Data
 * grouped by" dropdown actually aggregates from for every mode besides the
 * default "Date per day" - see group-aggregate.ts.
 */
export interface TimeActivityEntry {
  date: string
  memberId: string
  memberName: string
  projectId: string | null
  projectName: string
  clientName: string
  teamName: string
  activeSeconds: number
  idleSeconds: number
  spentAmount: number
}

export interface TimeActivityCustomFilterRow {
  id: string
  field: string
  operator: string
  value: string
}

export type TimeActivityColumnPickerScope = "period" | "member"

export interface TimeActivityColumnPickerLeafItem {
  key?: string
  label?: string
}

export interface TimeActivityColumnPickerSubSection {
  sub: string | null
  items: string[]
}

export interface TimeActivityColumnPickerSection {
  group: string | null
  expandable?: boolean
  items?: (TimeActivityColumnPickerLeafItem | string)[]
  subItems?: TimeActivityColumnPickerSubSection[]
}

/** Row data + per-day member breakdown passed into the report view (from fetch or demo builders). */
export interface TimeActivityReportData {
  days: TimeActivityDayRow[]
  memberRows: Record<string, TimeActivityMemberSubRow[]>
  /** Empty for a demo/builder caller that never supplied entries - every
   *  "Group by" mode besides "Date per day" then has nothing to aggregate
   *  from and falls back to the day view (see use-time-and-activity-report.ts). */
  entries: TimeActivityEntry[]
}

export type TimeActivityReportViewProps = TimeActivityReportData & {
  /** Real Date objects from the date-range picker, for callers that need to refetch. */
  onRangeApply?: (start: Date, end: Date) => void
  /** 'YYYY-MM-DD' bounds of the data currently loaded — what Send/Schedule act on. */
  range?: { from: string; to: string }
  /** Re-fetches `days`/`memberRows` for the current range - called after a
   *  manual entry is added, so it shows up without a manual page refresh. */
  onReload?: () => void
}
