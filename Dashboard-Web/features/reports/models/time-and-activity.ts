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
  /** The average of activitySum over activityCount (see utils/time-and-activity/activity). */
  activityPct: number
  activitySum: number
  /** Screenshots the activity covers; 0 means no activity is known. */
  activityCount: number
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
  /** Real profile photo, when this member has one - absent (undefined) when
   *  the sub-row is a project rather than a person; falls back to the
   *  initials avatar either way. */
  avatarUrl?: string | null
  regularHours: string
  totalHours: string
  breakTime: string
  activityPct: number
  activitySum: number
  activityCount: number
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
  /** The screenshots' activity levels in this row, summed, and how many there were. */
  activitySum: number
  activityCount: number
  spentAmount: number
  currency: string
  /** The member's hourly pay rate on this day, in the currency it is paid
   *  in. `spentAmount` is that rate times the hours, converted. */
  payRate: number
  payRateCurrency: string
  /** What the project's client is charged per hour, and for this row's hours
   *  (converted like `spentAmount`). Absent when the project has no client
   *  rate, or the viewer may not see what clients are charged. */
  billRate?: number
  billRateCurrency?: string
  billAmount?: number
  billCurrency?: string
  /** The client's own invoice terms, when it has set custom ones: tax as a
   *  percentage, days to pay, and a note for its invoices. */
  billTaxRate?: number
  billNetTermsDays?: number
  billNotes?: string
}

/** One person in the report, sent once rather than on every row they appear in. */
export interface TimeActivityMember {
  id: string
  name: string
  avatarUrl?: string | null
}

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
  /** The viewer may not see pay or cost (a Client login): the server has
   *  already removed every amount, and the UI drops the Total spent column,
   *  card, chart series and currency choice instead of rendering zeros. */
  moneyHidden?: boolean
  days: TimeActivityDayRow[]
  memberRows: Record<string, TimeActivityMemberSubRow[]>
  entries: TimeActivityEntry[]
  members?: TimeActivityMember[]
  /** The viewer may see what clients are charged, so a client statement can be made. */
  billingIncluded?: boolean
  currency?: {
    displayCurrency: string
    orgCurrency: string
    requestedUnavailable: boolean
    rateAsOf: string | null
  }
}

export type TimeActivityReportViewProps = TimeActivityReportData & {
  onRangeApply?: (start: Date, end: Date) => void
  range?: { from: string; to: string }
  onReload?: () => void
  displayCurrency?: string
  resolvedDisplayCurrency?: string
  onDisplayCurrencyChange?: (currency: string) => void
  /** A refetch (new date range, manual reload) is in flight. The view stays
   *  mounted and shows this in place - it must NOT unmount for a refresh, or
   *  every filter/sort/grouping choice resets with it. */
  loading?: boolean
  /** A refetch failed. Previous data and every selection stay on screen;
   *  this only adds a dismissible-by-retry banner over it. */
  error?: string | null
}
