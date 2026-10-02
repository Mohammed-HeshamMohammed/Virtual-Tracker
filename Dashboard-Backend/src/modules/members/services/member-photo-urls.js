import { USER_PROFILES_COLLECTION } from "../../auth/profile-collection-name.js";
import { resolveProfileAvatarUrl } from "../../auth/profile-image-resolve.js";

// Pickers list up to a few hundred people at once, and an uploaded avatar can
// be stored inline as a base64 data URL. Past this size a photo is left out and
// the picker shows initials instead, rather than bloating every list response.
const MAX_INLINE_PHOTO_CHARS = 60_000;

/**
 * Profile photos for a set of member rows, keyed by member id. Rows without a
 * firebase uid, a profile document or a usable photo are simply absent.
 */
export async function loadMemberPhotoUrls(db, members) {
  const uidByMemberId = new Map();
  for (const m of members) {
    if (typeof m?.firebase_uid === "string" && m.firebase_uid) uidByMemberId.set(String(m.id), m.firebase_uid);
  }
  const photoByUid = new Map();
  const uids = [...new Set(uidByMemberId.values())];
  if (uids.length > 0) {
    const snaps = await db.getAll(...uids.map((uid) => db.collection(USER_PROFILES_COLLECTION).doc(uid)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const url = resolveProfileAvatarUrl(snap.data());
      if (url && url.length <= MAX_INLINE_PHOTO_CHARS) photoByUid.set(snap.id, url);
    }
  }
  const out = new Map();
  for (const m of members) {
    const direct = [m?.photo_url, m?.photoURL, m?.avatar_url].find((v) => typeof v === "string" && v.trim());
    const url = photoByUid.get(uidByMemberId.get(String(m.id))) || (direct && direct.length <= MAX_INLINE_PHOTO_CHARS ? direct.trim() : "");
    if (url) out.set(String(m.id), url);
  }
  return out;
}
