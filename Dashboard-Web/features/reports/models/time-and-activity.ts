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
}

export type TimeActivityReportViewProps = TimeActivityReportData & {
  /** Real Date objects from the date-range picker, for callers that need to refetch. */
  onRangeApply?: (start: Date, end: Date) => void
  /** 'YYYY-MM-DD' bounds of the data currently loaded — what Send/Schedule act on. */
  range?: { from: string; to: string }
}
