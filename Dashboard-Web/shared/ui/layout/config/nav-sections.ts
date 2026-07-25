import {
  LayoutDashboard, Clock, Zap, Folder,
  BarChart3, Users, DollarSign, Settings,
  type LucideIcon,
} from "lucide-react"

export interface NavSubItem {
  label: string
  id: string
  sortLast?: boolean
  hideFromDropdown?: boolean
}

export interface NavSubSection {
  label: string
  items: NavSubItem[]
  sortLast?: boolean
  hideFromDropdown?: boolean
}

export interface NavSection {
  id: string
  label: string
  icon: LucideIcon
  pages?: NavSubItem[]
  subsections?: NavSubSection[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    pages: [
      { label: "Command Center", id: "command-center" },
      { label: "General",        id: "general"        },
    ],
  },
  {
    id: "timesheets",
    label: "Timesheets",
    icon: Clock,
    pages: [
      { label: "View & edit", id: "timesheets-view"      },
      { label: "Approvals",   id: "timesheets-approvals" },
    ],
  },
  {
    id: "activity",
    label: "Activity",
    icon: Zap,
    pages: [
      { label: "Screenshots", id: "activity-screenshots" },
      { label: "Apps",        id: "activity-apps"        },
      { label: "URLs",        id: "activity-urls"        },
    ],
  },
  {
    id: "project-management",
    label: "Project Management",
    icon: Folder,
    pages: [
      { label: "Overview",          id: "pm-overview"      },
      { label: "Projects",          id: "pm-projects"      },
      { label: "Tasks",             id: "pm-tasks"         },
      { label: "Clients",           id: "pm-clients"       },
      { label: "Time off requests", id: "calendar-timeoff" },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    pages: [
      { label: "All reports", id: "reports-all",    hideFromDropdown: true },
      { label: "Custom",      id: "reports-custom", sortLast: true        },
    ],
    subsections: [
      {
        label: "General",
        items: [
          { label: "Time & activity",       id: "reports-time"                 },
          { label: "Work sessions",         id: "reports-work-sessions"        },
          { label: "Apps & URLs",           id: "reports-apps-urls"            },
          { label: "Manual time edits",     id: "reports-manual-edits"         },
          { label: "Timesheet approvals",   id: "reports-timesheet-approvals"  },
          { label: "Expenses",              id: "reports-expenses"             },
          { label: "Work breaks",           id: "reports-work-breaks"          },
          { label: "Audit log",             id: "reports-audit"                },
        ],
      },
      {
        label: "Payment",
        items: [
          { label: "Amounts owed", id: "reports-amounts"  },
          { label: "Payments",     id: "reports-payments" },
        ],
      },
      {
        label: "Budgets and limits",
        items: [
          { label: "Weekly limits",    id: "reports-weekly-limits"   },
          { label: "Daily limits",     id: "reports-daily-limits"    },
          { label: "Project budgets",  id: "reports-project-budgets" },
          { label: "Client budgets",   id: "reports-client-budgets"  },
        ],
      },
      {
        label: "Time off",
        items: [
          { label: "Time off balances",      id: "reports-time-off-balances"      },
          { label: "Time off transactions",  id: "reports-time-off-transactions"  },
        ],
      },
      {
        label: "Invoice",
        items: [
          { label: "Client invoices",        id: "reports-client-invoices"       },
          { label: "Team invoices",          id: "reports-team-invoices"         },
          { label: "Client invoices aging",  id: "reports-client-invoices-aging" },
          { label: "Team invoices aging",    id: "reports-team-invoices-aging"   },
        ],
      },
      {
        label: "Schedule",
        items: [
          { label: "Shift attendance", id: "reports-shift-attendance" },
        ],
      },
    ],
  },
  {
    id: "people",
    label: "People",
    icon: Users,
    pages: [
      { label: "Members", id: "people-members" },
      { label: "Members tree", id: "people-members-tree", hideFromDropdown: true },
      { label: "Banned members", id: "people-member-bans", hideFromDropdown: true },
      { label: "Teams",   id: "people-teams"   },
    ],
  },
  {
    id: "financials",
    label: "Financials",
    icon: DollarSign,
    pages: [
      { label: "Overview",        id: "financials-overview" },
      { label: "Manage payroll",  id: "financials-payroll"  },
      { label: "Create payments", id: "financials-create"   },
      { label: "Payment records", id: "financials-records"  },
      { label: "Invoices",        id: "financials-invoices" },
      { label: "Expenses",        id: "financials-expenses" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    pages: [
      { label: "All settings",          id: "settings-all", hideFromDropdown: true },
      { label: "Organization",          id: "settings-organization"        },
      { label: "Members",               id: "settings-members"             },
      { label: "Schedules",             id: "settings-schedules"           },
      { label: "Activity & tracking",   id: "settings-activity"            },
      { label: "Integrations",          id: "settings-integrations"        },
      { label: "Policies",              id: "settings-policies"            },
      { label: "Enterprise Security",   id: "settings-enterprise-security" },
      { label: "Billing",               id: "settings-billing"             },
      { label: "Subscription Plans",    id: "settings-billing-plans"       },
    ],
  },
]

export const PAGE_PARENTS: Record<string, string> = {
  "settings-billing-plans": "settings-billing",
  "people-members-tree": "people-members",
  "people-member-bans": "people-members",
}

export function sortedItems<T extends { sortLast?: boolean; hideFromDropdown?: boolean }>(
  items: T[] | undefined,
  filterHidden = false
): T[] {
  if (!items) return []
  const list = filterHidden ? items.filter(i => !i.hideFromDropdown) : items
  return list.toSorted((a, b) => {
    if (a.sortLast && !b.sortLast) return 1
    if (!a.sortLast && b.sortLast) return -1
    return 0
  })
}

export function getSectionForPage(pageId: string): NavSection | undefined {
  return NAV_SECTIONS.find(s =>
    s.id === pageId ||
    s.pages?.some(p => p.id === pageId) ||
    s.subsections?.some(sub => sub.items.some(i => i.id === pageId))
  )
}

const EXTRA_PAGE_LABELS: Record<string, string> = {
  profile: "Edit account",
  "download-agent": "Download Tracker Agent",
}

export function getPageLabel(pageId: string): string {
  const extra = EXTRA_PAGE_LABELS[pageId]
  if (extra) return extra
  for (const section of NAV_SECTIONS) {
    if (section.id === pageId) return section.label
    const page = section.pages?.find(p => p.id === pageId)
    if (page) return page.label
    for (const sub of section.subsections ?? []) {
      const item = sub.items.find(i => i.id === pageId)
      if (item) return item.label
    }
  }
  return pageId
}

export function getSubsectionForPage(
  pageId: string
): { subsection: NavSubSection; section: NavSection } | undefined {
  for (const section of NAV_SECTIONS) {
    for (const subsection of section.subsections ?? []) {
      if (subsection.items.some(i => i.id === pageId)) return { subsection, section }
    }
  }
}
