// The List view as data: which members show, indented how, and why. Searching or filtering by role
// keeps the people who match and the managers above them, opened up, so a match is never hidden
// inside a folded team.
import { pathToRoot, type TreeModel } from "./model.ts"
import { roleKey } from "./roles.ts"
import { searchMembers } from "./search.ts"

export type ListRow = {
  id: string
  depth: number
  /** Has a team (whether or not it is open). */
  hasTeam: boolean
  open: boolean
  /** This row is itself a hit for the search / role filter (its ancestors are shown only as the way to it). */
  match: boolean
}

export type ListFilter = { query: string; role: string | null }

export function isFiltering(filter: ListFilter): boolean {
  return filter.query.trim().length > 0 || filter.role !== null
}

/** Everyone who matches the filter, as a set. Null means no filter is active. */
export function matchingIds(model: TreeModel, filter: ListFilter): Set<string> | null {
  if (!isFiltering(filter)) return null
  let ids = new Set(model.nodeById.keys())
  if (filter.query.trim()) {
    ids = new Set(searchMembers(model.nodeById.values(), filter.query, Number.MAX_SAFE_INTEGER).map((hit) => hit.id))
  }
  if (filter.role) {
    const wanted = roleKey(filter.role)
    ids = new Set([...ids].filter((id) => roleKey(model.nodeById.get(id)?.role) === wanted))
  }
  return ids
}

export function flattenForList(model: TreeModel, collapsed: ReadonlySet<string>, filter: ListFilter): ListRow[] {
  const matches = matchingIds(model, filter)
  // While filtering, show each match with the chain above it, all open.
  const shown = matches ? new Set<string>() : null
  if (matches && shown) for (const id of matches) for (const ancestor of pathToRoot(model, id)) shown.add(ancestor)

  const rows: ListRow[] = []
  const walk = (id: string, depth: number) => {
    if (shown && !shown.has(id)) return
    const children = (model.childrenOf.get(id) ?? []).filter((child) => !shown || shown.has(child))
    const open = shown ? children.length > 0 : !collapsed.has(id)
    rows.push({ id, depth, hasTeam: (model.childrenOf.get(id)?.length ?? 0) > 0, open, match: matches ? matches.has(id) : true })
    if (open) for (const child of children) walk(child, depth + 1)
  }
  model.roots.forEach((root) => walk(root, 0))
  return rows
}
