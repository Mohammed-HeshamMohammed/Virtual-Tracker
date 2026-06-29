import { getStorageBucketAsync, formatStorageSetupError } from "../../config/firebase.js";
import { getEnv } from "../../config/env.js";

/**
 * Resolves the GCS bucket name — prefers GCS_BUCKET_NAME, falls back to Firebase storage bucket.
 * @returns {string}
 */
export function resolveGcsBucketName() {
  const explicit = getEnv().storage.gcsBucketName;
  if (explicit) return explicit;
  const firebaseBucket = getEnv().firebase.web.storageBucket;
  if (firebaseBucket) return firebaseBucket;
  const projectId = getEnv().firebase.web.projectId;
  return projectId ? `${projectId}.appspot.com` : "";
}

/**
 * Upload a buffer to GCS and return the object path.
 * @param {Buffer} buffer
 * @param {string} objectPath - e.g. 'profile-avatars/uid123/1720000000_avatar.webp'
 * @param {string} contentType - e.g. 'image/webp'
 * @param {boolean} [isPublic=false] - true for avatars, false for screenshots/attachments
 * @returns {Promise<string>} objectPath
 */
export async function uploadToGCS(buffer, objectPath, contentType, isPublic = false) {
  const bucket = await getStorageBucketAsync();
  if (!bucket) {
    throw new Error(formatStorageSetupError("Storage bucket not configured"));
  }
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    metadata: { contentType },
    resumable: false,
  });
  if (isPublic) {
    await file.makePublic();
  }
  return objectPath;
}

/**
 * Generate a signed URL for private objects.
 * @param {string} objectPath
 * @param {number} [expiresInMinutes=15]
 * @returns {Promise<string>}
 */
export async function getSignedUrl(objectPath, expiresInMinutes = 15) {
  const bucket = await getStorageBucketAsync();
  if (!bucket) {
    throw new Error(formatStorageSetupError("Storage bucket not configured"));
  }
  const [url] = await bucket.file(objectPath).getSignedUrl({
    action: "read",
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });
  return url;
}

/**
 * Get the public URL for public objects (avatars).
 * @param {string} objectPath
 * @returns {string}
 */
export function getPublicUrl(objectPath) {
  const bucketName = resolveGcsBucketName();
  if (!bucketName) return objectPath;
  return `https://storage.googleapis.com/${bucketName}/${objectPath}`;
}
