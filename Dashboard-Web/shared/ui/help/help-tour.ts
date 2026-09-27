// Self-contained on purpose (no imports): what order a tour visits things in is a rule worth
// testing on its own, straight from Node, away from the page it runs on.

export type Closable = { closest(selector: string): unknown }

export type Candidate = { rank: number; order: number; group: string }

/** What the tour visits, in the order it visits it: the sidebar, then the top bar, then the page. */
export const TOUR_REGIONS = ["aside", "header", "main"] as const

/** Where an element sits in the tour: the index of the first region holding it, else after them all. */
export function rankOf(el: Closable, regions: readonly string[] = TOUR_REGIONS): number {
  const found = regions.findIndex((selector) => el.closest(selector))
  return found === -1 ? regions.length : found
}

/**
 * Region by region, and top to bottom inside each. A long run of look-alike rows (named with
 * `data-tour-repeat`) is shown by its first row only: the tour explains what a list is, not
 * every line in it.
 */
export function orderForTour<T extends Candidate>(items: T[], repeatsShown = 1): T[] {
  const sorted = [...items].sort((a, b) => a.rank - b.rank || a.order - b.order)
  const size = new Map<string, number>()
  for (const item of sorted) size.set(item.group, (size.get(item.group) ?? 0) + 1)
  const shown = new Map<string, number>()
  return sorted.filter((item) => {
    if ((size.get(item.group) ?? 0) < 3) return true
    const n = (shown.get(item.group) ?? 0) + 1
    shown.set(item.group, n)
    return n <= repeatsShown
  })
}

/** Whether a step can actually be pointed at: it takes up room and is not hidden. */
export function isShowable(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const visible = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility
  return visible ? visible.call(el, { visibilityProperty: true }) : true
}
