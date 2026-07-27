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
addPagesFromSection("reports")
addPagesFromSection("financials")

Object.keys(SHIFT_STYLE_HUB_REPORTS).forEach((pageId) => COMING_SOON_PAGES.add(pageId))

// Legacy / hub routes not listed in nav subsections.
COMING_SOON_PAGES.add("reports-daily")

// Favorites hub is not yet implemented.
COMING_SOON_PAGES.add("favorites")

// Timesheet approvals setup is not yet implemented.
COMING_SOON_PAGES.add("timesheets-approvals")

export function isComingSoonPage(pageId: string): boolean {
  return COMING_SOON_PAGES.has(pageId)
}
