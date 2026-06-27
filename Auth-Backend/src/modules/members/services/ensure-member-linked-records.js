import { ensureEntityDiagramForAuthUser, ensureOrganizationEntities } from "../../../bootstrap/entity-bootstrap.js";
import { reconcileMemberNamesFromProfile } from "../../auth/profile-settings.js";
import { dedupeMembersForFirebaseUid } from "./member-dedupe.js";
import { ensureMemberRowForUserRecord } from "./ensure-member-from-auth.js";
import { getMemberPresence } from "./member-presence.service.js";
import { alignMemberRoleTables } from "./relation-sync.js";

async function reconcileMemberNamesSafe(db, uid, memberId) {
  if (!memberId) return;
  try {
    await reconcileMemberNamesFromProfile(db, uid, memberId);
  } catch {
    // Non-fatal: member list may lag profile until next profile save.
  }
}

/**
 * Bootstrap marker on member root — not presence state.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
async function hasBootstrapMarker(db, memberId) {
  const memberSnap = await db.collection("members").doc(memberId).get();
  if (!memberSnap.exists) return false;
  const data = memberSnap.data() || {};
  if (data.profile_linked_records_at) return true;
  const legacy = await getMemberPresence(db, memberId);
  return Boolean(legacy?.profile_linked_records_at);
}

/**
 * Ensures the full entity diagram for an authenticated user:
 * org-wide seeds + member profile rows. One Firebase uid → one members row.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {import("firebase-admin/auth").UserRecord} userRecord
 * @returns {Promise<{memberId: string | null, created: string[], skipped?: string, deduped?: string[]}>}
 */
export async function ensureMemberLinkedRecordsForUserRecord(db, userRecord) {
  const uid = userRecord.uid;

  if (uid) {
    const indexSnap = await db.collection("member_auth_index").doc(uid).get();
    if (indexSnap.exists) {
      const memberId =
        typeof indexSnap.data()?.member_id === "string" ? indexSnap.data().member_id : null;
      if (memberId) {
        const memberDoc = await db.collection("members").doc(memberId).get();
        if (!memberDoc.exists) {
          await db.collection("member_auth_index").doc(uid).delete();
        } else if (await hasBootstrapMarker(db, memberId)) {
          await reconcileMemberNamesSafe(db, uid, memberId);
          return { memberId, created: [], skipped: "already_bootstrapped" };
        }
      }
    }
  }

  const dedupeFirst = await dedupeMembersForFirebaseUid(db, uid);

  const ensuredMember = await ensureMemberRowForUserRecord(db, userRecord);
  const dedupeAfter = await dedupeMembersForFirebaseUid(db, uid);

  let memberId = dedupeAfter.canonicalId ?? dedupeFirst.canonicalId ?? ensuredMember.memberId;
  let memberData = null;

  if (memberId) {
    const memberRef = await db.collection("members").doc(memberId).get();
    if (memberRef.exists) memberData = memberRef.data() || {};
  }

  if (!memberId) {
    await ensureOrganizationEntities(db, uid || "auth-auto-init", { deferMaintenance: true });
    return {
      memberId: null,
      created: [],
      skipped: ensuredMember.skipped || "member_not_found",
      deduped: [...dedupeFirst.removed, ...dedupeAfter.removed],
    };
  }

  const needsBootstrapMarker = !(await hasBootstrapMarker(db, memberId));
  if (needsBootstrapMarker) {
    await db.collection("members").doc(memberId).update({
      profile_linked_records_at: new Date(),
    });
  }

  const { org, member } = await ensureEntityDiagramForAuthUser(db, userRecord, {
    memberId,
    memberData: memberData || {},
  });

  const created = [...org.created, ...member.created];
  const removed = [...new Set([...dedupeFirst.removed, ...dedupeAfter.removed])];

  if (!needsBootstrapMarker && created.length === 0) {
    await alignMemberRoleTables(db, memberId, userRecord.uid || "auth-bootstrap");
    await reconcileMemberNamesSafe(db, uid, memberId);
    return { memberId, created, skipped: "already_bootstrapped", deduped: removed };
  }

  await alignMemberRoleTables(db, memberId, userRecord.uid || "auth-bootstrap");
  await reconcileMemberNamesSafe(db, uid, memberId);

  return { memberId, created, deduped: removed };
}
