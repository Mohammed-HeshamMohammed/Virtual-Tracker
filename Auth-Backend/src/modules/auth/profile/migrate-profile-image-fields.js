import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../../../core/database/firebase.js";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";

const MARKER_DOC = "user_profile_image_fields";

/**
 * Idempotently adds empty profile image fields to existing `User_profiles` documents.
 *
 * @returns {Promise<{ success: boolean; alreadyCompleted?: boolean; updated?: number; reason?: string }>}
 */
export async function ensureUserProfileImageFields() {
  const db = getDb();
  if (!db) {
    return { success: false, reason: "db_not_available" };
  }

  const markerRef = db.collection("system_meta").doc(MARKER_DOC);
  const markerSnap = await markerRef.get();
  if (markerSnap.exists && markerSnap.data()?.completed === true) {
    return { success: true, alreadyCompleted: true, updated: 0 };
  }

  const profilesSnap = await db.collection(USER_PROFILES_COLLECTION).get();
  let updated = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of profilesSnap.docs) {
    const data = doc.data() || {};
    const patch = /** @type {Record<string, unknown>} */ ({});
    if (!("profileImageData" in data)) patch.profileImageData = "";
    if (!("profileImageMimeType" in data)) patch.profileImageMimeType = "";
    if (!("profileImageUpdatedAt" in data)) patch.profileImageUpdatedAt = null;
    if (Object.keys(patch).length === 0) continue;

    patch.updatedAt = FieldValue.serverTimestamp();
    batch.set(doc.ref, patch, { merge: true });
    batchCount += 1;
    updated += 1;

    if (batchCount >= 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  await markerRef.set(
    {
      completed: true,
      updatedCount: updated,
      scannedCount: profilesSnap.size,
      completedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  console.info(
    `[user-profile-image-migration] Scanned ${profilesSnap.size} profiles; added missing image fields on ${updated}.`,
  );

  return { success: true, updated };
}
