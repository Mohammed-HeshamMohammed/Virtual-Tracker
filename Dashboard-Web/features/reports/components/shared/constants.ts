import type { TimeActivityColumnPickerSection, TimeActivityMetric } from "@/features/reports/models/time-and-activity"

// ==========================================
// 1. Hub Shift-Style Reports Configuration
// ==========================================

/**
 * Reports that render through the generic hub shell rather than a hand-built
 * page. Every entry that used to live here now has a real backend and its own
 * component, so the map is empty - kept because resolve-chunk.ts and
 * coming-soon-pages.ts both iterate it, and a future generic report belongs
 * here rather than in a new mechanism.
 */
export const SHIFT_STYLE_HUB_REPORTS: Record<
  string,
  { title: string; exportFileBaseName: string }
> = {}

// ==========================================
// 2. Shared Report Layout & Settings
// ==========================================

const DEFAULT_ORG_LABEL = "TVC"

/**
 * The timezone a report's day boundaries are read in, shown in its header.
 * This used to be the literal string "America - Denver" for every viewer,
 * which is actively misleading on a report whose rows are bucketed by day -
 * a viewer in another zone was told their days were cut in Denver. Resolved
 * from the browser instead, so the label matches the dates on screen.
 */
export function resolveReportTimezoneLabel(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone ? zone.replace(/_/g, " ") : "UTC"
  } catch {
    return "UTC"
  }
}

const REPORT_GROUP_BY_OPTIONS: { value: string; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "member", label: "Member" },
  { value: "project", label: "Project" },
  { value: "client", label: "Client" },
]

export const STANDARD_REPORT_ORG_LABEL = DEFAULT_ORG_LABEL
export const STANDARD_REPORT_TIMEZONE_LABEL = resolveReportTimezoneLabel()
export const STANDARD_REPORT_GROUP_BY_OPTIONS = REPORT_GROUP_BY_OPTIONS

// ==========================================
// 3. Report Send & Schedule Dialog Modals
// ==========================================

export const SCHEDULE_REPORT_DATE_RANGE_OPTIONS: string[] = [
  "Today",
  "Yesterday",
  "The last 7 days",
  "This week",
  "Last week",
  "The last 2 weeks",
  "This month",
  "Last month",
  "This quarter",
  "Last quarter",
  "This year",
  "Last year",
  "Custom range",
]

export const DELIVERY_FREQUENCY_OPTIONS: string[] = ["Daily", "Weekly", "Bi-weekly", "Monthly"]
export const REPORT_FILE_TYPE_OPTIONS: string[] = ["PDF", "CSV"]
export const AMOUNTS_OWED_SEND_SUBJECT_DEFAULT = "TVC Amounts Owed Report report"
export const AMOUNTS_OWED_SCHEDULE_SUBJECT_DEFAULT = "TVC Amounts Owed Report for ..."
export const REPORT_EMAIL_DEFAULT_MESSAGE =
  "We've prepared your latest report. Contact support if you have any questions or need assistance."

// ==========================================
// 4. Amounts Owed Report
// ==========================================

/** Columns the Amounts Owed / Daily Totals table can hide. "Member" is always
 *  shown - a row with no member is meaningless. These are the columns the
 *  report genuinely renders; the previous list offered member profile fields
 *  (email, job title, tax info, ...) that neither the table nor the endpoint
 *  has. */
export type AmountsOwedColumnKey = "rate" | "hours" | "amount"

export const AMOUNTS_OWED_TOGGLEABLE_COLUMNS: { key: AmountsOwedColumnKey; label: string }[] = [
  { key: "rate", label: "Current rate" },
  { key: "hours", label: "Total hours" },
  { key: "amount", label: "Amount" },
]

export const AMOUNTS_OWED_DEFAULT_VISIBLE_COLUMNS: AmountsOwedColumnKey[] = ["rate", "hours", "amount"]

export interface AmountsOwedMemberLine {
  name: string
  initials: string
  rateLabel: string
  hours: string
  amount: string
}

export interface AmountsOwedDayGroup {
  date: string
  dateLabel: string
  members: AmountsOwedMemberLine[]
}

// ==========================================
// 5. Audit Log Report
// ==========================================

export const AUDIT_LOG_ORG_LABEL = DEFAULT_ORG_LABEL
export const AUDIT_LOG_TIMEZONE_LABEL = resolveReportTimezoneLabel()

// ==========================================
// 6. Project Budgets Report
// ==========================================

export const PROJECT_BUDGETS_GROUP_BY_OPTIONS: { value: string; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "date", label: "Date" },
  { value: "member", label: "Member" },
  { value: "project", label: "Project" },
  { value: "client", label: "Client" },
]

// ==========================================
// 7. Time & Activity Report
// ==========================================

const TIME_PERIODS = [
  { k: "today", l: "Today" },
  { k: "week", l: "This week" },
  { k: "month", l: "This month" },
  { k: "quarter", l: "This quarter" },
  { k: "year", l: "This year" },
] as const

export const ALL_MEMBERS_VALUE = "all"

export const ALL_PROJECTS_VALUE = "all"

export const GROUP_BY_OPTIONS: { value: string; label: string }[] = [
  { value: "date_per_day", label: "Date per day" },
  { value: "date_per_week", label: "Date per week" },
  { value: "member", label: "Member" },
  { value: "project", label: "Project" },
  { value: "client", label: "Client" },
  { value: "team", label: "Team" },
]

