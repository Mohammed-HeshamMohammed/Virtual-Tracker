// The shape of the hierarchy the Connections view works with: who reports to whom, derived from
// the API's nodes and edges with the same rules the list view uses (one manager each, no Owner under
// an Owner, nobody dropped), plus the questions the canvas keeps asking of it.
import { roleKey } from "./roles.ts"

export type TreeNodeInfo = {
  id: string
  name: string
  email: string
  role: string
  hierarchy_status?: string
  avatar_url?: string
}

export type TreeEdgeInfo = { parent_member_id: string; child_member_id: string }

export type TreeModel = {
  nodeById: Map<string, TreeNodeInfo>
  parentOf: Map<string, string | null>
  childrenOf: Map<string, string[]>
  /** Where each tree starts. */
  roots: string[]
  /** Members the server says have a role that needs a manager and have none. Shown apart, not in the tree. */
  orphans: string[]
  depthOf: Map<string, number>
}

const NEEDS_MANAGER = "hierarchy_assignment_required"

export function buildTreeModel(input: {
  nodes: TreeNodeInfo[]
  edges: TreeEdgeInfo[]
  validRootIds?: string[] | null
}): TreeModel {
  const { nodes, edges, validRootIds } = input
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  // One manager each - the last edge wins, as on the server (visual-tree's childToParent) - and
  // an Owner is never under an Owner.
  const parentOf = new Map<string, string | null>()
  for (const edge of edges) {
    const parent = nodeById.get(edge.parent_member_id)
    const child = nodeById.get(edge.child_member_id)
    if (!parent || !child || parent.id === child.id) continue
    if (roleKey(parent.role) === "owner" && roleKey(child.role) === "owner") continue
    parentOf.set(child.id, parent.id)
  }
  for (const node of nodes) if (!parentOf.has(node.id)) parentOf.set(node.id, null)

  // A cycle in the data (should not exist) would hide its members; cut each one at the member
  // the walk comes back to.
  for (const node of nodes) {
    const seen = new Set<string>([node.id])
    let cursor = parentOf.get(node.id) ?? null
    while (cursor) {
      if (seen.has(cursor)) {
        parentOf.set(cursor, null)
        break
      }
      seen.add(cursor)
      cursor = parentOf.get(cursor) ?? null
    }
  }

  const childrenOf = new Map<string, string[]>()
  for (const node of nodes) childrenOf.set(node.id, [])
  for (const [childId, parentId] of parentOf) {
    if (parentId) childrenOf.get(parentId)!.push(childId)
  }

  const orphanSet = new Set(nodes.filter((n) => n.hierarchy_status === NEEDS_MANAGER).map((n) => n.id))
  const orphans = nodes.filter((n) => orphanSet.has(n.id) && !parentOf.get(n.id)).map((n) => n.id)

  // Roots: the server's valid roots when it gave any, otherwise whoever has no manager. Orphans are
  // never roots. Anyone not reached from those - the reports of an orphan, say - starts a tree of
  // their own, so nobody silently disappears.
  const validSet = new Set(validRootIds ?? [])
  const baseRoots = nodes
    .filter((n) => !orphanSet.has(n.id))
    .filter((n) => (validSet.size > 0 ? validSet.has(n.id) : !parentOf.get(n.id)))
    .map((n) => n.id)
  const roots = [...baseRoots]
  const reached = new Set<string>()
  const walk = (id: string) => {
    if (reached.has(id)) return
    reached.add(id)
    for (const child of childrenOf.get(id) ?? []) walk(child)
  }
  roots.forEach(walk)
  for (const node of nodes) {
    if (reached.has(node.id) || orphanSet.has(node.id)) continue
    const parent = parentOf.get(node.id)
    if (parent && !reached.has(parent) && !orphanSet.has(parent)) continue // a higher member will start this tree
    roots.push(node.id)
    walk(node.id)
  }

  const depthOf = new Map<string, number>()
  const assignDepth = (id: string, depth: number) => {
    depthOf.set(id, depth)
    for (const child of childrenOf.get(id) ?? []) assignDepth(child, depth + 1)
  }
  roots.forEach((id) => assignDepth(id, 0))

  return { nodeById, parentOf, childrenOf, roots, orphans, depthOf }
}

/** Every member below `id`, however deep. */
export function descendantsOf(model: TreeModel, id: string): string[] {
  const out: string[] = []
  const stack = [...(model.childrenOf.get(id) ?? [])]
  while (stack.length) {
    const current = stack.pop()!
    out.push(current)
    for (const child of model.childrenOf.get(current) ?? []) stack.push(child)
  }
  return out
}

/** `id` and the managers above them, nearest first, ending at the top. */
export function pathToRoot(model: TreeModel, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let cursor: string | null | undefined = id
  while (cursor && !seen.has(cursor)) {
    out.push(cursor)
    seen.add(cursor)
    cursor = model.parentOf.get(cursor)
  }
  return out
}

/** The members whose absence from view should hide `id`: collapsed ancestors hide their whole branch. */
export function visibleIds(model: TreeModel, collapsed: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  const walk = (id: string) => {
    out.add(id)
    if (collapsed.has(id)) return
    for (const child of model.childrenOf.get(id) ?? []) walk(child)
  }
  model.roots.forEach(walk)
  return out
}

export function maxDepth(model: TreeModel): number {
  let max = 0
  for (const depth of model.depthOf.values()) max = Math.max(max, depth + 1)
  return max
}

/** Fold the teams of everyone at the last level shown, so exactly `levels` levels are visible (1 = just the roots). */
export function collapsedBeyond(model: TreeModel, levels: number): Set<string> {
  const out = new Set<string>()
  for (const [id, depth] of model.depthOf) {
    if (depth + 1 === levels && (model.childrenOf.get(id)?.length ?? 0) > 0) out.add(id)
  }
  return out
}

/** Every member that has a team - what "Collapse all" folds. */
export function allParents(model: TreeModel): Set<string> {
  const out = new Set<string>()
  for (const [id, children] of model.childrenOf) if (children.length > 0 && model.depthOf.has(id)) out.add(id)
  return out
}

/**
 * Optimistic result of a reassignment, so the chart updates before the server answers: `id` and
 * their whole team now hang under `newParentId`. Returns edges for the same node set.
 */
export function edgesAfterMove(edges: TreeEdgeInfo[], id: string, newParentId: string): TreeEdgeInfo[] {
  return [...edges.filter((edge) => edge.child_member_id !== id), { parent_member_id: newParentId, child_member_id: id }]
}
