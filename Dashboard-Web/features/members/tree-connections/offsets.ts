// Cards the viewer has dragged somewhere. Stored as how far each card is from where the automatic
// layout put it, so a changed tree (someone added, a team collapsed) still lays out sensibly and
// only the cards that were moved stay moved. Per browser, per view: it is a viewing preference,
// not data.
import type { GroupFrame, Point } from "./layout.ts"

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

/** Key under which a packed team's frame (GroupFrame.key) is stored: it moves, and takes its members with it. */
export function frameKey(groupKey: string): string {
  return `group:${groupKey}`
}

/** Offsets worth keeping: members still in the tree, and the frames of managers still in the tree. */
export function presentOffsetKeys(memberIds: Iterable<string>): Set<string> {
  const keys = new Set<string>()
  for (const id of memberIds) {
    keys.add(id)
    keys.add(frameKey(id))
    for (let tier = 0; tier <= 3; tier++) keys.add(frameKey(`${id}|${tier}`))
  }
  return keys
}

/**
 * The picture as the viewer arranged it. A card is where the layout put it, plus its own offset,
 * plus its frame's offset (dragging a packed team's frame moves every card inside it). Frames move
 * by their own offset. `movedIds` are the members dragged out on their own - they keep a line of
 * their own even when they belong to a packed team.
 */
export function applyOffsets(
  basePositions: ReadonlyMap<string, Point>,
  baseGroups: readonly GroupFrame[],
  offsets: ReadonlyMap<string, Point>,
): { positions: Map<string, Point>; groups: GroupFrame[]; movedIds: Set<string> } {
  const frameOf = new Map<string, Point>()
  const groups = baseGroups.map((g) => {
    const o = offsets.get(frameKey(g.key))
    if (o) for (const id of g.memberIds) frameOf.set(id, o)
    return o ? { ...g, x: g.x + o.x, y: g.y + o.y } : g
  })
  const positions = new Map<string, Point>()
  const movedIds = new Set<string>()
  for (const [id, p] of basePositions) {
    const own = offsets.get(id)
    const frame = frameOf.get(id)
    if (own) movedIds.add(id)
    positions.set(id, { x: p.x + (own?.x ?? 0) + (frame?.x ?? 0), y: p.y + (own?.y ?? 0) + (frame?.y ?? 0) })
  }
  return { positions, groups, movedIds }
}