export const METRIC_OPTIONS: { value: string; label: string }[] = [
  { value: "total_hours", label: "Total hours" },
  { value: "activity", label: "Activity %" },
  { value: "total_spent", label: "Total spent" },
]

export const CALENDAR_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

export const CALENDAR_DAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

export const DATE_RANGE_PRESETS = [
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last week",
  "Last 2 weeks",
  "This month",
  "Last month",
] as const

export const CUSTOM_FILTER_FIELDS = [
  "Activity %",
  "Total hours",
  "Bill rate",
  "Project",
  "Member",
  "Client",
  "Tags",
  "Notes",
]

export const CUSTOM_FILTER_OPERATORS = [
  "is",
  "is not",
  "is greater than",
  "is less than",
  "contains",
  "does not contain",
]

export const CHART_METRIC_ORDER: TimeActivityMetric[] = ["total_hours", "activity", "total_spent"]

export const CHART_SERIES_STYLES: Record<TimeActivityMetric, { stroke: string; gradientId: string }> = {
  total_hours: { stroke: "rgb(37 99 235)", gradientId: "ta-area-blue" },
  activity: { stroke: "rgb(22 163 74)", gradientId: "ta-area-green" },
  total_spent: { stroke: "rgb(217 119 6)", gradientId: "ta-area-amber" },
}

export const CHART_METRIC_PILL_ON: Record<TimeActivityMetric, string> = {
  total_hours: "border-blue-500 bg-blue-50 text-blue-900",
  activity: "border-emerald-500 bg-emerald-50 text-emerald-900",
  total_spent: "border-amber-500 bg-amber-50 text-amber-900",
}

export const COLUMN_PICKER_SECTIONS: TimeActivityColumnPickerSection[] = [
  { group: null, items: [{ key: "member", label: "Member" }] },
  {
    group: "Info",
    expandable: true,
    subItems: [
      { sub: "Identity", items: ["Employee ID", "Birthday", "IP address"] },
      { sub: "Work contact", items: ["Work address", "Work email", "Work phone"] },
      { sub: "Personal contact", items: ["Personal address", "Personal email", "Personal phone"] },
    ],
  },
  {
    group: "Employment",
    expandable: true,
    subItems: [
      { sub: null, items: ["Client", "Project", "To-do", "Team"] },
      { sub: "Job details", items: ["Job title", "Job type", "Department"] },
      {
        sub: "Hiring details",
        items: ["Employment type", "In-office/Remote", "Employed through", "Name of Vendor/EOR/Subsidiary"],
      },
      { sub: "Accounting", items: ["Tax ID number", "Tax type", "Account code", "Currency"] },
      {
        sub: "Timeline",
        items: ["Start date", "End date", "Termination reason", "Employment comment"],
      },
    ],
  },
  {
    group: null,
    items: [
      { key: "regular_hours", label: "Regular hours" },
      { key: "break_time", label: "Break time" },
      { key: "activity_pct", label: "Activity %" },
      { key: "manual_hours", label: "Manual hours" },
      { key: "total_hours", label: "Total hours" },
      { key: "idle_pct", label: "Idle (%)" },
      { key: "idle_hr", label: "Idle (hr)" },
    ],
  },
  {
    group: "Spent",
    expandable: true,
    subItems: [
      { sub: null, items: ["Select all"] },
      { sub: "Spent details", items: ["Total spent", "Regular spent", "Pay rate"] },
      { sub: null, items: ["Billed amount", "Billable time", "Non-billable time", "Notes"] },
    ],
  },
]

export const COLUMN_LABEL_KEY_MAP: Record<string, string> = {
  Member: "member",
  Client: "client",
  Project: "project",
  "To-do": "todo",
  Team: "team",
  "Regular hours": "regular_hours",
  "Break time": "break_time",
  "Activity %": "activity_pct",
  "Manual hours": "manual_hours",
  "Total hours": "total_hours",
  "Idle (%)": "idle_pct",
  "Idle (hr)": "idle_hr",
  "Total spent": "total_spent",
  "Regular spent": "regular_spent",
}

export const TABLE_METRIC_COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: "client", label: "Client", sortable: true },
  { key: "team", label: "Team", sortable: true },
  { key: "todo", label: "To-do", sortable: true },
  { key: "project", label: "Project", sortable: true },
  { key: "regular_hours", label: "Regular hours", sortable: true },
  { key: "break_time", label: "Break time", sortable: true },
  { key: "manual_hours", label: "Manual hours", sortable: true },
  { key: "total_hours", label: "Total hours", sortable: true },
  { key: "activity_pct", label: "Activity %", sortable: true },
  { key: "idle_pct", label: "Idle (%)", sortable: true },
  { key: "idle_hr", label: "Idle (hr)", sortable: true },
  { key: "total_spent", label: "Total spent", sortable: true },
]

// ==========================================
// 8. Work Sessions Report
// ==========================================

export const WORK_SESSIONS_ORG_LABEL = DEFAULT_ORG_LABEL
export const WORK_SESSIONS_TIMEZONE_LABEL = resolveReportTimezoneLabel()
// No "Client": /api/reports/work-sessions returns no client for a session, so
// grouping by it collapsed every row into one blank-labelled group.
export const WORK_SESSIONS_GROUP_BY_OPTIONS = REPORT_GROUP_BY_OPTIONS.filter(
  (option) => option.value !== "client",
)
