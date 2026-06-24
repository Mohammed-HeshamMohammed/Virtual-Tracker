import { NAV_SECTIONS, type NavSection } from "@/shared/ui/layout/config/nav-sections"
import { SHIFT_STYLE_HUB_REPORTS } from "@/features/reports"

function collectSectionPageIds(section: NavSection): string[] {
  const ids: string[] = []
  for (const page of section.pages ?? []) {
    ids.push(page.id)
  }
  for (const subsection of section.subsections ?? []) {
    for (const item of subsection.items) {
      ids.push(item.id)
    }
  }
  return ids
}

const NAV_PAGE_ORDER: string[] = []
for (const section of NAV_SECTIONS) {
  NAV_PAGE_ORDER.push(...collectSectionPageIds(section))
}

for (const pageId of Object.keys(SHIFT_STYLE_HUB_REPORTS)) {
  if (!NAV_PAGE_ORDER.includes(pageId)) {
    NAV_PAGE_ORDER.push(pageId)
  }
}

for (const extraPageId of ["profile", "favorites"]) {
  if (!NAV_PAGE_ORDER.includes(extraPageId)) {
    NAV_PAGE_ORDER.push(extraPageId)
  }
}

const NAV_PAGE_INDEX = new Map(NAV_PAGE_ORDER.map((pageId, index) => [pageId, index]))

/** Sidebar order index for transition direction; -1 when unknown. */
export function getPageNavIndex(pageId: string): number {
  return NAV_PAGE_INDEX.get(pageId) ?? -1
}

export function getPageTransitionDirection(previousPageId: string, nextPageId: string): number {
  if (previousPageId === nextPageId) return 0
  const previousIndex = getPageNavIndex(previousPageId)
  const nextIndex = getPageNavIndex(nextPageId)
  if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) return 0
  return nextIndex > previousIndex ? 1 : -1
}
