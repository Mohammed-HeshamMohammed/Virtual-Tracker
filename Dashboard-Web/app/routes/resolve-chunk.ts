import type { AppChunkId } from "@/app/routes/types"

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
  if (pageId.startsWith("reports-")) return "reports"
  return PAGE_CHUNK[pageId] ?? "dashboard"
}
