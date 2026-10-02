// Where every member's card goes. Pure geometry: no React, no DOM.
//
// Cartesian: a classic org chart, each manager centred over their team. Large teams of people who
// manage nobody (a manager with seventy employees) are packed into a grid inside a labelled frame
// instead of one seventy-wide row, which is what made the old chart unreadable past a few dozen.
// Polar: the same tree fanned out around the root.

export type LayoutKind = "cartesian" | "polar"
export type Orientation = "vertical" | "horizontal"

export type LayoutOptions = {
  layout: LayoutKind
  orientation: Orientation
  nodeWidth: number
  nodeHeight: number
  siblingGap: number
  levelGap: number
  /** Leaf reports needed before a team is packed into a grid. */
  gridMin: number
  gridMaxColumns: number
  gridGap: number
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  layout: "cartesian",
  orientation: "vertical",
  nodeWidth: 188,
  nodeHeight: 60,
  siblingGap: 28,
  levelGap: 64,
  gridMin: 5,
  gridMaxColumns: 6,
  gridGap: 14,
}

/** How a member is drawn on the chart: a full card, or just their picture. */
export type CardStyle = "card" | "avatar"

/** The sizes for a card style. Avatars are small and square, so the same tree takes a fraction of the room. */
export function layoutOptionsFor(style: CardStyle, base: Pick<LayoutOptions, "layout" | "orientation">): LayoutOptions {
  if (style === "avatar") {
    return {
      ...DEFAULT_LAYOUT_OPTIONS,
      ...base,
      nodeWidth: 72,
      nodeHeight: 72,
      siblingGap: 16,
      levelGap: 56,
      gridMaxColumns: 10,
      gridGap: 10,
    }
  }
  return { ...DEFAULT_LAYOUT_OPTIONS, ...base }
}

export type LayoutInput = {
  roots: string[]
  childrenOf: Map<string, string[]>
}

export type Point = { x: number; y: number }

/** A frame drawn around a packed team, with the count in its header. */
export type GroupFrame = {
  /** The manager whose team this is. */
  parentId: string
  memberIds: string[]
  x: number
  y: number
  width: number
  height: number
}

