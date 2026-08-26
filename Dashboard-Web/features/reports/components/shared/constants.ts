import type { TimeActivityColumnPickerSection, TimeActivityMetric } from "@/features/reports/models/time-and-activity"

// ==========================================
// 1. Reports Hub Page Constants
// ==========================================

export type CustomizedReportCard = {
  id: string
  title: string
  tag: string
  navigateTo: string
}

export const REPORTS_CUSTOMIZED: CustomizedReportCard[] = []

export const REPORTS_POPULAR = [
  {
    id: "p1",
    title: "Time & activity",
    description: "See team members' time worked, activity levels, and amounts earned per project or to-do.",
    navigateTo: "reports-time" as const,
    badge: "New" as const | null,
  },
  {
    id: "p2",
    title: "Amounts owed",
    description: "Track outstanding balances and what your organization owes members and contractors.",
    navigateTo: "reports-amounts" as const,
    badge: null,
  },
  {
    id: "p3",
    title: "Daily totals",
    description: "Review daily hours and totals across members with a weekly lens.",
    navigateTo: "reports-daily" as const,
    badge: null,
  },
] as const

export type ReportHubCard = { title: string; description: string; navigateTo: string }

export const REPORTS_SECTIONS: { heading: string; cards: ReportHubCard[] }[] = [
  {
    heading: "General",
    cards: [
      {
        title: "Work sessions",
        description: "See the start and stop times for team members.",
        navigateTo: "reports-work-sessions",
      },
      {
        title: "Apps & URLs",
        description: "See team members' apps used and URLs visited while working.",
        navigateTo: "reports-apps-urls",
      },
      {
        title: "Manual time edits",
        description: "See team members' time worked, project, to-do, and reason for each manual time entry.",
        navigateTo: "reports-manual-edits",
      },
      {
        title: "Timesheet approvals",
        description: "See team member's timesheets and their status.",
        navigateTo: "reports-timesheet-approvals",
      },
      {
        title: "Expenses",
        description: "See how much has been spent on expenses by member and project.",
        navigateTo: "reports-expenses",
      },
      {
        title: "Work breaks",
        description: "See how many work breaks team members are taking.",
        navigateTo: "reports-work-breaks",
      },
      {
        title: "Audit log",
        description: "See who changed what, when, and how (People add-on).",
        navigateTo: "reports-audit",
      },
    ],
  },
  {
    heading: "Payment",
    cards: [
      {
        title: "Amounts owed",
        description: "Track outstanding balances and what your organization owes members and contractors.",
        navigateTo: "reports-amounts",
      },
      {
        title: "Payments",
        description: "See how much team members were paid over a given period.",
        navigateTo: "reports-payments",
      },
    ],
  },
  {
    heading: "Budgets and limits",
    cards: [
      {
        title: "Weekly limits",
        description: "See team members' weekly limits usage.",
        navigateTo: "reports-weekly-limits",
      },
      {
        title: "Daily limits",
        description: "See team members' daily limits usage.",
        navigateTo: "reports-daily-limits",
      },
      {
        title: "Project budgets",
        description: "See how much of your projects' budgets have been spent.",
        navigateTo: "reports-project-budgets",
      },
      {
        title: "Client budgets",
        description: "See how much of your clients' budgets have been spent.",
        navigateTo: "reports-client-budgets",
      },
    ],
  },
  {
    heading: "Time off",
    cards: [
      {
        title: "Time off balances",
        description: "See your team's time off balances across the organization's time off policies.",
        navigateTo: "reports-time-off-balances",
      },
      {
        title: "Time off transactions",
        description: "See your team's time off transactions across the organization's time off policies.",
        navigateTo: "reports-time-off-transactions",
      },
    ],
  },
  {
    heading: "Invoice",
    cards: [
      {
        title: "Client invoices",
        description: "See client invoice totals, paid, and due amounts.",
        navigateTo: "reports-client-invoices",
      },
      {
        title: "Team invoices",
        description: "See team member invoice totals, paid, and due amounts.",
        navigateTo: "reports-team-invoices",
      },
      {
        title: "Client invoices aging",
        description: "See outstanding and past due client invoices.",
        navigateTo: "reports-client-invoices-aging",
      },
      {
        title: "Team invoices aging",
        description: "See outstanding and past due team member invoices.",
        navigateTo: "reports-team-invoices-aging",
      },
    ],
  },
  {
    heading: "Schedule",
    cards: [
      {
        title: "Shift attendance",
        description: "See team members' completed, late, abandoned, and missed shifts.",
        navigateTo: "reports-shift-attendance",
      },
    ],
  },
]

// ==========================================
// 2. Hub Shift-Style Reports Configuration
// ==========================================

export const SHIFT_STYLE_HUB_REPORTS: Record<
  string,
  { title: string; exportFileBaseName: string }
> = {
  "reports-budgets": { title: "Budgets and limits report", exportFileBaseName: "budgets-limits" },
  "reports-client-invoices": { title: "Client invoices report", exportFileBaseName: "client-invoices" },
  "reports-team-invoices": { title: "Team invoices report", exportFileBaseName: "team-invoices" },
  "reports-client-invoices-aging": {
    title: "Client invoices aging report",
    exportFileBaseName: "client-invoices-aging",
  },
  "reports-team-invoices-aging": {
    title: "Team invoices aging report",
    exportFileBaseName: "team-invoices-aging",
  },
  "reports-shift-attendance": { title: "Shift attendance report", exportFileBaseName: "shift-attendance" },
}

// ==========================================
// 3. Shared Report Layout & Settings
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
// 4. Report Send & Schedule Dialog Modals
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
// 5. Amounts Owed Report
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
// 6. Audit Log Report
// ==========================================

export const AUDIT_LOG_ORG_LABEL = DEFAULT_ORG_LABEL
export const AUDIT_LOG_TIMEZONE_LABEL = resolveReportTimezoneLabel()

// ==========================================
// 7. Project Budgets Report
// ==========================================

export const PROJECT_BUDGETS_GROUP_BY_OPTIONS: { value: string; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "date", label: "Date" },
  { value: "member", label: "Member" },
  { value: "project", label: "Project" },
  { value: "client", label: "Client" },
]

// ==========================================
// 8. Time & Activity Report
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
// 9. Work Sessions Report
// ==========================================

export const WORK_SESSIONS_ORG_LABEL = DEFAULT_ORG_LABEL
export const WORK_SESSIONS_TIMEZONE_LABEL = resolveReportTimezoneLabel()
// No "Client": /api/reports/work-sessions returns no client for a session, so
// grouping by it collapsed every row into one blank-labelled group.
export const WORK_SESSIONS_GROUP_BY_OPTIONS = REPORT_GROUP_BY_OPTIONS.filter(
  (option) => option.value !== "client",
)
