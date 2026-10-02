// Cards the viewer has dragged somewhere. Stored as how far each card is from where the automatic
// layout put it, so a changed tree (someone added, a team collapsed) still lays out sensibly and
// only the cards that were moved stay moved. Per browser, per view: it is a viewing preference,
// not data.
import type { Point } from "./layout.ts"

export type Offsets = Map<string, Point>

const PREFIX = "vt:members-tree:offsets:"
const MAX_ENTRIES = 2000

export function offsetsKey(scope: string, viewerId: string | undefined): string {
  return `${PREFIX}${scope}:${viewerId ?? "anon"}`
}

export function parseOffsets(raw: string | null): Offsets {
  const out: Offsets = new Map()
  if (!raw) return out
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (out.size >= MAX_ENTRIES) break
      const point = value as { x?: unknown; y?: unknown }
      if (typeof point?.x === "number" && typeof point?.y === "number" && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        if (point.x !== 0 || point.y !== 0) out.set(id, { x: point.x, y: point.y })
      }
    }
  } catch {
    /* a corrupt entry is the same as none */
  }
  return out
}

export function serializeOffsets(offsets: Offsets): string {
  const obj: Record<string, Point> = {}
  for (const [id, point] of offsets) {
    if (point.x !== 0 || point.y !== 0) obj[id] = { x: Math.round(point.x), y: Math.round(point.y) }
  }
  return JSON.stringify(obj)
}

/** Drops offsets for members no longer in the tree. */
export function pruneOffsets(offsets: Offsets, present: ReadonlySet<string>): Offsets {
  const out: Offsets = new Map()
  for (const [id, point] of offsets) if (present.has(id)) out.set(id, point)
  return out
}

export function loadOffsets(key: string): Offsets {
  try {
    return parseOffsets(window.localStorage.getItem(key))
  } catch {
    return new Map()
  }
}

export function saveOffsets(key: string, offsets: Offsets): void {
  try {
    if (offsets.size === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, serializeOffsets(offsets))
  } catch {
    /* private mode or full: the arrangement just lasts this session */
  }
}
