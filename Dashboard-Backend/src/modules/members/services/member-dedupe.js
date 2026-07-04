import { deleteMemberTreeCache } from "../../../lib/postgres/member-data-store.js";
import { deleteMemberProfileData } from "./member-profile.service.js";

const MEMBER_AUTH_INDEX = "member_auth_index";

/** @type {Array<{ collection: string, fields: string[] }>} */
const MEMBER_REFERENCES = [
  { collection: "pay_rates", fields: ["member_id"] },
  { collection: "member_onboarding", fields: ["member_id"] },
  { collection: "team_members", fields: ["member_id"] },
  { collection: "project_members", fields: ["member_id"] },
  { collection: "clients", fields: ["member_id"] },
  { collection: "member_relationships", fields: ["parent_member_id", "child_member_id"] },
  { collection: "client_projects", fields: ["assigned_by"] },
  { collection: "members_field_data", fields: ["memberDocId"] },
  { collection: "activity_sessions", fields: ["member_id"] },
  { collection: "activity_screenshots", fields: ["member_id"] },
  { collection: "activity_app_logs", fields: ["member_id"] },
  { collection: "activity_url_logs", fields: ["member_id"] },
];

function presenceScore(data) {
  const p = data?.presence && typeof data.presence === "object" ? data.presence : null;
  let score = 0;
  if (p?.profile_linked_records_at) score += 20;
  if (p?.last_seen_at) score += 10;
  if (p?.tracking_status) score += 5;
  if (data?.role_id) score += 8;
  if (data?.status === "active") score += 4;
  if (data?.work_email) score += 2;
  return score;
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} firebaseUid
 * @param {string} memberId
 */
export async function ensureMemberAuthIndex(db, firebaseUid, memberId) {
  if (!firebaseUid || !memberId) return;
  await db.collection(MEMBER_AUTH_INDEX).doc(firebaseUid).set(
    { member_id: memberId, updated_at: new Date() },
    { merge: true },
  );
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} fromId
 * @param {string} toId
 */
async function reassignMemberReferences(db, fromId, toId) {
  if (fromId === toId) return;
  for (const { collection, fields } of MEMBER_REFERENCES) {
    for (const field of fields) {
      const snap = await db.collection(collection).where(field, "==", fromId).get();
      if (snap.empty) continue;
      const batch = db.batch();
      for (const doc of snap.docs) batch.update(doc.ref, { [field]: toId });
      await batch.commit();
    }
  }
  await deleteMemberTreeCache(db, fromId);
}

/**
 * One Firebase user → one `members` row. Merges duplicates and sets `member_auth_index`.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} firebaseUid
 * @returns {Promise<{ canonicalId: string | null, removed: string[] }>}
 */
export async function dedupeMembersForFirebaseUid(db, firebaseUid) {
  if (!firebaseUid) return { canonicalId: null, removed: [] };

  const indexSnap = await db.collection(MEMBER_AUTH_INDEX).doc(firebaseUid).get();
  const byUid = await db.collection("members").where("firebase_uid", "==", firebaseUid).get();

  if (byUid.size <= 1) {
    const only = byUid.docs[0];
    const canonicalId = only?.id ?? (indexSnap.exists ? indexSnap.data()?.member_id : null);
    if (canonicalId) await ensureMemberAuthIndex(db, firebaseUid, canonicalId);
    return { canonicalId: canonicalId ?? null, removed: [] };
  }

  const ranked = [...byUid.docs].sort((a, b) => {
    const scoreDiff = presenceScore(b.data()) - presenceScore(a.data());
    if (scoreDiff !== 0) return scoreDiff;
    return timestampMs(b.data()?.date_added) - timestampMs(a.data()?.date_added);
  });

  let canonical = ranked[0];
  if (indexSnap.exists) {
    const indexedId = indexSnap.data()?.member_id;
    const indexedDoc = ranked.find((d) => d.id === indexedId);
    if (indexedDoc) canonical = indexedDoc;
  }

  const removed = [];
  for (const doc of ranked) {
    if (doc.id === canonical.id) continue;
    await reassignMemberReferences(db, doc.id, canonical.id);
    await deleteMemberProfileData(db, doc.id);
    await db.collection("members").doc(doc.id).delete();
    removed.push(doc.id);
  }

  await ensureMemberAuthIndex(db, firebaseUid, canonical.id);
  return { canonicalId: canonical.id, removed };
}
