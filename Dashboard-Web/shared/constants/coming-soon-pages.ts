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
// ...except Expenses, which is now backed by the real `expenses` table:
// claim, review (management only, never your own), remove, and it feeds the
// Expenses report.
COMING_SOON_PAGES.delete("financials-expenses")

// --- Reports: only non-Tier-1 reports are "coming soon" ---
// Tier 1 (unlocked): Time & Activity, Project Budgets, Daily Totals
// Hub pages (unlocked): reports-all, reports-custom

// Shift-style hub reports are all non-Tier-1 (payments, limits, budgets, time-off, invoices, shift attendance).
Object.keys(SHIFT_STYLE_HUB_REPORTS).forEach((pageId) => COMING_SOON_PAGES.add(pageId))

// reports-expenses is now backed by a real expenses table plus
// /api/reports/expenses and the Financials expense form — unlocked.
// reports-manual-edits is now backed by /api/reports/manual-time-edits, which
// reads the manual (source='manual') rows of time_entries — unlocked.
// reports-payments now reads invoice_payments - money actually recorded
// against an invoice, no longer the amounts-owed estimate relabelled.
// reports-work-breaks is now backed by /api/reports/work-breaks, which derives
// breaks from the gaps between a member's consecutive tracked sessions on the
// same local day — unlocked.
// reports-work-sessions, reports-amounts, reports-audit, reports-apps-urls,
// and reports-timesheet-approvals are now wired to real Postgres-backed
// endpoints (activity_sessions, daily_member_active_seconds, audit_logs,
// activity_app_logs/activity_url_logs, timesheets) — unlocked.

// General dashboard disabled — placeholder only (no API calls).
COMING_SOON_PAGES.add("general")

// Favorites hub is not yet implemented.
COMING_SOON_PAGES.add("favorites")

// timesheets-approvals (now split into timesheets-submissions and
// timesheets-manual-requests) has real pending-approvals queues
// (approve/reject via the generic schema CRUD, already
// management-role-gated server-side) — unlocked.

export function isComingSoonPage(pageId: string): boolean {
  return COMING_SOON_PAGES.has(pageId)
}
