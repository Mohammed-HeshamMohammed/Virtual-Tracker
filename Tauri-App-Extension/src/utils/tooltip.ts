/** What carries a tooltip normally, and what carries one while help mode is on. */
export const TIP_SELECTOR = "[data-tip], [title]";
export const HELP_SELECTOR = "[data-help], [data-tip], [title]";

type Box = { left: number; top: number; bottom: number; width: number };
type Size = { width: number; height: number };

/** Room for the arrow and the highlight drawn around the target. */
export const TIP_GAP = 12;
const ARROW_INSET = 14;

/**
 * Below the target and centred on it, flipped above when there is no room, and never
 * off-screen. `arrow` is how far along the bubble its arrow sits, so it keeps pointing at
 * the target's centre even when the bubble has been pushed sideways to stay in view.
 */
export function placeTip(
  target: Box,
  tip: Size,
  view: Size,
  gap = TIP_GAP,
  edge = 8,
): { left: number; top: number; below: boolean; arrow: number } {
  const centre = target.left + target.width / 2;
  const left = Math.min(Math.max(edge, centre - tip.width / 2), Math.max(edge, view.width - tip.width - edge));
  const below = target.bottom + gap;
  const fitsBelow = below + tip.height + edge <= view.height;
  const arrow = Math.min(Math.max(centre - left, ARROW_INSET), Math.max(ARROW_INSET, tip.width - ARROW_INSET));
  return {
    left,
    top: fitsBelow ? below : Math.max(edge, target.top - gap - tip.height),
    below: fitsBelow,
    arrow,
  };
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
  // Help mode explains what a thing is for, in more words than its tooltip has.
  return (help && el.getAttribute("data-help")?.trim()) || tip;
}
