/** What carries a tooltip. */
export const TIP_SELECTOR = "[data-tip], [title]";

type Box = { left: number; top: number; bottom: number; width: number };
type Size = { width: number; height: number };

/** Room for the arrow and the highlight drawn around the target. */
export const TIP_GAP = 12;
const ARROW_INSET = 14;
/** Kept clear at the very bottom, where the app has its own controls. */
const BOTTOM_MARGIN = 24;

export type Placed = { left: number; top: number; below: boolean; arrow: number | null };

/**
 * Below the target and centred on it, flipped above when there is no room, and never
 * off-screen. `arrow` is how far along the bubble its arrow sits, so it keeps pointing at
 * the target's centre even when the bubble has been pushed sideways to stay in view.
 * A target too big to sit beside (a whole panel) gets the bubble at the foot of the window
 * with no arrow, since there is nowhere outside the target for it to point from.
 */
export function placeTip(target: Box, tip: Size, view: Size, gap = TIP_GAP, edge = 8): Placed {
  const centre = target.left + target.width / 2;
  const left = Math.min(Math.max(edge, centre - tip.width / 2), Math.max(edge, view.width - tip.width - edge));
  const below = target.bottom + gap;
  const above = target.top - gap - tip.height;
  if (below + tip.height + edge <= view.height) {
    return { left, top: below, below: true, arrow: arrowAt(centre, left, tip.width) };
  }
  if (above >= edge) {
    return { left, top: above, below: false, arrow: arrowAt(centre, left, tip.width) };
  }
  return { left, top: Math.max(edge, view.height - tip.height - BOTTOM_MARGIN), below: false, arrow: null };
}

function arrowAt(centre: number, left: number, width: number): number {
  return Math.min(Math.max(centre - left, ARROW_INSET), Math.max(ARROW_INSET, width - ARROW_INSET));
}

/**
 * What to say for `el`, or the longer explanation when `help` is set. A native `title` is
 * taken over, so the browser's own tooltip does not appear beside this one, and it becomes
 * the accessible name when the element has none of its own - moving it must not leave an
 * icon button unnamed.
 */
export function tipTextOf(el: Element, help = false): string {
  const title = el.getAttribute("title")?.trim();
  if (title) {
    if (!el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
    el.setAttribute("data-tip", title);
    el.removeAttribute("title");
  }
  const tip = el.getAttribute("data-tip")?.trim() ?? "";
  // The tour explains what a thing is for, in more words than its tooltip has.
  return (help && el.getAttribute("data-help")?.trim()) || tip;
}
