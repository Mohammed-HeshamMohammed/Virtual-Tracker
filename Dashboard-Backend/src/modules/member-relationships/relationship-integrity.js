
export const INVALID_EDGE_REASON = {
  SELF_LOOP: "self_loop",
  DUPLICATE: "duplicate",
  MULTIPLE_PARENTS: "multiple_parents",
  BACK_EDGE: "back_edge",
  CYCLE: "cycle",
  OWNER_UNDER_OWNER: "owner_under_owner",
};

export class RelationshipIntegrityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RelationshipIntegrityError";
    this.code = code;
  }
}

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function edgePairKey(edge) {
  return `${edge.parent_member_id}:${edge.child_member_id}`;
}

export function filterDownwardEdges(edges, rootMemberId) {
  const filtered = edges.filter(
    (e) =>
      e.parent_member_id &&
      e.child_member_id &&
      e.parent_member_id !== e.child_member_id &&
      (!rootMemberId || e.child_member_id !== rootMemberId),
  );
  if (!filtered.length) return filtered;

  const adjacency = new Map();
  for (const edge of filtered) {
    if (!adjacency.has(edge.parent_member_id)) adjacency.set(edge.parent_member_id, []);
    adjacency.get(edge.parent_member_id).push(edge.child_member_id);
  }

  const depth = new Map();
  const queue = [];

  if (rootMemberId) {
    depth.set(rootMemberId, 0);
    queue.push(rootMemberId);
  } else {
    const childIds = new Set(filtered.map((e) => e.child_member_id));
    for (const edge of filtered) {
      if (!childIds.has(edge.parent_member_id) && !depth.has(edge.parent_member_id)) {
        depth.set(edge.parent_member_id, 0);
        queue.push(edge.parent_member_id);
      }
    }
  }

  while (queue.length) {
    const current = queue.shift();
    const currentDepth = depth.get(current) ?? 0;
    for (const child of adjacency.get(current) || []) {
      if (!depth.has(child)) {
        depth.set(child, currentDepth + 1);
        queue.push(child);
      }
    }
  }

  return filtered.filter((edge) => {
    const parentDepth = depth.get(edge.parent_member_id);
    const childDepth = depth.get(edge.child_member_id);
    if (parentDepth === undefined || childDepth === undefined) return false;
    return childDepth > parentDepth;
  });
}

