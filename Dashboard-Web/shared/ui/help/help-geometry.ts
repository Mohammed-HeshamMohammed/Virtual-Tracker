// Self-contained on purpose (no imports): the geometry and the wording rules are tested
// straight from Node, and nothing here may depend on the app's path aliases.

export const HELP_SELECTOR = "[data-help], [data-tip], [title], [aria-label]"

type Box = { left: number; top: number; bottom: number; width: number }
type Size = { width: number; height: number }

/** Room for the arrow and the highlight drawn around the target. */
export const HELP_GAP = 12
const ARROW_INSET = 14

/**
 * Below the target and centred on it, flipped above when there is no room, and never
 * off-screen. `arrow` is how far along the callout its arrow sits, so it keeps pointing at
 * the target's centre even when the callout has been pushed sideways to stay in view.
 */
export function placeCallout(
  target: Box,
  callout: Size,
  view: Size,
  gap = HELP_GAP,
  edge = 8,
): { left: number; top: number; below: boolean; arrow: number } {
  const centre = target.left + target.width / 2
  const left = Math.min(Math.max(edge, centre - callout.width / 2), Math.max(edge, view.width - callout.width - edge))
  const below = target.bottom + gap
  const fitsBelow = below + callout.height + edge <= view.height
  const arrow = Math.min(Math.max(centre - left, ARROW_INSET), Math.max(ARROW_INSET, callout.width - ARROW_INSET))
  return {
    left,
    top: fitsBelow ? below : Math.max(edge, target.top - gap - callout.height),
    below: fitsBelow,
    arrow,
  }
}

type Attributed = { getAttribute(name: string): string | null }

/** What to say for an element: its explanation, else its tooltip, title or accessible name. */
export function helpTextOf(el: Attributed): string {
  for (const name of ["data-help", "data-tip", "title", "aria-label"]) {
    const value = el.getAttribute(name)?.trim()
    if (value) return value
  }
  return ""
}
