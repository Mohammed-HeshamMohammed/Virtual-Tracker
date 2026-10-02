// The lines between cards. A card can be dragged anywhere, so each end picks the side of its card
// that faces the other one rather than always leaving from the bottom.
import type { Orientation } from "./layout.ts"

export type LinkType = "diagonal" | "step" | "curve" | "line"

export type Box = { x: number; y: number; width: number; height: number }

type Side = "top" | "bottom" | "left" | "right"

function anchor(box: Box, side: Side): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: box.x + box.width / 2, y: box.y }
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height }
    case "left":
      return { x: box.x, y: box.y + box.height / 2 }
    case "right":
      return { x: box.x + box.width, y: box.y + box.height / 2 }
  }
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" }

/** Which side of `from` faces `to`. Prefers the orientation's natural direction until the card is far off to the side. */
export function facingSides(from: Box, to: Box, orientation: Orientation): { start: Side; end: Side } {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  const preferVertical = orientation === "vertical"
  const clearVertically = Math.abs(dy) >= (from.height + to.height) / 2 + 8
  const clearHorizontally = Math.abs(dx) >= (from.width + to.width) / 2 + 8
  let useVertical = preferVertical
  if (preferVertical && !clearVertically && clearHorizontally) useVertical = false
  if (!preferVertical && !clearHorizontally && clearVertically) useVertical = true
  const start: Side = useVertical ? (dy >= 0 ? "bottom" : "top") : dx >= 0 ? "right" : "left"
  return { start, end: OPPOSITE[start] }
}

function pathBetween(a: { x: number; y: number }, b: { x: number; y: number }, start: Side, type: LinkType, stepPercent: number): string {
  const verticalLeave = start === "top" || start === "bottom"
  if (type === "line") return `M ${a.x} ${a.y} L ${b.x} ${b.y}`

  if (type === "diagonal") {
    if (verticalLeave) {
      const my = (a.y + b.y) / 2
      return `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`
    }
    const mx = (a.x + b.x) / 2
    return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`
  }

  // step and curve are the same elbow; curve rounds its corners.
  const radius = type === "curve" ? 14 : 0
  const percent = Math.min(1, Math.max(0, stepPercent))
  if (verticalLeave) {
    const my = a.y + (b.y - a.y) * percent
    return elbow(a, { x: a.x, y: my }, { x: b.x, y: my }, b, radius)
  }
  const mx = a.x + (b.x - a.x) * percent
  return elbow(a, { x: mx, y: a.y }, { x: mx, y: b.y }, b, radius)
}

/** a -> p -> q -> b with straight legs, rounding the corners at p and q. */
function elbow(a: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }, b: { x: number; y: number }, radius: number): string {
  if (radius <= 0) return `M ${a.x} ${a.y} L ${p.x} ${p.y} L ${q.x} ${q.y} L ${b.x} ${b.y}`
  const corner = (from: { x: number; y: number }, at: { x: number; y: number }, to: { x: number; y: number }) => {
    const inLen = Math.hypot(at.x - from.x, at.y - from.y)
    const outLen = Math.hypot(to.x - at.x, to.y - at.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    if (r < 0.5) return { before: at, after: at, r: 0 }
    return {
      before: { x: at.x + ((from.x - at.x) / inLen) * r, y: at.y + ((from.y - at.y) / inLen) * r },
      after: { x: at.x + ((to.x - at.x) / outLen) * r, y: at.y + ((to.y - at.y) / outLen) * r },
      r,
    }
  }
  const c1 = corner(a, p, q)
  const c2 = corner(p, q, b)
  return [
    `M ${a.x} ${a.y}`,
    `L ${c1.before.x} ${c1.before.y}`,
    c1.r ? `Q ${p.x} ${p.y} ${c1.after.x} ${c1.after.y}` : `L ${p.x} ${p.y}`,
    `L ${c2.before.x} ${c2.before.y}`,
    c2.r ? `Q ${q.x} ${q.y} ${c2.after.x} ${c2.after.y}` : `L ${q.x} ${q.y}`,
    `L ${b.x} ${b.y}`,
  ].join(" ")
}

export function linkPath(from: Box, to: Box, options: { orientation: Orientation; type: LinkType; stepPercent: number }): string {
  const { start, end } = facingSides(from, to, options.orientation)
  return pathBetween(anchor(from, start), anchor(to, end), start, options.type, options.stepPercent)
}
