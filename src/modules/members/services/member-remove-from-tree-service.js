import { isOwnerRole, OWNER_REMOVE_BLOCKED_MESSAGE } from "../../../http/role-owner-policy.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import { removeMemberHierarchyRelationships } from "../../member-relationships/service.js";
import { syncMemberHierarchyStatus } from "../../hierarchy/hierarchy-sync.js";
import { MEMBER_SCOPED_DELETE_COLLECTIONS } from "./member-entity-bootstrap.js";
import { alignMemberRoleTables, syncMemberPrimaryRole } from "./relation-sync.js";

const ASSIGNMENT_COLLECTIONS = ["team_members", "project_members"];

/**
 * Delete all rows in a collection where member_id matches.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collection
 * @param {string} memberId
 */
async function deleteRowsByMemberId(db, collection, memberId) {
  let removed = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await db.collection(collection).where("member_id", "==", memberId).limit(200).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    removed += snap.size;
    if (snap.size < 200) break;
  }
  return removed;
}

/**
 * Clear task assignee for tasks assigned to this member.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} actorMemberId
 */
async function unassignMemberFromTasks(db, memberId, actorMemberId) {
  let cleared = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await db.collection("tasks").where("assigned_to", "==", memberId).limit(200).get();
    if (snap.empty) break;
    const batch = db.batch();
    const now = new Date();
    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        assigned_to: null,
        updated_at: now,
        updated_by: actorMemberId,
      });
    }
    await batch.commit();
    cleared += snap.size;
    if (snap.size < 200) break;
  }
  return cleared;
}

/**
 * Remove a member from the org tree: demote to Viewer, clear hierarchy, and disconnect assignments.
 * Does not delete the member account or disable authentication.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string; actorMemberId: string; actorRoleName: string }} input
 */
export async function removeMemberFromTree(db, input) {
  const memberId = typeof input.memberId === "string" ? input.memberId.trim() : "";
  const actorMemberId = typeof input.actorMemberId === "string" ? input.actorMemberId.trim() : "";
  const actorRoleName = typeof input.actorRoleName === "string" ? input.actorRoleName : "";

  if (!memberId) {
    throw Object.assign(new Error("memberId is required."), { status: 400 });
  }
  if (memberId === actorMemberId) {
    throw Object.assign(
      new Error("You cannot remove yourself from the tree here. Use Settings or Profile for self-removal."),
      { status: 400 },
    );
  }

  const memberSnap = await db.collection("members").doc(memberId).get();
  if (!memberSnap.exists) {
    throw Object.assign(new Error("Member not found."), { status: 404 });
  }

  const currentRole = await resolveMemberRoleName(db, memberId);
  if (isOwnerRole(currentRole)) {
    throw Object.assign(new Error(OWNER_REMOVE_BLOCKED_MESSAGE), { status: 403 });
  }

  const hierarchyEdgesRemoved = await removeMemberHierarchyRelationships(db, memberId);

  let teamLinksRemoved = 0;
  let projectLinksRemoved = 0;
  for (const collection of ASSIGNMENT_COLLECTIONS) {
    if (!MEMBER_SCOPED_DELETE_COLLECTIONS.includes(collection)) continue;
    const count = await deleteRowsByMemberId(db, collection, memberId);
    if (collection === "team_members") teamLinksRemoved = count;
    if (collection === "project_members") projectLinksRemoved = count;
  }

  const tasksUnassigned = await unassignMemberFromTasks(db, memberId, actorMemberId);

  await syncMemberPrimaryRole(db, memberId, "Viewer", actorMemberId, actorRoleName);
  await alignMemberRoleTables(db, memberId, actorMemberId);
  await syncMemberHierarchyStatus(db, memberId, "Viewer");

  await db.collection("members").doc(memberId).set(
    {
      hierarchy_status: "unassigned",
      hierarchy_status_updated_at: new Date(),
      privileged_role_owner_granted: false,
      updated_at: new Date(),
      updated_by: actorMemberId,
    },
    { merge: true },
  );

  return {
    memberId,
    previousRole: currentRole,
    role: "Viewer",
    hierarchyStatus: "unassigned",
    hierarchyEdgesRemoved,
    teamLinksRemoved,
    projectLinksRemoved,
    tasksUnassigned,
  };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberIds: string[]; actorMemberId: string; actorRoleName: string }} input
 */
export async function batchRemoveMembersFromTree(db, input) {
  const memberIds = Array.isArray(input.memberIds)
    ? [...new Set(input.memberIds.filter((id) => typeof id === "string" && id.trim()))].slice(0, 100)
    : [];
  if (!memberIds.length) {
    throw Object.assign(new Error("memberIds must be a non-empty array."), { status: 400 });
  }

  const results = [];
  for (const memberId of memberIds) {
    const row = await removeMemberFromTree(db, {
      memberId,
      actorMemberId: input.actorMemberId,
      actorRoleName: input.actorRoleName,
    });
    results.push(row);
  }
  return { removed: results.length, results };
}
