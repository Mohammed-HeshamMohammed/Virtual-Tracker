// Every line the chart draws, from one place so the canvas and the SVG export cannot disagree.
import type { GroupFrame, Orientation, Point } from "./layout.ts"
import { linkPath, type Box, type LinkType } from "./links.ts"
import type { TreeModel } from "./model.ts"

export type ChartLink = {
  key: string
  /** The manager the line leaves. */
  fromId: string
  /** The member it reaches, or null when it goes to a packed team's frame. */
  toId: string | null
  d: string
}

export function buildLinks(input: {
  model: TreeModel
  positions: ReadonlyMap<string, Point>
  groups: GroupFrame[]
  /** Members dragged away from the layout: they keep their own line even inside a packed team. */
  movedIds?: ReadonlySet<string>
  nodeWidth: number
  nodeHeight: number
  orientation: Orientation
  type: LinkType
  stepPercent: number
}): ChartLink[] {
  const { model, positions, groups, nodeWidth: w, nodeHeight: h } = input
  const boxOf = (id: string): Box | null => {
    const p = positions.get(id)
    return p ? { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h } : null
  }
  const frameOfMember = new Map<string, GroupFrame>()
  for (const g of groups) for (const id of g.memberIds) frameOfMember.set(id, g)

  const options = { orientation: input.orientation, type: input.type, stepPercent: input.stepPercent }
  const links: ChartLink[] = []
  const framesDone = new Set<string>()
  for (const [id, parentId] of model.parentOf) {
    if (!parentId || !positions.has(id)) continue
    const from = boxOf(parentId)
    if (!from) continue
    const frame = frameOfMember.get(id)
    if (frame && frame.parentId === parentId && !input.movedIds?.has(id)) {
      if (framesDone.has(frame.parentId)) continue
      framesDone.add(frame.parentId)
      links.push({
        key: `group:${frame.parentId}`,
        fromId: parentId,
        toId: null,
        d: linkPath(from, { x: frame.x, y: frame.y, width: frame.width, height: frame.height }, options),
      })
      continue
    }
    const to = boxOf(id)
    if (to) links.push({ key: `${parentId}>${id}`, fromId: parentId, toId: id, d: linkPath(from, to, options) })
  }
  return links
}
