// Self-contained on purpose (no imports): what order a tour visits things in is a rule worth
// testing on its own, straight from Node, away from the page it runs on.

export type Closable = { closest(selector: string): unknown }

export type Candidate = { rank: number; order: number; group: string; repeat?: boolean }

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
  const repeated = new Set<string>()
  for (const item of sorted) size.set(item.group, (size.get(item.group) ?? 0) + 1)
  for (const item of sorted) if (item.repeat) repeated.add(item.group)
  const shown = new Map<string, number>()
  return sorted.filter((item) => {
    // Automatically inferred look-alikes need a run of three before they are collapsed, so
    // two unrelated "Close" buttons can still both be explained. A table column or an
    // explicit data-tour-repeat group is known to repeat, even when only two rows are shown.
    if (!repeated.has(item.group) && (size.get(item.group) ?? 0) < 3) return true
    const n = (shown.get(item.group) ?? 0) + 1
    shown.set(item.group, n)
    return n <= repeatsShown
  })
}

const CLOSED_SURFACE =
  '[data-state="closed"][data-slot$="-content"], [data-state="closed"][role="dialog"], [data-state="closed"][aria-modal="true"]'

/** Markup states that mean a control belongs to UI which is not currently open. */
export function isHiddenFromTour(el: Element): boolean {
  return !!el.closest(`[hidden], [aria-hidden="true"], [inert], ${CLOSED_SURFACE}`)
}

/** Whether a step can actually be pointed at: it takes up room and is visibly rendered. */
export function isShowable(el: Element): boolean {
  if (isHiddenFromTour(el)) return false
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const visible = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility
  if (
    visible &&
    !visible.call(el, {
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true,
    })
  ) {
    return false
  }

  // checkVisibility is not equally complete in every supported browser. Walking the chain
  // also catches collapsed/transparent popup wrappers whose children still report a size.
  const view = el.ownerDocument.defaultView
  if (!view) return true
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = view.getComputedStyle(node)
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") <= 0.01
    ) {
      return false
    }
  }
  return true
}
