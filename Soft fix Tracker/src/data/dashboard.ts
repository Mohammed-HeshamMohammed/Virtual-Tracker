export type DashboardRole = "Owner" | "Admin" | "Manager" | "Member" | "Client";
export type DashboardSection =
  | "dashboard"
  | "timesheets"
  | "activity"
  | "project-management"
  | "calendar"
  | "reports"
  | "people"
  | "financials"
  | "settings";
export const navSections: {
  id: DashboardSection;
  label: string;
  group: string;
}[] = [
  { id: "dashboard", label: "Overview", group: "Workspace" },
  { id: "timesheets", label: "Timesheets", group: "Workspace" },
  { id: "activity", label: "Activity", group: "Workspace" },
  { id: "project-management", label: "Projects", group: "Workspace" },
  { id: "calendar", label: "Calendar", group: "Workspace" },
  { id: "reports", label: "Reports", group: "Workspace" },
  { id: "people", label: "People", group: "Manage" },
  { id: "financials", label: "Financials", group: "Manage" },
  { id: "settings", label: "Settings", group: "Manage" },
];

/** A page inside a section. These are the real Dashboard's pages (Dashboard-Web's
 *  `nav-sections.ts`), shown as the tab strip under the top bar. */
export type DashboardPage = { id: string; label: string };

export const sectionPages: Record<Exclude<DashboardSection, "settings">, DashboardPage[]> = {
  dashboard: [
    { id: "command-center", label: "Command Center" },
    { id: "notifications", label: "Notifications" },
  ],
  timesheets: [
    { id: "timesheets-time-activity", label: "Time & Activity" },
    { id: "timesheets-view", label: "Task Approvals" },
    { id: "timesheets-submissions", label: "Timesheets" },
    { id: "timesheets-manual-requests", label: "Manual Time Requests" },
  ],
  activity: [
    { id: "activity-overview", label: "Overview" },
    { id: "activity-screenshots", label: "Screenshots" },
    { id: "activity-apps", label: "Apps" },
    { id: "activity-urls", label: "URLs" },
    { id: "activity-tools", label: "Tools" },
    { id: "activity-removal-requests", label: "Removal Requests" },
  ],
  "project-management": [
    { id: "pm-overview", label: "Overview" },
    { id: "pm-projects", label: "Projects" },
    { id: "pm-tasks", label: "Tasks" },
    { id: "pm-clients", label: "Clients" },
    // The New / Edit project form. It is a page (so the sidebar keeps Projects open) but not one to browse to: the menu leaves it out.
    { id: "pm-new", label: "New project" },
    // One project's own page, opened from its card (the route's target is the project's id).
    { id: "pm-project", label: "Project" },
  ],
  calendar: [
    { id: "calendar-view", label: "Calendar" },
    { id: "calendar-timeoff", label: "Time off requests" },
  ],
  reports: [
    { id: "reports-all", label: "All reports" },
    { id: "reports-custom", label: "Custom" },
  ],
  people: [
    { id: "people-members", label: "Members" },
    { id: "people-members-tree", label: "Members tree" },
    { id: "people-teams", label: "Teams" },
    { id: "people-member-bans", label: "Banned members" },
    { id: "people-customer-accounts", label: "Customer accounts" },
  ],
  financials: [
    { id: "financials-overview", label: "Overview" },
    { id: "financials-payroll", label: "Manage payroll" },
    { id: "financials-create", label: "Create payments" },
    { id: "financials-records", label: "Payment records" },
    { id: "financials-invoices", label: "Invoices" },
    { id: "financials-expenses", label: "Expenses" },
  ],
};

/** The reports behind "All reports", grouped like the real Dashboard's Reports menu. */
export type ReportGroup = { label: string; reports: DashboardPage[] };
export const reportGroups: ReportGroup[] = [
  {
    label: "General",
    reports: [
      { id: "reports-time", label: "Time & activity" },
      { id: "reports-work-sessions", label: "Work sessions" },
      { id: "reports-apps-urls", label: "Apps & URLs" },
      { id: "reports-manual-edits", label: "Manual time edits" },
      { id: "reports-timesheet-approvals", label: "Timesheet approvals" },
      { id: "reports-expenses", label: "Expenses" },
      { id: "reports-work-breaks", label: "Work breaks" },
      { id: "reports-audit", label: "Audit log" },
    ],
  },
  {
    label: "Payment",
    reports: [
      { id: "reports-amounts", label: "Amounts owed" },
      { id: "reports-payments", label: "Payments" },
    ],
  },
  {
    label: "Budgets and limits",
    reports: [
      { id: "reports-weekly-limits", label: "Weekly limits" },
      { id: "reports-daily-limits", label: "Daily limits" },
      { id: "reports-project-budgets", label: "Project budgets" },
      { id: "reports-client-budgets", label: "Client budgets" },
    ],
  },
  {
    label: "Time off",
    reports: [
      { id: "reports-time-off-balances", label: "Time off balances" },
      { id: "reports-time-off-transactions", label: "Time off transactions" },
    ],
  },
  {
    label: "Invoice",
    reports: [
      { id: "reports-client-invoices", label: "Client invoices" },
      { id: "reports-team-invoices", label: "Team invoices" },
      { id: "reports-client-invoices-aging", label: "Client invoices aging" },
      { id: "reports-team-invoices-aging", label: "Team invoices aging" },
    ],
  },
  {
    label: "Schedule",
    reports: [{ id: "reports-shift-attendance", label: "Shift attendance" }],
  },
];
const reportIds = reportGroups.flatMap((group) => group.reports.map((report) => report.id));
export const isReportPage = (id: string) => reportIds.includes(id);
export const reportLabel = (id: string) =>
  reportGroups.flatMap((group) => group.reports).find((report) => report.id === id)?.label ?? "Report";

