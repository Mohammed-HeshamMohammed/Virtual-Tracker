
export type ReportCatalogCard = {
  pageId: string
  title: string
  description: string
  section: string | null
  badge?: string
}

const SECTION_ORDER = ["General", "Payment", "Budgets and limits", "Time off", "Invoice", "Schedule"] as const

const POPULAR_PAGE_IDS = ["reports-time", "reports-amounts", "reports-daily"] as const

export const REPORT_CATALOG: ReportCatalogCard[] = [
  {
    pageId: "reports-time",
    title: "Time & activity",
    description: "See team members' time worked, activity levels, and amounts earned per project or to-do.",
    section: null,
    badge: "New",
  },
  {
    pageId: "reports-daily",
    title: "Daily totals",
    description: "Review daily hours and totals across members with a weekly lens.",
    section: null,
  },
  {
    pageId: "reports-work-sessions",
    title: "Work sessions",
    description: "See the start and stop times for team members.",
    section: "General",
  },
  {
    pageId: "reports-apps-urls",
    title: "Apps & URLs",
    description: "See team members' apps used and URLs visited while working.",
    section: "General",
  },
  {
    pageId: "reports-manual-edits",
    title: "Manual time edits",
    description: "See team members' time worked, project, to-do, and reason for each manual time entry.",
    section: "General",
  },
  {
    pageId: "reports-timesheet-approvals",
    title: "Timesheet approvals",
    description: "See team member's timesheets and their status.",
    section: "General",
  },
  {
    pageId: "reports-expenses",
    title: "Expenses",
    description: "See how much has been spent on expenses by member and project.",
    section: "General",
  },
  {
    pageId: "reports-work-breaks",
    title: "Work breaks",
    description: "See how many work breaks team members are taking.",
    section: "General",
  },
  {
    pageId: "reports-audit",
    title: "Audit log",
    description: "See who changed what, when, and how (People add-on).",
    section: "General",
  },
  {
    pageId: "reports-amounts",
    title: "Amounts owed",
    description: "Track outstanding balances and what your organization owes members and contractors.",
    section: "Payment",
  },
  {
    pageId: "reports-payments",
    title: "Payments",
    description: "See how much team members were paid over a given period.",
    section: "Payment",
  },
  {
    pageId: "reports-weekly-limits",
    title: "Weekly limits",
    description: "See team members' weekly limits usage.",
    section: "Budgets and limits",
  },
  {
    pageId: "reports-daily-limits",
    title: "Daily limits",
    description: "See team members' daily limits usage.",
    section: "Budgets and limits",
  },
  {
    pageId: "reports-project-budgets",
    title: "Project budgets",
    description: "See how much of your projects' budgets have been spent.",
    section: "Budgets and limits",
  },
  {
    pageId: "reports-client-budgets",
    title: "Client budgets",
    description: "See how much of your clients' budgets have been spent.",
    section: "Budgets and limits",
  },
  {
    pageId: "reports-time-off-balances",
    title: "Time off balances",
    description: "See your team's time off balances across the organization's time off policies.",
    section: "Time off",
  },
  {
    pageId: "reports-time-off-transactions",
    title: "Time off transactions",
    description: "See your team's time off transactions across the organization's time off policies.",
    section: "Time off",
  },
  {
    pageId: "reports-client-invoices",
    title: "Client invoices",
    description: "See client invoice totals, paid, and due amounts.",
    section: "Invoice",
  },
  {
    pageId: "reports-team-invoices",
    title: "Team invoices",
    description: "See team member invoice totals, paid, and due amounts.",
    section: "Invoice",
  },
  {
    pageId: "reports-client-invoices-aging",
    title: "Client invoices aging",
    description: "See outstanding and past due client invoices.",
    section: "Invoice",
  },
  {
    pageId: "reports-team-invoices-aging",
    title: "Team invoices aging",
    description: "See outstanding and past due team member invoices.",
    section: "Invoice",
  },
  {
    pageId: "reports-shift-attendance",
    title: "Shift attendance",
    // There are no shift start/end times in this schema, so lateness and
    // abandonment are not knowable. This says what the report can actually
    // answer instead of what a scheduling product would.
    description: "See which scheduled days each team member worked, missed, or had excused.",
    section: "Schedule",
  },
]

const BY_PAGE_ID = new Map(REPORT_CATALOG.map((card) => [card.pageId, card]))

export const POPULAR_REPORTS: ReportCatalogCard[] = POPULAR_PAGE_IDS.map((id) => BY_PAGE_ID.get(id)).filter(
  (card): card is ReportCatalogCard => Boolean(card),
)

export const REPORT_SECTIONS: { heading: string; cards: ReportCatalogCard[] }[] = SECTION_ORDER.map((heading) => ({
  heading,
  cards: REPORT_CATALOG.filter((card) => card.section === heading),
})).filter((section) => section.cards.length > 0)

export function reportCardFor(pageId: string): ReportCatalogCard | undefined {
  return BY_PAGE_ID.get(pageId)
}
