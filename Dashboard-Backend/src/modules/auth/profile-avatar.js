import { FieldValue } from "firebase-admin/firestore";
import sharp from "sharp";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { upsertProfileFromUserRecord } from "./profile-sync.js";
import { hasRemovableUploadedProfileImage } from "./profile-image-resolve.js";
import { getPublicUrl, uploadToGCS } from "../../lib/gcs/upload.js";

function isFirebaseStorageUrl(value) {
  try {
    return new URL(value).hostname === "firebasestorage.googleapis.com";
  } catch {
    return false;
  }
}

export const MAX_PROFILE_IMAGE_BYTES = 500 * 1024;

const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export function stripBase64DataUrl(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(s);
  return m ? m[1] : s;
}

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

  const webp = await sharp(buffer)
    .resize({ width: 256, height: 256, fit: "cover" })
    .webp({ quality: 85 })
    .toBuffer();

  const objectPath = `profile-avatars/${uid}/${Date.now()}_avatar.webp`;
  await uploadToGCS(webp, objectPath, "image/webp", true);
  const photoURL = getPublicUrl(objectPath);

  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  await profileRef.set(
    {
      uid,
      photoURL,
      profileImageData: FieldValue.delete(),
      profileImageMimeType: FieldValue.delete(),
      profileImageUpdatedAt: FieldValue.delete(),
      avatarStoragePath: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  try {
    await auth.updateUser(uid, { photoURL });
  } catch {
    /* Auth photo sync is best-effort */
  }

  const userRecord = await auth.getUser(uid);
  return upsertProfileFromUserRecord(db, userRecord);
}

export async function clearProfileAvatar(auth, db, uid) {
  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  const prevSnap = await profileRef.get();
  const prevData = prevSnap.exists ? prevSnap.data() || {} : {};

  if (!hasRemovableUploadedProfileImage(prevData)) {
    throw new Error("No uploaded profile picture to remove.");
  }

  const hadLegacyStorage =
    typeof prevData.avatarStoragePath === "string" && prevData.avatarStoragePath.length > 0;
  const hadGcsAvatar =
    typeof prevData.photoURL === "string" && prevData.photoURL.includes("profile-avatars/");

  const nextPhotoURL = hadGcsAvatar ? null : prevData.photoURL ?? null;
  await profileRef.set(
    {
      uid,
      photoURL: nextPhotoURL,
      profileImageData: FieldValue.delete(),
      profileImageMimeType: FieldValue.delete(),
      profileImageUpdatedAt: FieldValue.delete(),
      avatarStoragePath: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (hadLegacyStorage || hadGcsAvatar) {
    try {
      const userRecord = await auth.getUser(uid);
      const authPhoto = typeof userRecord.photoURL === "string" ? userRecord.photoURL : "";
      // Hostname equality rather than substring: a crafted URL containing
      // "firebasestorage.googleapis.com" in its path or query would otherwise
      // match. Only affects avatar cleanup, but the pattern is wrong.
      if (isFirebaseStorageUrl(authPhoto) || authPhoto.includes("profile-avatars/")) {
        await auth.updateUser(uid, { photoURL: null });
      }
    } catch {
      /* Auth photo cleanup is best-effort */
    }
  }

  const userRecord = await auth.getUser(uid);
  return upsertProfileFromUserRecord(db, userRecord);
}
