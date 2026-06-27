import { FieldValue } from "firebase-admin/firestore";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { upsertProfileFromUserRecord } from "./profile-sync.js";
import { hasRemovableUploadedProfileImage } from "./profile-image-resolve.js";

/** Maximum decoded image bytes stored in Firestore (500 KB). */
export const MAX_PROFILE_IMAGE_BYTES = 500 * 1024;

/** @type {Map<string, string>} */
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

/**
 * Normalizes client base64 (strips data URL prefix).
 * @param {string} raw
 * @returns {string}
 */
export function stripBase64DataUrl(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(s);
  return m ? m[1] : s;
}

/**
 * Stores avatar bytes in `User_profiles/{uid}` as base64 (no Firebase Storage).
 *
 * @param {import('firebase-admin/auth').Auth} auth
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} uid
 * @param {Buffer} buffer
 * @param {string} contentType
 */
export async function setProfileAvatarFromUpload(auth, db, uid, buffer, contentType) {
  const normalizedType = String(contentType).toLowerCase();
  const ext = ALLOWED_TYPES.get(normalizedType);
  if (!ext) {
    throw new Error("Unsupported image type (use JPEG, PNG, or WebP).");
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Empty image.");
  }
  if (buffer.length > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error("Image too large (max 500 KB). Try a smaller or more compressed photo.");
  }

  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  const base64 = buffer.toString("base64");

  await profileRef.set(
    {
      uid,
      profileImageData: base64,
      profileImageMimeType: normalizedType,
      profileImageUpdatedAt: FieldValue.serverTimestamp(),
      avatarStoragePath: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  void auth;
  const userRecord = await auth.getUser(uid);
  return upsertProfileFromUserRecord(db, userRecord);
}

/**
 * Clears embedded profile image (and legacy Storage metadata). Does not remove OAuth provider photos.
 *
 * @param {import('firebase-admin/auth').Auth} auth
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} uid
 */
export async function clearProfileAvatar(auth, db, uid) {
  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  const prevSnap = await profileRef.get();
  const prevData = prevSnap.exists ? prevSnap.data() || {} : {};

  if (!hasRemovableUploadedProfileImage(prevData)) {
    throw new Error("No uploaded profile picture to remove.");
  }

  const hadLegacyStorage =
    typeof prevData.avatarStoragePath === "string" && prevData.avatarStoragePath.length > 0;

  await profileRef.set(
    {
      uid,
      profileImageData: "",
      profileImageMimeType: "",
      profileImageUpdatedAt: null,
      avatarStoragePath: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (hadLegacyStorage) {
    try {
      const userRecord = await auth.getUser(uid);
      const authPhoto = typeof userRecord.photoURL === "string" ? userRecord.photoURL : "";
      if (authPhoto.includes("firebasestorage.googleapis.com")) {
        await auth.updateUser(uid, { photoURL: null });
      }
    } catch {
      /* Auth photo cleanup is best-effort */
    }
  }

  const userRecord = await auth.getUser(uid);
  return upsertProfileFromUserRecord(db, userRecord);
}
