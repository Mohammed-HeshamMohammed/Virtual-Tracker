import type { MemberTreeEdge, MemberTreeNode } from "@/features/members/services/member-tree"
import { isOwnerRoleName } from "@/features/auth"

export type MemberTreeBranch = {
  node: MemberTreeNode
  children: MemberTreeBranch[]
  depth: number
}

/** Owner cannot report to another Owner — nested Owner becomes a separate root with their branch. */
export function stripOwnerUnderOwnerEdges(
  edges: MemberTreeEdge[],
  nodes: MemberTreeNode[],
): MemberTreeEdge[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  return edges.filter((edge) => {
    const parent = nodeById.get(edge.parent_member_id)
    const child = nodeById.get(edge.child_member_id)
    if (!parent || !child) return true
    return !(isOwnerRoleName(parent.role) && isOwnerRoleName(child.role))
  })
}

/** Drops self-loops, edges pointing at the root, and upward/back-edges in a team subtree. */
export function sanitizeTreeEdges(
  edges: MemberTreeEdge[],
  rootMemberId?: string | null,
): MemberTreeEdge[] {
  if (!rootMemberId) {
    return edges.filter(
      (e) =>
        e.parent_member_id &&
        e.child_member_id &&
        e.parent_member_id !== e.child_member_id,
    )
  }

  const filtered = edges.filter(
    (e) =>
      e.parent_member_id &&
      e.child_member_id &&
      e.parent_member_id !== e.child_member_id &&
      e.child_member_id !== rootMemberId,
  )
  if (!filtered.length) return filtered

  const adjacency = new Map<string, string[]>()
  for (const edge of filtered) {
    const list = adjacency.get(edge.parent_member_id) || []
    list.push(edge.child_member_id)
    adjacency.set(edge.parent_member_id, list)
  }

  const depth = new Map<string, number>([[rootMemberId, 0]])
  const queue = [rootMemberId]
  while (queue.length) {
    const current = queue.shift()!
    const currentDepth = depth.get(current) ?? 0
    for (const child of adjacency.get(current) || []) {
      if (!depth.has(child)) {
        depth.set(child, currentDepth + 1)
        queue.push(child)
      }
    }
  }

  return filtered.filter((edge) => {
    const parentDepth = depth.get(edge.parent_member_id)
    const childDepth = depth.get(edge.child_member_id)
    if (parentDepth === undefined || childDepth === undefined) return false
    return childDepth > parentDepth
  })
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase()
}

export function buildMemberTreeBranches(
  nodes: MemberTreeNode[],
  edges: MemberTreeEdge[],
  rootMemberId?: string | null,
  validRootMemberIds?: string[] | null,
): MemberTreeBranch[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const withoutOwnerNesting = stripOwnerUnderOwnerEdges(edges, nodes)
  const scopedEdges = rootMemberId
    ? sanitizeTreeEdges(withoutOwnerNesting, rootMemberId)
    : withoutOwnerNesting.filter((e) => e.parent_member_id !== e.child_member_id)

  const childMap = new Map<string, string[]>()
  const childIds = new Set<string>()

  for (const edge of scopedEdges) {
    if (!nodeMap.has(edge.parent_member_id) || !nodeMap.has(edge.child_member_id)) continue
    const list = childMap.get(edge.parent_member_id) || []
    if (!list.includes(edge.child_member_id)) {
      list.push(edge.child_member_id)
    }
    childMap.set(edge.parent_member_id, list)
    childIds.add(edge.child_member_id)
  }

  const orphanSet = new Set(
    nodes.filter((n) => n.hierarchy_status === "hierarchy_assignment_required").map((n) => n.id),
  )

  let roots: MemberTreeNode[]
  if (rootMemberId && nodeMap.has(rootMemberId)) {
    roots = [nodeMap.get(rootMemberId)!]
  } else if (validRootMemberIds?.length) {
    const validSet = new Set(validRootMemberIds)
    roots = nodes.filter((n) => validSet.has(n.id) && !orphanSet.has(n.id))
  } else {
    roots = nodes.filter((n) => !childIds.has(n.id) && !orphanSet.has(n.id))
  }

  const toBranch = (id: string, visited: Set<string>, depth: number): MemberTreeBranch => {
    const nextVisited = new Set(visited)
    nextVisited.add(id)
    const children = (childMap.get(id) || [])
      .filter((childId) => !visited.has(childId))
      .map((childId) => toBranch(childId, nextVisited, depth + 1))
    return { node: nodeMap.get(id)!, children, depth }
  }

  return roots.map((r) => toBranch(r.id, new Set(), 0))
}

