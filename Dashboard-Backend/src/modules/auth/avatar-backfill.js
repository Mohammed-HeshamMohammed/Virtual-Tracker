import { query, isPostgresConfigured } from "../../lib/postgres/client.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { resolveProfileAvatarUrl } from "./profile-image-resolve.js";

/**
 * One-time-per-member catch-up: upsertProfileFromUserRecord (profile-sync.js)
 * keeps members.avatar_url synced from Firestore User_profiles going forward,
 * but only for a member's own next login - it does nothing retroactively for
 * everyone who already had a photo before that sync existed. Run at boot
 * (like ensure-lookup-schema.js) instead of a one-off script so it's covered
 * by the no-manual-migration-step deploy flow; only queries members still
 * missing avatar_url, so once everyone's caught up (via this or a login)
 * it's a cheap empty read on every future boot.
 * @param {import("firebase-admin/firestore").Firestore} db
 */
export async function backfillMemberAvatarUrls(db) {
  if (!db || !isPostgresConfigured()) return { checked: 0, updated: 0 };

  const members = await query(
    "SELECT id, firebase_uid FROM members WHERE firebase_uid <> '' AND avatar_url IS NULL",
  );
  if (members.length === 0) return { checked: 0, updated: 0 };

  let updated = 0;
  for (const member of members) {
    try {
      const profileSnap = await db.collection(USER_PROFILES_COLLECTION).doc(member.firebase_uid).get();
      if (!profileSnap.exists) continue;
      const avatarUrl = resolveProfileAvatarUrl(profileSnap.data());
      if (!avatarUrl) continue;
      await query("UPDATE members SET avatar_url = $1 WHERE id = $2", [avatarUrl, member.id]);
      updated += 1;
    } catch (err) {
      logSafeWarn(`[avatar-backfill] skipping member ${member.id}:`, err);
    }
  }
  return { checked: members.length, updated };
}
