import type { AppSearchEntry } from "@/shared/search/types"

type UiEntryInput = Omit<AppSearchEntry, "id"> & { id?: string }

function ui(input: UiEntryInput): AppSearchEntry {
  const id = input.id ?? `${input.pageId}::${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  return { ...input, id }
}

export const APP_UI_SEARCH_ENTRIES: AppSearchEntry[] = [
  ui({ pageId: "command-center", title: "Command Center", section: "Dashboard", kind: "page", keywords: ["home", "overview", "widgets"] }),
  ui({ pageId: "command-center", title: "Manage Widgets", section: "Dashboard", pageLabel: "Command Center", kind: "action", keywords: ["widget", "dashboard", "customize", "layout"] }),
  ui({ pageId: "command-center", title: "Start timer", section: "Dashboard", pageLabel: "Command Center", kind: "action", keywords: ["track", "time", "clock", "timer", "button"] }),
  ui({ pageId: "general", title: "General dashboard", section: "Dashboard", kind: "page", keywords: ["overview", "summary"] }),

  ui({ pageId: "people-members", title: "Members", section: "People", kind: "page", keywords: ["people", "users", "team"] }),
  ui({ pageId: "people-members", title: "Add members", section: "People", pageLabel: "Members", kind: "action", keywords: ["invite", "create", "hire", "new member", "button"] }),
  ui({ pageId: "people-members", title: "Invites tab", section: "People", pageLabel: "Members", kind: "tab", keywords: ["pending", "invitation", "awaiting signup"] }),
  ui({ pageId: "people-members", title: "Onboarding", section: "People", pageLabel: "Members", kind: "action", keywords: ["setup", "progress", "download app"] }),
  ui({ pageId: "people-members", title: "Columns", section: "People", pageLabel: "Members", kind: "action", keywords: ["table", "picker", "show hide", "fields"] }),
  ui({ pageId: "people-members", title: "Filters", section: "People", pageLabel: "Members", kind: "action", keywords: ["filter", "status", "role"] }),
  ui({ pageId: "people-members", title: "Export list", section: "People", pageLabel: "Members", kind: "action", keywords: ["download", "csv", "export"] }),
  ui({ pageId: "people-members", title: "Import list to bulk update", section: "People", pageLabel: "Members", kind: "action", keywords: ["upload", "csv", "import", "bulk"] }),
  ui({ pageId: "people-members", title: "Manage weekly limit", section: "People", pageLabel: "Members", kind: "action", keywords: ["limits", "hours", "batch"] }),
  ui({ pageId: "people-members", title: "Members tree", section: "People", pageLabel: "Members", kind: "action", keywords: ["org chart", "hierarchy", "network"] }),
  ui({ pageId: "people-members", title: "Invite via email", section: "People", pageLabel: "Members", kind: "section", keywords: ["add members modal", "email invite"] }),
  ui({ pageId: "people-members", title: "Create member account", section: "People", pageLabel: "Members", kind: "section", keywords: ["preprovision", "account", "password"] }),

  ui({ pageId: "people-teams", title: "Teams", section: "People", kind: "page", keywords: ["groups", "leads"] }),
  ui({ pageId: "people-teams", title: "Create team", section: "People", pageLabel: "Teams", kind: "action", keywords: ["add team", "new team", "button"] }),
  ui({ pageId: "people-teams", title: "Schedule weekly report", section: "People", pageLabel: "Teams", kind: "action", keywords: ["email report", "team report"] }),

  ui({ pageId: "pm-overview", title: "Project overview", section: "Project Management", kind: "page", keywords: ["dashboard", "tasks", "budget"] }),
  ui({ pageId: "pm-projects", title: "Projects", section: "Project Management", kind: "page", keywords: ["project list"] }),
  ui({ pageId: "pm-projects", title: "Add project", section: "Project Management", pageLabel: "Projects", kind: "action", keywords: ["create project", "new project", "button"] }),
  ui({ pageId: "pm-projects", title: "Archive selected", section: "Project Management", pageLabel: "Projects", kind: "action", keywords: ["batch", "bulk"] }),
  ui({ pageId: "pm-projects", title: "Set member limit", section: "Project Management", pageLabel: "Projects", kind: "action", keywords: ["capacity", "limit"] }),
  ui({ pageId: "pm-tasks", title: "Tasks", section: "Project Management", kind: "page", keywords: ["todos", "to-do", "kanban"] }),
  ui({ pageId: "pm-tasks", title: "Add task", section: "Project Management", pageLabel: "Tasks", kind: "action", keywords: ["create task", "new task", "button"] }),
  ui({ pageId: "pm-tasks", title: "Create new task", section: "Project Management", pageLabel: "Tasks", kind: "section", keywords: ["modal", "todo"] }),
  ui({ pageId: "pm-clients", title: "Clients", section: "Project Management", kind: "page", keywords: ["customer", "accounts"] }),
  ui({ pageId: "pm-clients", title: "Add client", section: "Project Management", pageLabel: "Clients", kind: "action", keywords: ["create client", "new client", "button"] }),
  ui({ pageId: "calendar-timeoff", title: "Time off requests", section: "Project Management", kind: "page", keywords: ["pto", "leave", "vacation"] }),

  ui({ pageId: "timesheets-view", title: "View & edit timesheets", section: "Timesheets", kind: "page", keywords: ["hours", "entries"] }),
  ui({ pageId: "timesheets-submissions", title: "Timesheets", section: "Timesheets", kind: "page", keywords: ["submit", "approve", "review"] }),
  ui({ pageId: "timesheets-manual-requests", title: "Add time entry", section: "Timesheets", pageLabel: "Manual Time Requests", kind: "action", keywords: ["manual time", "log hours"] }),
  ui({ pageId: "timesheets-manual-requests", title: "Manual time requests", section: "Timesheets", kind: "page", keywords: ["manual time", "log hours", "approve", "review"] }),

  ui({ pageId: "activity-screenshots", title: "Screenshots", section: "Activity", kind: "page", keywords: ["screen capture", "monitoring"] }),
  ui({ pageId: "activity-apps", title: "Apps", section: "Activity", kind: "page", keywords: ["applications", "software"] }),
  ui({ pageId: "activity-urls", title: "URLs", section: "Activity", kind: "page", keywords: ["websites", "browsing", "domains"] }),

  ui({ pageId: "reports-all", title: "All reports", section: "Reports", kind: "page", keywords: ["report hub", "catalog"] }),
  ui({ pageId: "reports-all", title: "Customized reports", section: "Reports", pageLabel: "All reports", kind: "section", keywords: ["saved", "favorites"] }),
  ui({ pageId: "reports-time", title: "Export report", section: "Reports", pageLabel: "Time & activity", kind: "action", keywords: ["download", "csv", "pdf", "export button"] }),
  ui({ pageId: "reports-time", title: "Schedule report", section: "Reports", pageLabel: "Time & activity", kind: "action", keywords: ["email", "recurring", "automate"] }),
  ui({ pageId: "reports-audit", title: "Audit log", section: "Reports", kind: "page", keywords: ["changes", "history", "events"] }),
  ui({ pageId: "reports-audit", title: "Export audit log", section: "Reports", pageLabel: "Audit log", kind: "action", keywords: ["download", "csv"] }),

  ui({ pageId: "financials-overview", title: "Financials overview", section: "Financials", kind: "page", keywords: ["money", "summary"] }),
  ui({ pageId: "financials-payroll", title: "Manage payroll", section: "Financials", kind: "page", keywords: ["pay", "salary", "wise"] }),
  ui({ pageId: "financials-payroll", title: "Create payroll adjustment", section: "Financials", pageLabel: "Manage payroll", kind: "action", keywords: ["deduction", "bonus", "addition"] }),
  ui({ pageId: "financials-create", title: "Create payment", section: "Financials", kind: "action", keywords: ["pay member", "one time", "button"] }),
  ui({ pageId: "financials-records", title: "Payment records", section: "Financials", kind: "page", keywords: ["history", "transactions"] }),
  ui({ pageId: "financials-invoices", title: "Invoices", section: "Financials", kind: "page", keywords: ["billing", "invoice list"] }),
  ui({ pageId: "financials-invoices", title: "Create invoice", section: "Financials", pageLabel: "Invoices", kind: "action", keywords: ["new invoice", "bill client"] }),
  ui({ pageId: "financials-expenses", title: "Expenses", section: "Financials", kind: "page", keywords: ["spending", "receipts"] }),
  ui({ pageId: "financials-expenses", title: "Add expense", section: "Financials", pageLabel: "Expenses", kind: "action", keywords: ["new expense", "receipt"] }),

  ui({ pageId: "settings-all", title: "All settings", section: "Settings", kind: "page", keywords: ["configuration", "preferences"] }),
  ui({ pageId: "settings-organization", title: "Organization settings", section: "Settings", kind: "page", keywords: ["company", "branding"] }),
  ui({ pageId: "settings-organization", title: "Add a global to-do", section: "Settings", pageLabel: "Organization", kind: "action", keywords: ["todo", "task template"] }),
  ui({ pageId: "settings-members", title: "Members settings", section: "Settings", kind: "page", keywords: ["roles", "permissions", "invite"] }),
  ui({ pageId: "settings-members", title: "Add custom field", section: "Settings", pageLabel: "Members", kind: "action", keywords: ["profile field", "custom data"] }),
  ui({ pageId: "settings-schedules", title: "Schedules", section: "Settings", kind: "page", keywords: ["shifts", "holidays"] }),
  ui({ pageId: "settings-activity", title: "Activity & tracking settings", section: "Settings", kind: "page", keywords: ["screenshots", "monitoring", "timesheets"] }),
  ui({ pageId: "settings-integrations", title: "Integrations", section: "Settings", kind: "page", keywords: ["slack", "jira", "github"] }),
  ui({ pageId: "settings-policies", title: "Policies", section: "Settings", kind: "page", keywords: ["time off", "overtime", "breaks"] }),
  ui({ pageId: "settings-policies", title: "Add time off policy", section: "Settings", pageLabel: "Policies", kind: "action", keywords: ["pto", "leave policy"] }),
  ui({ pageId: "settings-policies", title: "Add work break policy", section: "Settings", pageLabel: "Policies", kind: "action", keywords: ["break", "rest"] }),
  ui({ pageId: "settings-policies", title: "Add holiday", section: "Settings", pageLabel: "Policies", kind: "action", keywords: ["public holiday", "calendar"] }),
  ui({ pageId: "settings-billing", title: "Billing", section: "Settings", kind: "page", keywords: ["subscription", "payment method"] }),
  ui({ pageId: "settings-billing-plans", title: "Subscription plans", section: "Settings", pageLabel: "Billing", kind: "page", keywords: ["pricing", "upgrade"] }),
  ui({ pageId: "settings-enterprise-security", title: "Enterprise security", section: "Settings", kind: "page", keywords: ["sso", "compliance"] }),

  ui({ pageId: "profile", title: "Edit account", section: "Account", kind: "page", keywords: ["profile", "password", "email"] }),
]
