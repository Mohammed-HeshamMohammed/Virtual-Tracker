import { query, isPostgresConfigured } from "../../lib/postgres/client.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { resolveProfileAvatarUrl } from "./profile-image-resolve.js";

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
