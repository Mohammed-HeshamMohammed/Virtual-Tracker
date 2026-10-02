import type { TreeNodeInfo } from "./model.ts"

export type SearchHit = { id: string; score: number }

/**
 * Members matching `query` by name, email or role, best first. Word starts beat the middle of a
 * word, and a name beats an email. An empty query matches nothing (the caller shows the whole tree).
 */
export function searchMembers(nodes: Iterable<TreeNodeInfo>, query: string, limit = 12): SearchHit[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const hits: SearchHit[] = []
  for (const node of nodes) {
    const name = node.name.toLowerCase()
    const email = node.email.toLowerCase()
    const role = node.role.toLowerCase()
    let total = 0
    let matchedAll = true
    for (const term of terms) {
      let best = 0
      if (name.startsWith(term)) best = 100
      else if (name.split(/\s+/).some((word) => word.startsWith(term))) best = 80
      else if (name.includes(term)) best = 50
      else if (email.startsWith(term)) best = 40
      else if (email.includes(term)) best = 25
      else if (role.includes(term)) best = 15
      if (best === 0) {
        matchedAll = false
        break
      }
      total += best
    }
    if (matchedAll) hits.push({ id: node.id, score: total })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}