export function countTreeMembers(branches: MemberTreeBranch[]): number {
  let count = 0
  const walk = (items: MemberTreeBranch[]) => {
    for (const item of items) {
      count += 1
      walk(item.children)
    }
  }
  walk(branches)
  return count
}

export function maxTreeDepth(branches: MemberTreeBranch[]): number {
  let max = 0
  const walk = (items: MemberTreeBranch[]) => {
    for (const item of items) {
      max = Math.max(max, item.depth + 1)
      walk(item.children)
    }
  }
  walk(branches)
  return max
}

export type MemberTreeIndex = {
  nodeById: Map<string, MemberTreeNode>
  parentById: Map<string, string | null>
  childrenById: Map<string, string[]>
  rootIds: string[]
}

/** Flat index for navigating parent / child connections in the profile view. */
export function buildMemberTreeIndex(
  nodes: MemberTreeNode[],
  edges: MemberTreeEdge[],
  rootMemberId?: string | null,
): MemberTreeIndex {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const withoutOwnerNesting = stripOwnerUnderOwnerEdges(edges, nodes)
  const scopedEdges = rootMemberId
    ? sanitizeTreeEdges(withoutOwnerNesting, rootMemberId)
    : withoutOwnerNesting.filter((e) => e.parent_member_id !== e.child_member_id)

  const parentById = new Map<string, string | null>()
  const childrenById = new Map<string, string[]>()
  const childIds = new Set<string>()

  for (const edge of scopedEdges) {
    if (!nodeById.has(edge.parent_member_id) || !nodeById.has(edge.child_member_id)) continue
    parentById.set(edge.child_member_id, edge.parent_member_id)
    const list = childrenById.get(edge.parent_member_id) || []
    if (!list.includes(edge.child_member_id)) {
      list.push(edge.child_member_id)
    }
    childrenById.set(edge.parent_member_id, list)
    childIds.add(edge.child_member_id)
  }

  for (const node of nodes) {
    if (!parentById.has(node.id)) {
      parentById.set(node.id, null)
    }
    if (!childrenById.has(node.id)) {
      childrenById.set(node.id, [])
    }
  }

  const rootIds =
    rootMemberId && nodeById.has(rootMemberId)
      ? [rootMemberId]
      : nodes.filter((n) => !childIds.has(n.id)).map((n) => n.id)

  return { nodeById, parentById, childrenById, rootIds }
}

export type TreeChartNodeData = {
  id: string
  name: string
  initials?: string
  avatarColor?: string
  imageUrl?: string
  isCollapsed?: boolean
  children?: TreeChartNodeData[]
}

function branchToTreeChartNode(branch: MemberTreeBranch, currentMemberId?: string): TreeChartNodeData {
  const isSelf = branch.node.id === currentMemberId
  return {
    id: branch.node.id,
    name: branch.node.name,
    initials: initialsFromName(branch.node.name),
    avatarColor: memberAvatarColor(branch.node.id, isSelf),
    imageUrl: branch.node.avatar_url,
    children: branch.children.length ? branch.children.map((child) => branchToTreeChartNode(child, currentMemberId)) : undefined,
  }
}

/** Converts member tree branches into a single hierarchy for the visx chart. */
export function memberBranchesToTreeChartData(
  branches: MemberTreeBranch[],
  currentMemberId?: string,
): TreeChartNodeData | null {
  if (!branches.length) return null
  if (branches.length === 1) return branchToTreeChartNode(branches[0], currentMemberId)
  return {
    id: "__virtual_root__",
    name: "Organization",
    initials: "ORG",
    avatarColor: "#64748b",
    children: branches.map((branch) => branchToTreeChartNode(branch, currentMemberId)),
  }
}

export function memberAvatarColor(memberId: string, isSelf: boolean): string {
  if (isSelf) return "#2563eb"
  let hash = 0
  for (let i = 0; i < memberId.length; i++) {
    hash = (hash * 31 + memberId.charCodeAt(i)) | 0
  }
  const palette = ["#6366f1", "#0891b2", "#059669", "#d97706", "#db2777", "#64748b"]
  return palette[Math.abs(hash) % palette.length]
}
