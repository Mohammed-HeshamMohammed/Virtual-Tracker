import type { AppChunkId } from "@/app/routes/types"

/** Explicit page id → lazy chunk (domain bundle). */
const PAGE_CHUNK: Record<string, AppChunkId> = {
  "command-center": "dashboard",
  general: "dashboard",
  dashboard: "dashboard",
  favorites: "dashboard",

  "people-members": "people",
  "people-members-tree": "people",
  "people-member-bans": "people",
  "people-teams": "people",

  "pm-overview": "projects",
  "pm-projects": "projects",
  "pm-tasks": "projects",
  "pm-clients": "projects",
  "calendar-timeoff": "projects",

  "activity-screenshots": "activity",
  "activity-apps": "activity",
  "activity-urls": "activity",
  "activity-tools": "activity",

  "timesheets-view": "timesheets",
  "timesheets-submissions": "timesheets",
  "timesheets-manual-requests": "timesheets",
  "timesheets-time-activity": "timesheets",

  "financials-overview": "financials",
  "financials-payroll": "financials",
  "financials-create": "financials",
  "financials-records": "financials",
  "financials-invoices": "financials",
  "financials-expenses": "financials",

  "settings-all": "settings",
  "settings-organization": "settings",
  "settings-members": "settings",
  "settings-schedules": "settings",
  "settings-activity": "settings",
  "settings-integrations": "settings",
  "settings-policies": "settings",
  "settings-enterprise-security": "settings",
  "settings-billing": "settings",
  "settings-billing-plans": "settings",

  profile: "profile",
}

export function resolveChunkId(pageId: string): AppChunkId {
  // Every reports page, by prefix. This used to be thirteen hand-written
  // entries, and twelve report pages were missing from them - Payments, both
  // limits reports, Client budgets, both time off reports, all four invoice
  // reports, Shift attendance and the Budgets hub. A missing entry does not
  // fail loudly: it falls through to the `?? "dashboard"` below, and the
  // dashboard chunk renders the General dashboard for any id that is not
  // "command-center". So those pages opened as the General dashboard sitting
  // under a "Reports > ..." breadcrumb, which read as a broken report rather
  // than a missing route.
  if (pageId.startsWith("reports-")) return "reports"
  return PAGE_CHUNK[pageId] ?? "dashboard"
}
