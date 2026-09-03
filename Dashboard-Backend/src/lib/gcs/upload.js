import { getStorageBucketAsync, formatStorageSetupError } from "../../config/firebase.js";
import { getEnv } from "../../config/env.js";

export function resolveGcsBucketName() {
  const explicit = getEnv().storage.gcsBucketName;
  if (explicit) return explicit;
  const firebaseBucket = getEnv().firebase.web.storageBucket;
  if (firebaseBucket) return firebaseBucket;
  const projectId = getEnv().firebase.web.projectId;
  return projectId ? `${projectId}.appspot.com` : "";
}

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

export async function deleteFromGCS(objectPath) {
  const bucket = await getStorageBucketAsync();
  if (!bucket) {
    throw new Error(formatStorageSetupError("Storage bucket not configured"));
  }
  try {
    await bucket.file(objectPath).delete();
  } catch (err) {
    if (/** @type {{code?: number}} */ (err)?.code !== 404) throw err;
  }
}

export function getPublicUrl(objectPath) {
  const bucketName = resolveGcsBucketName();
  if (!bucketName) return objectPath;
  return `https://storage.googleapis.com/${bucketName}/${objectPath}`;
}
