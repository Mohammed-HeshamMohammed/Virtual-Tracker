import {
  extractPresenceFields,
  flattenPresenceForApi,
  resolveEffectivePresence,
} from "./presence-status.js";

const AUTH_INDEX = "member_auth_index";

/**
 * Fast member lookup for authenticated Firebase uid (no dedupe scan).
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} firebaseUid
 */
export async function resolveMemberIdForUid(db, firebaseUid) {
  if (!firebaseUid) return "";
  const indexSnap = await db.collection(AUTH_INDEX).doc(firebaseUid).get();
  const indexed = indexSnap.exists && typeof indexSnap.data()?.member_id === "string" ? indexSnap.data().member_id : "";
  if (indexed) return indexed;
  const snap = await db.collection("members").where("firebase_uid", "==", firebaseUid).limit(1).get();
  return snap.empty ? "" : snap.docs[0].id;
}

/**
 * Reads persisted disconnect marker only (`last_seen_at`). Live status comes from runtime store.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function getMemberPresence(db, memberId) {
  const memberSnap = await db.collection("members").doc(memberId).get();
  if (!memberSnap.exists) return null;
  const fields = extractPresenceFields(memberSnap.data() || {});
  return fields.last_seen_at || fields.profile_linked_records_at ? fields : null;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} _db
 * @param {string} memberId
 * @param {Record<string, unknown>} memberData
 */
export async function enrichMemberWithPresence(_db, memberId, memberData) {
  const { getPresenceService } = await import("../../presence/index.js");
  const runtime = getPresenceService().getPresence(memberId);
  return { ...memberData, ...flattenPresenceForApi(memberData, runtime) };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} _db
 * @param {Array<{ id: string } & Record<string, unknown>>} members
 */
export async function enrichMembersWithPresenceBatch(_db, members) {
  if (!members.length) return members;
  const { getPresenceService } = await import("../../presence/index.js");
  const presenceService = getPresenceService();
  const ids = members.map((member) => member.id);
  const presenceMap = await presenceService.getPresenceMany(ids);
  return members.map((member) => ({
    ...member,
    ...flattenPresenceForApi(member, presenceMap.get(member.id) ?? null),
  }));
}

/**
 * Management override — updates ephemeral runtime only (no database writes).
 *
 * @param {import("firebase-admin/firestore").Firestore} _db
 * @param {string} memberId
 * @param {{ tracking_status?: string }} patch
 */
export async function patchMemberPresence(_db, memberId, patch) {
  const { getPresenceService } = await import("../../presence/index.js");
  const presenceService = getPresenceService();
  const status = typeof patch.tracking_status === "string" ? patch.tracking_status.trim().toLowerCase() : "";
  if (status === "online") presenceService.markOnline(memberId);
  else if (status === "idle") presenceService.markIdle(memberId);
  else presenceService.markOffline(memberId);
  const runtime = presenceService.getPresence(memberId);
  return { applied: true, presence: resolveEffectivePresence(runtime, {}) };
}