export type LayoutResult = {
  /** Centre of each visible member's card. */
  positions: Map<string, Point>
  groups: GroupFrame[]
  /** The box that holds every card, frame and margin. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

const MARGIN = 80
const GRID_PAD = 10
const GRID_HEADER = 24

type Placed = { id: string; b: number; d: number }
type Frame = { parentId: string; memberIds: string[]; b: number; d: number; w: number; h: number }
type Block = { width: number; height: number; placed: Placed[]; frames: Frame[]; rootB: number }

function visibleChildren(input: LayoutInput, collapsed: ReadonlySet<string>, id: string): string[] {
  return collapsed.has(id) ? [] : (input.childrenOf.get(id) ?? [])
}

function isVisibleLeaf(input: LayoutInput, collapsed: ReadonlySet<string>, id: string): boolean {
  return visibleChildren(input, collapsed, id).length === 0
}

export function computeLayout(input: LayoutInput, collapsed: ReadonlySet<string>, options: LayoutOptions): LayoutResult {
  return options.layout === "polar" ? layoutPolar(input, collapsed, options) : layoutCartesian(input, collapsed, options)
}

function layoutCartesian(input: LayoutInput, collapsed: ReadonlySet<string>, o: LayoutOptions): LayoutResult {
  const vertical = o.orientation === "vertical"
  // Breadth runs along the row of siblings, depth down the levels; both are swapped for horizontal.
  const nodeB = vertical ? o.nodeWidth : o.nodeHeight
  const nodeD = vertical ? o.nodeHeight : o.nodeWidth
  const slotB = nodeB + o.siblingGap
  const slotD = nodeD + o.levelGap
  const colPitch = nodeB + o.gridGap
  const rowPitch = nodeD + o.gridGap

  const leafBlock = (id: string): Block => ({
    width: slotB,
    height: slotD,
    placed: [{ id, b: slotB / 2, d: nodeD / 2 }],
    frames: [],
    rootB: slotB / 2,
  })

  const gridBlock = (parentId: string, ids: string[]): Block => {
    const columns = Math.min(o.gridMaxColumns, Math.max(2, Math.ceil(Math.sqrt(ids.length * 1.5))))
    const rows = Math.ceil(ids.length / columns)
    const innerWidth = columns * colPitch - o.gridGap
    const width = Math.max(slotB, innerWidth + GRID_PAD * 2)
    const left = (width - innerWidth) / 2
    const placed = ids.map((id, index) => ({
      id,
      b: left + (index % columns) * colPitch + nodeB / 2,
      d: GRID_HEADER + GRID_PAD + Math.floor(index / columns) * rowPitch + nodeD / 2,
    }))
    const frameHeight = GRID_HEADER + GRID_PAD * 2 + rows * rowPitch - o.gridGap
    return {
      width,
      height: frameHeight + o.levelGap,
      placed,
      frames: [{ parentId, memberIds: ids, b: left - GRID_PAD, d: 0, w: innerWidth + GRID_PAD * 2, h: frameHeight }],
      rootB: width / 2,
    }
  }

  const subtree = (id: string): Block => {
    const kids = visibleChildren(input, collapsed, id)
    if (kids.length === 0) return leafBlock(id)

    const leaves = kids.filter((kid) => isVisibleLeaf(input, collapsed, kid))
    const useGrid = leaves.length >= o.gridMin
    const items: Block[] = []
    if (useGrid) items.push(gridBlock(id, leaves))
    for (const kid of kids) {
      if (useGrid && isVisibleLeaf(input, collapsed, kid)) continue
      items.push(subtree(kid))
    }

    let cursor = 0
    let childHeight = 0
    const placed: Placed[] = []
    const frames: Frame[] = []
    for (const item of items) {
      for (const p of item.placed) placed.push({ id: p.id, b: p.b + cursor, d: p.d + slotD })
      for (const f of item.frames) frames.push({ ...f, b: f.b + cursor, d: f.d + slotD })
      cursor += item.width
      childHeight = Math.max(childHeight, item.height)
    }
    const width = Math.max(slotB, cursor)
    const shift = (width - cursor) / 2
    if (shift !== 0) {
      for (const p of placed) p.b += shift
      for (const f of frames) f.b += shift
    }
    // Over the middle of the first and last member of the team, so a lopsided team does not drag
    // its manager off to one side.
    const first = items[0]
    const last = items[items.length - 1]
    const firstCentre = shift + first.rootB
    const lastCentre = shift + (cursor - last.width) + last.rootB
    const rootB = items.length === 1 ? shift + first.rootB : (firstCentre + lastCentre) / 2
    placed.unshift({ id, b: rootB, d: nodeD / 2 })
    return { width, height: slotD + childHeight, placed, frames, rootB }
  }

  const forest: Block[] = input.roots.map(subtree)
  let cursor = 0
  const positions = new Map<string, Point>()
  const groups: GroupFrame[] = []
  const toPoint = (b: number, d: number): Point => (vertical ? { x: b, y: d } : { x: d, y: b })
  for (const block of forest) {
    for (const p of block.placed) positions.set(p.id, toPoint(p.b + cursor, p.d))
    for (const f of block.frames) {
      const topLeft = toPoint(f.b + cursor, f.d)
      groups.push({
        parentId: f.parentId,
        memberIds: f.memberIds,
        x: topLeft.x,
        y: topLeft.y,
        width: vertical ? f.w : f.h,
        height: vertical ? f.h : f.w,
      })
    }
    cursor += block.width
  }

  return finish(positions, groups, o)
}

function layoutPolar(input: LayoutInput, collapsed: ReadonlySet<string>, o: LayoutOptions): LayoutResult {
  const leafCount = new Map<string, number>()
  const countLeaves = (id: string): number => {
    const kids = visibleChildren(input, collapsed, id)
    const count = kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + countLeaves(kid), 0)
    leafCount.set(id, count)
    return count
  }
  const totalLeaves = input.roots.reduce((sum, root) => sum + countLeaves(root), 0)
  if (totalLeaves === 0) return finish(new Map(), [], o)

  const angleOf = new Map<string, number>()
  const levelOf = new Map<string, number>()
  const perLevel = new Map<number, number>()
  let nextLeaf = 0
  const assign = (id: string, level: number): number => {
    levelOf.set(id, level)
    perLevel.set(level, (perLevel.get(level) ?? 0) + 1)
    const kids = visibleChildren(input, collapsed, id)
    let angle: number
    if (kids.length === 0) {
      angle = ((nextLeaf + 0.5) / totalLeaves) * Math.PI * 2
      nextLeaf += 1
    } else {
      const angles = kids.map((kid) => assign(kid, level + 1))
      angle = (angles[0] + angles[angles.length - 1]) / 2
    }
    angleOf.set(id, angle)
    return angle
  }
  input.roots.forEach((root) => assign(root, 0))

  // Far enough out that the cards on a ring do not overlap, and each ring clear of the last.
  const pitch = o.nodeWidth + o.siblingGap
  const ringStep = o.nodeHeight + o.levelGap + 40
  const radiusOf = new Map<number, number>()
  const levels = [...perLevel.keys()].sort((a, b) => a - b)
  let previous = -Infinity
  for (const level of levels) {
    const needed = ((perLevel.get(level) ?? 1) * pitch) / (Math.PI * 2)
    const single = level === 0 && input.roots.length === 1
    const radius = single ? 0 : Math.max(needed, previous === -Infinity ? 0 : previous + ringStep)
    radiusOf.set(level, radius)
    previous = radius
  }

  const positions = new Map<string, Point>()
  for (const [id, angle] of angleOf) {
    const radius = radiusOf.get(levelOf.get(id) ?? 0) ?? 0
    positions.set(id, { x: radius * Math.cos(angle - Math.PI / 2), y: radius * Math.sin(angle - Math.PI / 2) })
  }
  return finish(positions, [], o)
}

/** Moves everything so the top-left of the content sits at the margin, and reports the box. */
function finish(positions: Map<string, Point>, groups: GroupFrame[], o: LayoutOptions): LayoutResult {
  if (positions.size === 0) return { positions, groups, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { x, y } of positions.values()) {
    minX = Math.min(minX, x - o.nodeWidth / 2)
    maxX = Math.max(maxX, x + o.nodeWidth / 2)
    minY = Math.min(minY, y - o.nodeHeight / 2)
    maxY = Math.max(maxY, y + o.nodeHeight / 2)
  }
  for (const g of groups) {
    minX = Math.min(minX, g.x)
    minY = Math.min(minY, g.y)
    maxX = Math.max(maxX, g.x + g.width)
    maxY = Math.max(maxY, g.y + g.height)
  }
  const dx = MARGIN - minX
  const dy = MARGIN - minY
  const moved = new Map<string, Point>()
  for (const [id, p] of positions) moved.set(id, { x: p.x + dx, y: p.y + dy })
  return {
    positions: moved,
    groups: groups.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
    bounds: { minX: 0, minY: 0, maxX: maxX + dx + MARGIN, maxY: maxY + dy + MARGIN },
  }
}
