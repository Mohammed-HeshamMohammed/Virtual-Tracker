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
  memberId: string
  name: string
  avatar: string
  /** Real profile photo, when this member has one - absent (undefined) for
   *  a grouped-mode sub-row, which aggregates from entries that don't carry
   *  it; falls back to the initials avatar either way. */
  avatarUrl?: string | null
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
  manualSeconds: number
  spentAmount: number
  currency: string
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

export interface TimeActivityReportData {
  days: TimeActivityDayRow[]
  memberRows: Record<string, TimeActivityMemberSubRow[]>
  entries: TimeActivityEntry[]
}

export type TimeActivityReportViewProps = TimeActivityReportData & {
  onRangeApply?: (start: Date, end: Date) => void
  range?: { from: string; to: string }
  onReload?: () => void
}
