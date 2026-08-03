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

// Non-Tier-1 individual report pages.
COMING_SOON_PAGES.add("reports-work-sessions")    // Tier 2 — needs new endpoint
COMING_SOON_PAGES.add("reports-manual-edits")      // Tier 2 — needs new endpoint
COMING_SOON_PAGES.add("reports-amounts")           // Tier 3 — blocked on Billing backend
COMING_SOON_PAGES.add("reports-audit")             // Tier 3 — blocked on audit log infrastructure
COMING_SOON_PAGES.add("reports-apps-urls")         // No backend — coming soon
COMING_SOON_PAGES.add("reports-expenses")          // No backend — coming soon
COMING_SOON_PAGES.add("reports-timesheet-approvals") // No backend — coming soon

// General dashboard disabled — placeholder only (no API calls).
COMING_SOON_PAGES.add("general")

// Favorites hub is not yet implemented.
COMING_SOON_PAGES.add("favorites")

// Timesheet approvals setup is not yet implemented.
COMING_SOON_PAGES.add("timesheets-approvals")

export function isComingSoonPage(pageId: string): boolean {
  return COMING_SOON_PAGES.has(pageId)
}