function isReachable(from, to, edges) {
  if (from === to) return true;
  const adjacency = new Map();
  for (const edge of edges) {
    if (edge.parent_member_id === edge.child_member_id) continue;
    if (!adjacency.has(edge.parent_member_id)) adjacency.set(edge.parent_member_id, []);
    adjacency.get(edge.parent_member_id).push(edge.child_member_id);
  }
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

export function validateNewRelationship(existingEdges, parentMemberId, childMemberId) {
  if (!parentMemberId || !childMemberId) {
    return { ok: false, code: "invalid_input", message: "parent and child member ids are required." };
  }
  if (parentMemberId === childMemberId) {
    return { ok: false, code: INVALID_EDGE_REASON.SELF_LOOP, message: "A member cannot be their own manager." };
  }

  const duplicate = existingEdges.find(
    (e) => e.parent_member_id === parentMemberId && e.child_member_id === childMemberId,
  );
  if (duplicate) {
    return { ok: true, duplicate: true };
  }

  const otherParent = existingEdges.find(
    (e) => e.child_member_id === childMemberId && e.parent_member_id !== parentMemberId,
  );
  if (otherParent) {
    return {
      ok: false,
      code: INVALID_EDGE_REASON.MULTIPLE_PARENTS,
      message: "This member already has a manager in the hierarchy.",
    };
  }

  if (isReachable(childMemberId, parentMemberId, existingEdges)) {
    return {
      ok: false,
      code: INVALID_EDGE_REASON.CYCLE,
      message: "This relationship would create a circular hierarchy.",
    };
  }

  return { ok: true };
}

export function validateNewRelationshipWithRoles(
  existingEdges,
  parentMemberId,
  childMemberId,
  parentRoleKey,
  childRoleKey,
) {
  if (childRoleKey === "owner" && parentRoleKey === "owner") {
    return {
      ok: false,
      code: INVALID_EDGE_REASON.OWNER_UNDER_OWNER,
      message: "An Owner cannot report to another Owner in the hierarchy.",
    };
  }
  return validateNewRelationship(existingEdges, parentMemberId, childMemberId);
}

export function planOwnerRootSeparationRepairs(rawEdges, roleKeyByMemberId) {
  const remove = [];
  const lookup =
    roleKeyByMemberId instanceof Map
      ? (id) => roleKeyByMemberId.get(id)
      : (id) => roleKeyByMemberId[id];

  for (const edge of rawEdges) {
    if (!edge.id || !edge.parent_member_id || !edge.child_member_id) continue;
    const parentKey = lookup(edge.parent_member_id);
    const childKey = lookup(edge.child_member_id);
    if (parentKey === "owner" && childKey === "owner") {
      remove.push({ id: edge.id, reason: INVALID_EDGE_REASON.OWNER_UNDER_OWNER, edge });
    }
  }

  return remove;
}

export function planRelationshipRepairs(rawEdges) {
  const remove = [];
  const removedIds = new Set();

  const markRemove = (entry) => {
    if (removedIds.has(entry.id)) return;
    removedIds.add(entry.id);
    remove.push(entry);
  };

  let edges = rawEdges.filter((e) => e.id && e.parent_member_id && e.child_member_id);

  for (const edge of edges) {
    if (edge.parent_member_id === edge.child_member_id) {
      markRemove({ id: edge.id, reason: INVALID_EDGE_REASON.SELF_LOOP, edge });
    }
  }
  edges = edges.filter((e) => !removedIds.has(e.id));

  const sortedOldestFirst = [...edges].sort((a, b) => toMillis(a.created_at) - toMillis(b.created_at));
  const keptPairKeys = new Set();
  for (const edge of sortedOldestFirst) {
    const key = edgePairKey(edge);
    if (keptPairKeys.has(key)) {
      markRemove({ id: edge.id, reason: INVALID_EDGE_REASON.DUPLICATE, edge });
    } else {
      keptPairKeys.add(key);
    }
  }
  edges = edges.filter((e) => !removedIds.has(e.id));

  const sortedOldestFirst2 = [...edges].sort((a, b) => toMillis(a.created_at) - toMillis(b.created_at));
  const parentByChild = new Map();
  for (const edge of sortedOldestFirst2) {
    if (parentByChild.has(edge.child_member_id)) {
      markRemove({ id: edge.id, reason: INVALID_EDGE_REASON.MULTIPLE_PARENTS, edge });
    } else {
      parentByChild.set(edge.child_member_id, edge);
    }
  }
  edges = edges.filter((e) => !removedIds.has(e.id));

  let guard = 0;
  while (guard++ < edges.length + 1) {
    const active = edges.filter((e) => !removedIds.has(e.id));
    if (!active.length) break;

    const childIds = new Set(active.map((e) => e.child_member_id));
    const hasRoot = active.some((e) => !childIds.has(e.parent_member_id));

    if (!hasRoot) {
      const newest = [...active].sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))[0];
      markRemove({ id: newest.id, reason: INVALID_EDGE_REASON.CYCLE, edge: newest });
      continue;
    }

    const validIds = new Set(filterDownwardEdges(active).map((e) => e.id).filter(Boolean));
    const invalid = active.filter((e) => e.id && !validIds.has(e.id));
    if (!invalid.length) break;

    for (const edge of invalid.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))) {
      markRemove({ id: edge.id, reason: INVALID_EDGE_REASON.BACK_EDGE, edge });
    }
  }

  const kept = rawEdges.filter((e) => e.id && !removedIds.has(e.id));
  return { remove, kept };
}

export function filterTeamScopeEdges(rootMemberId, edges) {
  return filterDownwardEdges(edges, rootMemberId);
}
