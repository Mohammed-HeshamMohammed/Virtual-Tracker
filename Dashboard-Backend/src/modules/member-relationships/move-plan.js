// Moving a member under a different manager in the hierarchy: the rules, as a pure function so
// they can be tested without a database and shared by the service that carries the move out.
// The Members tree's "Change manager" and drag-to-reassign both end up here, and the server is the
// only authority - the page applies the same checks only to avoid offering a drop that will fail.

export const MOVE_ERROR = {
  INVALID: "invalid_input",
  NOT_FOUND: "member_not_found",
  SELF: "self_loop",
  OWNER: "owner_cannot_move",
  EXTERNAL_CHILD: "external_entity",
  EXTERNAL_PARENT: "external_parent",
  RANK: "manager_rank",
  CYCLE: "cycle",
};

function reject(code, message) {
  return { ok: false, code, message };
}

/**
 * @param {object} input
 * @param {string} input.memberId        the member being moved
 * @param {string} input.newParentId     their new manager
 * @param {Array<{id?: string, parent_member_id: string, child_member_id: string}>} input.edges every hierarchy edge now
 * @param {(id: string) => string | undefined} input.roleOf role name of a member, undefined when unknown
 * @param {(roleName: string) => string} input.roleKey   normalizes a role name ("Super Admin" -> "superadmin")
 * @param {(roleName: string) => number} input.rankOf    privilege rank of a role
 * @param {(roleName: string) => boolean} input.isExternal clients and other roles outside the hierarchy
 */
export function planMemberMove({ memberId, newParentId, edges, roleOf, roleKey, rankOf, isExternal }) {
  if (!memberId || !newParentId) return reject(MOVE_ERROR.INVALID, "A member and a new manager are required.");
  if (memberId === newParentId) return reject(MOVE_ERROR.SELF, "A member cannot be their own manager.");

  const childRole = roleOf(memberId);
  const parentRole = roleOf(newParentId);
  if (childRole === undefined || parentRole === undefined) {
    return reject(MOVE_ERROR.NOT_FOUND, "That member could not be found.");
  }

  if (roleKey(childRole) === "owner") {
    return reject(MOVE_ERROR.OWNER, "The Owner is the top of the organization and cannot be moved under anyone.");
  }
  if (isExternal(childRole)) {
    return reject(MOVE_ERROR.EXTERNAL_CHILD, "Clients are not part of the hierarchy. Manage them through projects instead.");
  }
  if (isExternal(parentRole)) {
    return reject(MOVE_ERROR.EXTERNAL_PARENT, "A Client cannot be a manager.");
  }
  if (rankOf(parentRole) < rankOf(childRole)) {
    return reject(MOVE_ERROR.RANK, `A ${parentRole} cannot be the manager of a ${childRole}.`);
  }

  const parentOfChild = new Map();
  const childrenOf = new Map();
  for (const edge of edges) {
    if (!edge.parent_member_id || !edge.child_member_id || edge.parent_member_id === edge.child_member_id) continue;
    parentOfChild.set(edge.child_member_id, edge.parent_member_id);
    if (!childrenOf.has(edge.parent_member_id)) childrenOf.set(edge.parent_member_id, []);
    childrenOf.get(edge.parent_member_id).push(edge.child_member_id);
  }

  const previousParentId = parentOfChild.get(memberId) ?? null;
  if (previousParentId === newParentId) {
    return { ok: true, noop: true, previousParentId };
  }

  // The new manager must not sit anywhere below the member being moved.
  const seen = new Set([memberId]);
  const stack = [memberId];
  while (stack.length) {
    const current = stack.pop();
    for (const next of childrenOf.get(current) ?? []) {
      if (next === newParentId) {
        return reject(MOVE_ERROR.CYCLE, "That would put a manager under their own team.");
      }
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }

  return { ok: true, noop: false, previousParentId };
}
