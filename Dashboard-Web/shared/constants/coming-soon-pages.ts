import { NAV_SECTIONS } from "@/shared/ui/layout/config/nav-sections"
import { SHIFT_STYLE_HUB_REPORTS } from "@/features/reports"

const COMING_SOON_PAGES = new Set<string>()

function addPagesFromSection(sectionId: string) {
  const section = NAV_SECTIONS.find((s) => s.id === sectionId)
  if (!section) return
  section.pages?.forEach((page) => COMING_SOON_PAGES.add(page.id))
  section.subsections?.forEach((subsection) => {
    subsection.items.forEach((item) => COMING_SOON_PAGES.add(item.id))
  })
}

addPagesFromSection("settings")
addPagesFromSection("financials")

// --- Reports: only non-Tier-1 reports are "coming soon" ---
// Tier 1 (unlocked): Time & Activity, Project Budgets, Daily Totals, Work Breaks
// Hub pages (unlocked): reports-all, reports-custom

// Shift-style hub reports are all non-Tier-1 (payments, limits, budgets, time-off, invoices, shift attendance).
Object.keys(SHIFT_STYLE_HUB_REPORTS).forEach((pageId) => COMING_SOON_PAGES.add(pageId))

// Non-Tier-1 individual report pages still with no real backend.
COMING_SOON_PAGES.add("reports-manual-edits") // No backend — coming soon
COMING_SOON_PAGES.add("reports-expenses")     // No backend — coming soon
// reports-work-sessions, reports-amounts, reports-audit, reports-apps-urls,
// and reports-timesheet-approvals are now wired to real Postgres-backed
// endpoints (activity_sessions, daily_member_active_seconds, audit_logs,
// activity_app_logs/activity_url_logs, timesheets) — unlocked.

// General dashboard disabled — placeholder only (no API calls).
COMING_SOON_PAGES.add("general")

// Favorites hub is not yet implemented.
COMING_SOON_PAGES.add("favorites")

// timesheets-approvals now has a real pending-approvals queue (approve/reject
// via the generic timesheets schema CRUD, already management-role-gated
// server-side) — unlocked.

export function isComingSoonPage(pageId: string): boolean {
  return COMING_SOON_PAGES.has(pageId)
}
