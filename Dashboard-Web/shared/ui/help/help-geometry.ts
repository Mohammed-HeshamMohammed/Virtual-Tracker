// Self-contained on purpose (no imports): the geometry is tested straight from Node, and
// nothing here may depend on the app's path aliases.

type Box = { left: number; top: number; bottom: number; width: number }
type Size = { width: number; height: number }

/** Room for the arrow and the highlight drawn around the target. */
export const HELP_GAP = 12
const ARROW_INSET = 14
/** Kept clear at the very bottom of the window. */
const BOTTOM_MARGIN = 24

export type Placed = { left: number; top: number; below: boolean; arrow: number | null }

/**
 * Below the target and centred on it, flipped above when there is no room, and never
 * off-screen. `arrow` is how far along the callout its arrow sits, so it keeps pointing at
 * the target's centre even when the callout has been pushed sideways to stay in view. A
 * target too big to sit beside (a whole panel) gets the callout at the foot of the window
 * with no arrow, since there is nowhere outside the target for it to point from.
 */
export function placeCallout(target: Box, callout: Size, view: Size, gap = HELP_GAP, edge = 8): Placed {
  const centre = target.left + target.width / 2
  const left = Math.min(Math.max(edge, centre - callout.width / 2), Math.max(edge, view.width - callout.width - edge))
  const below = target.bottom + gap
  const above = target.top - gap - callout.height
  if (below + callout.height + edge <= view.height) {
    return { left, top: below, below: true, arrow: arrowAt(centre, left, callout.width) }
  }
  if (above >= edge) {
    return { left, top: above, below: false, arrow: arrowAt(centre, left, callout.width) }
  }
  return { left, top: Math.max(edge, view.height - callout.height - BOTTOM_MARGIN), below: false, arrow: null }
}

function arrowAt(centre: number, left: number, width: number): number {
  return Math.min(Math.max(centre - left, ARROW_INSET), Math.max(ARROW_INSET, width - ARROW_INSET))
}
