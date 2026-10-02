// Can this member be dropped under that one? The same rules the server enforces on
// POST /member-relationships/move (move-plan.js), so the canvas can show a green or red target
// while dragging instead of letting someone drop and then be told no. The server still decides.
import { descendantsOf, type TreeModel } from "./model.ts"
import { isClientRole, isOwnerRole, roleRank } from "./roles.ts"

export type ReassignVerdict = { ok: true; noop: boolean } | { ok: false; reason: string }

export function canReassign(model: TreeModel, memberId: string, newParentId: string): ReassignVerdict {
  if (memberId === newParentId) return { ok: false, reason: "A member cannot be their own manager." }
  const member = model.nodeById.get(memberId)
  const parent = model.nodeById.get(newParentId)
  if (!member || !parent) return { ok: false, reason: "That member is not in this view." }

  if (isOwnerRole(member.role)) return { ok: false, reason: "The Owner is the top of the organization." }
  if (isClientRole(member.role)) return { ok: false, reason: "Clients are not part of the hierarchy." }
  if (isClientRole(parent.role)) return { ok: false, reason: "A Client cannot be a manager." }
  if (roleRank(parent.role) < roleRank(member.role)) {
    return { ok: false, reason: `A ${parent.role} cannot manage a ${member.role}.` }
  }
  if (model.parentOf.get(memberId) === newParentId) return { ok: true, noop: true }
  if (descendantsOf(model, memberId).includes(newParentId)) {
    return { ok: false, reason: "That would put a manager under their own team." }
  }
  return { ok: true, noop: false }
}

/**
 * Everyone `memberId` may be moved under. People who already manage a team come first (they are
 * the likely answer), then by seniority, then by name.
 */
export function validManagersFor(model: TreeModel, memberId: string): string[] {
  const out: string[] = []
  for (const id of model.nodeById.keys()) {
    const verdict = canReassign(model, memberId, id)
    if (verdict.ok && !verdict.noop) out.push(id)
  }
  const leads = (id: string) => ((model.childrenOf.get(id)?.length ?? 0) > 0 ? 1 : 0)
  return out.sort((a, b) => {
    const left = model.nodeById.get(a)!
    const right = model.nodeById.get(b)!
    return leads(b) - leads(a) || roleRank(right.role) - roleRank(left.role) || left.name.localeCompare(right.name)
  })
}