const sectionIds = Object.keys(sectionPages) as (keyof typeof sectionPages)[];
/** Whether `id` names a whole section (as opposed to one of its pages). */
export const isSection = (id: string): id is DashboardSection => id === "settings" || sectionIds.includes(id as keyof typeof sectionPages);
/** The section a page belongs to (a report belongs to Reports). */
export function sectionOfPage(id: string): DashboardSection | null {
  if (id === "settings") return "settings";
  if (isReportPage(id)) return "reports";
  return sectionIds.find((section) => sectionPages[section].some((page) => page.id === id)) ?? null;
}

const MANAGERS = ["Owner", "Admin", "Manager"];
const ADMINS = ["Owner", "Admin"];
const STAFF = ["Owner", "Admin", "Manager", "Member"];

/** Which roles may open a page, following the real Dashboard's rules (member-role-access.ts):
 *  owners, admins and managers see everything; a member sees their own time and tasks and the
 *  team; a client sees only what is shared with them. A page not listed is open to every role. */
const pageRoles: Record<string, string[]> = {
  "timesheets-view": STAFF,
  "timesheets-submissions": STAFF,
  "timesheets-manual-requests": STAFF,
  notifications: STAFF,
  "activity-overview": STAFF,
  "activity-apps": STAFF,
  "activity-urls": STAFF,
  "activity-tools": STAFF,
  "activity-removal-requests": STAFF,
  "pm-overview": [...MANAGERS, "Client"],
  "pm-clients": MANAGERS,
  "pm-new": MANAGERS,
  "people-members": STAFF,
  "people-members-tree": STAFF,
  "people-teams": STAFF,
  "people-member-bans": ADMINS,
  "people-customer-accounts": ADMINS,
  "financials-overview": MANAGERS,
  "financials-payroll": ADMINS,
  "financials-create": ADMINS,
  "financials-records": MANAGERS,
  "financials-invoices": MANAGERS,
  "financials-expenses": MANAGERS,
  "reports-custom": MANAGERS,
};
// A client sees "All reports" with four reports in it; a member sees no Reports at all.
const CLIENT_REPORTS = new Set(["reports-work-sessions", "reports-apps-urls", "reports-daily-limits", "reports-weekly-limits"]);

export function pageAllowed(role: string, id: string): boolean {
  if (id === "settings" || MANAGERS.includes(role)) return true;
  if (id === "reports-all") return role === "Client";
  if (isReportPage(id)) return role === "Client" && CLIENT_REPORTS.has(id);
  const roles = pageRoles[id];
  return roles ? roles.includes(role) : true;
}

/** The pages of a section this role may open, in tab order. */
export function pagesFor(role: string, section: DashboardSection): DashboardPage[] {
  if (section === "settings") return [];
  return sectionPages[section].filter((page) => pageAllowed(role, page.id));
}

/** Whether a role gets a section in the sidebar at all. */
export function sectionAllowed(role: string, section: DashboardSection): boolean {
  return section === "settings" || pagesFor(role, section).length > 0;
}

/** The page to show for `id`, which is either a section (opens on its first page for the role) or
 *  a page. Anything unknown, or not allowed for the role, falls back to the Command Center. */
export function resolvePage(role: string, id: string): string {
  if (id === "dashboard" || !id) return "command-center";
  const section = sectionIds.find((entry) => entry === id);
  if (section) return pagesFor(role, section)[0]?.id ?? "command-center";
  return sectionOfPage(id) && pageAllowed(role, id) ? id : "command-center";
}

export type Invoice = {
  id: string;
  client: string;
  project: string;
  amount: number;
  due: string;
  status: "Paid" | "Sent" | "Draft" | "Overdue";
};
export const initialInvoices: Invoice[] = [
  {
    id: "INV-2026-024",
    client: "Buffalo Studio",
    project: "Buffalo Campaign",
    amount: 4800,
    due: "2026-10-15",
    status: "Sent",
  },
  {
    id: "INV-2026-023",
    client: "Nova Labs",
    project: "Nova Vanguard",
    amount: 7200,
    due: "2026-10-10",
    status: "Draft",
  },
  {
    id: "INV-2026-022",
    client: "RWS Group",
    project: "RWS Campaign",
    amount: 3200,
    due: "2026-10-02",
    status: "Overdue",
  },
  {
    id: "INV-2026-021",
    client: "Buffalo Studio",
    project: "Buffalo Campaign",
    amount: 5600,
    due: "2026-09-28",
    status: "Paid",
  },
];
