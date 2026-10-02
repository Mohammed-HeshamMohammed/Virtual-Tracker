// Super Admins and Admins report straight to the Owner - the head of the organization - not to
// whichever admin happened to add them. Without this, a Super Admin invited by another Super Admin
// (or promoted later by the Owner, which never moved them) hung two levels down, and the tree
// stopped saying who actually runs the organization.
import { listMembersPg } from "../../lib/postgres/members-postgres.service.js";
import { loadRoleNameById, normalizeRoleKey } from "../members/services/relation-sync.js";

export function isAdminTierRole(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "superadmin" || key === "admin";
}

function isOwnerKey(roleName) {
  return normalizeRoleKey(roleName) === "owner";
}

/**
 * The Owner an admin-tier member should report to, from plain data (no database):
 * the Owner already above them if there is one, otherwise the oldest Owner.
 *
 * @param {string} memberId
 * @param {Map<string, string | null>} parentOf  member id -> manager id
 * @param {(id: string) => string | undefined} roleOf
 * @param {string[]} ownerIds Owners, oldest first
 */
export function ownerFor(memberId, parentOf, roleOf, ownerIds) {
  const seen = new Set([memberId]);
  let cursor = parentOf.get(memberId) ?? null;
  while (cursor && !seen.has(cursor)) {
    if (isOwnerKey(roleOf(cursor))) return cursor;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return ownerIds.find((id) => id !== memberId) ?? null;
}

/** Everyone with the Owner role, oldest first (the original Owner leads). */
export async function findOwnerIds(db) {
  const [members, roleNameById] = await Promise.all([listMembersPg({ limit: 5000 }), loadRoleNameById(db)]);
  return members
    .filter((member) => isOwnerKey(roleNameById.get(typeof member.role_id === "string" ? member.role_id : "") ?? ""))
    .sort((a, b) => new Date(a.date_added ?? 0).getTime() - new Date(b.date_added ?? 0).getTime())
    .map((member) => String(member.id));
}

/** The Owner a newly placed admin-tier member should go under, or null when there is none. */
export async function findPrimaryOwnerId(db, exceptMemberId = null) {
  const owners = await findOwnerIds(db);
  return owners.find((id) => id !== exceptMemberId) ?? null;
}

/**
 * Which admin-tier members are not directly under an Owner, and the Owner each should move to.
 * Pure: pass in the roles and the current manager of everyone.
 */
export function planAdminAnchors({ memberIds, roleOf, parentOf, ownerIds }) {
  const plan = [];
  for (const id of memberIds) {
    if (!isAdminTierRole(roleOf(id))) continue;
    const parent = parentOf.get(id) ?? null;
    if (parent && isOwnerKey(roleOf(parent))) continue;
    const ownerId = ownerFor(id, parentOf, roleOf, ownerIds);
    if (ownerId) plan.push({ memberId: id, ownerId, fromParentId: parent });
  }
  return plan;
}
