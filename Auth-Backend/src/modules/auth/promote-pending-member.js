import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { isExcludedFromHierarchy } from "../hierarchy/hierarchy-placement.js";
import { recordMemberRelationship } from "../member-relationships/service.js";
import { ensureMemberLinkedRecordsForUserRecord } from "../members/services/ensure-member-linked-records.js";
import { upsertMemberPayRate } from "../members/services/member-profile.service.js";
import {
  deletePendingAuthProjects,
  getPendingAuthProjectIds,
  syncMemberPrimaryRole,
  syncProjectMembersForMember,
} from "../members/services/relation-sync.js";
import { logSafeError, logSafeWarn } from "../../http/sanitize-error.js";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { upsertProfileFromUserRecord } from "./profile-sync.js";

const PENDING_AUTH = "pending_auth_members";

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Record<string, unknown>} row
 */
async function resolveInviteCreatorRoleName(db, row) {
  const createdByMemberId = typeof row.created_by === "string" ? row.created_by.trim() : "";
  if (createdByMemberId) {
    return resolveMemberRoleName(db, createdByMemberId);
  }
  const creatorUid = typeof row.created_by_uid === "string" ? row.created_by_uid.trim() : "";
  if (!creatorUid) return "";
  const snap = await db.collection("members").where("firebase_uid", "==", creatorUid).limit(1).get();
  if (snap.empty) return "";
  return resolveMemberRoleName(db, snap.docs[0].id);
}

/**
 * Promote a pre-provisioned pending_auth_members row into a full member on first login.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {import("firebase-admin/auth").Auth} auth
 * @param {string} uid
 */
export async function promotePendingMemberCore(db, auth, uid) {
  const pendRef = db.collection(PENDING_AUTH).doc(uid);
  const pendSnap = await pendRef.get();
  if (!pendSnap.exists) {
    const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
    await profileRef.set({ must_change_password: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const userRecord = await auth.getUser(uid);
    return { promoted: false, profile: await upsertProfileFromUserRecord(db, userRecord) };
  }
  const p = pendSnap.data() || {};
  const email = typeof p.email === "string" ? p.email : "";
  const displayName = typeof p.display_name === "string" ? p.display_name : "";
  const pendingPhone = typeof p.phone_number === "string" ? p.phone_number.trim() : "";
  const [firstName, ...rest] = displayName.split(/\s+/).filter(Boolean);
  const lastName = rest.join(" ");
  const memberId = crypto.randomUUID();
  const memberPayload = {
    id: memberId,
    first_name: firstName || "Member",
    last_name: lastName,
    work_email: email,
    personal_email: "",
    employee_id: "",
    ip_address: "",
    ...(pendingPhone ? { phone_number: pendingPhone, phone_verified: false } : {}),
    status: "active",
    date_added: new Date(),
    created_by: "invite-preprovision",
    created_by_uid: typeof p.created_by_uid === "string" ? p.created_by_uid : "",
    updated_by: "",
    updated_at: new Date(),
    firebase_uid: uid,
  };
  let roleName = "Viewer";
  if (typeof p.role_id === "string" && p.role_id) {
    const roleDoc = await db.collection("roles").doc(p.role_id).get();
    if (roleDoc.exists && typeof roleDoc.data()?.name === "string" && roleDoc.data().name.trim()) {
      roleName = roleDoc.data().name.trim();
    }
  } else if (typeof p.role_name === "string" && p.role_name) {
    roleName = p.role_name;
  }
  const payRate = typeof p.pay_rate === "number" && !Number.isNaN(p.pay_rate) ? p.pay_rate : 0;

  const projects = await getPendingAuthProjectIds(db, uid);

  await db.collection("members").doc(memberId).set(memberPayload);
  const creatorRoleName = await resolveInviteCreatorRoleName(db, p);
  await syncMemberPrimaryRole(
    db,
    memberId,
    roleName,
    typeof p.created_by_uid === "string" ? p.created_by_uid : "",
    creatorRoleName,
  );
  await upsertMemberPayRate(db, memberId, payRate, typeof p.created_by_uid === "string" ? p.created_by_uid : "");
  if (projects.length > 0) {
    await syncProjectMembersForMember(db, memberId, projects, typeof p.created_by_uid === "string" ? p.created_by_uid : "");
  }

  const createdByUid = typeof p.created_by_uid === "string" ? p.created_by_uid : "";
  if (createdByUid && !isExcludedFromHierarchy(roleName)) {
    try {
      const creatorQuery = await db.collection("members").where("firebase_uid", "==", createdByUid).limit(1).get();
      if (!creatorQuery.empty) {
        const creatorMemberId = creatorQuery.docs[0].id;
        await recordMemberRelationship(db, {
          parentMemberId: creatorMemberId,
          childMemberId: memberId,
          relationshipType: "preprovision",
          createdBy: creatorMemberId,
          projects,
        });
      }
    } catch (relErr) {
      logSafeError("[promotePendingMemberCore] Failed to record relationship:", relErr);
    }
  }

  await pendRef.delete();
  await deletePendingAuthProjects(db, uid);
  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  await profileRef.set({ must_change_password: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const userRecord = await auth.getUser(uid);
  try {
    await ensureMemberLinkedRecordsForUserRecord(db, userRecord);
  } catch (e) {
    logSafeWarn("[promotePendingMemberCore] ensure member-linked records failed:", e);
  }
  const profile = await upsertProfileFromUserRecord(db, userRecord);
  return { promoted: true, memberId, profile };
}
