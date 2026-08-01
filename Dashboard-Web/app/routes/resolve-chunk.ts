import { SHIFT_STYLE_HUB_REPORTS } from "@/features/reports"
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
  "timesheets-approvals": "timesheets",
  "timesheets-time-activity": "timesheets",

  "reports-project-budgets": "reports",
  "reports-timesheet-approvals": "reports",
  "reports-apps-urls": "reports",
  "reports-time": "reports",
  "reports-daily": "reports",
  "reports-amounts": "reports",
  "reports-all": "reports",
  "reports-custom": "reports",
  "reports-work-sessions": "reports",
  "reports-manual-edits": "reports",
  "reports-work-breaks": "reports",
  "reports-audit": "reports",
  "reports-expenses": "reports",

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

for (const pageId of Object.keys(SHIFT_STYLE_HUB_REPORTS)) {
  PAGE_CHUNK[pageId] = "reports"
}

export function resolveChunkId(pageId: string): AppChunkId {
  return PAGE_CHUNK[pageId] ?? "dashboard"
}
