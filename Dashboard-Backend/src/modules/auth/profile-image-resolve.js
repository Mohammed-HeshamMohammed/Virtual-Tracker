/**
 * Resolves a displayable avatar URL from `User_profiles` fields.
 * Priority: GCS photoURL → legacy embedded base64 → legacy OAuth/Storage photoURL → null.
 *
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown> | null | undefined} doc
 * @returns {string | null}
 */
export function resolveProfileAvatarUrl(doc) {
  if (!doc || typeof doc !== "object") return null;

  const photoURL = typeof doc.photoURL === "string" ? doc.photoURL.trim() : "";
  if (photoURL && (photoURL.startsWith("https://") || photoURL.startsWith("http://"))) {
    return photoURL;
  }

  const data = typeof doc.profileImageData === "string" ? doc.profileImageData.trim() : "";
  const mime = typeof doc.profileImageMimeType === "string" ? doc.profileImageMimeType.trim().toLowerCase() : "";
  if (data && mime.startsWith("image/")) {
    return `data:${mime};base64,${data}`;
  }

  return photoURL || null;
}

/**
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown> | null | undefined} doc
 * @returns {boolean}
 */
export function hasEmbeddedProfileImage(doc) {
  if (!doc || typeof doc !== "object") return false;
  const data = typeof doc.profileImageData === "string" ? doc.profileImageData.trim() : "";
  const mime = typeof doc.profileImageMimeType === "string" ? doc.profileImageMimeType.trim() : "";
  return Boolean(data && mime);
}

/**
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown> | null | undefined} doc
 * @returns {boolean}
 */
export function hasRemovableUploadedProfileImage(doc) {
  if (!doc || typeof doc !== "object") return false;
  if (hasEmbeddedProfileImage(doc)) return true;
  const photoURL = typeof doc.photoURL === "string" ? doc.photoURL : "";
  if (photoURL.includes("profile-avatars/")) return true;
  return typeof doc.avatarStoragePath === "string" && doc.avatarStoragePath.length > 0;
}

/**
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown> | null | undefined} row
 * @returns {Record<string, unknown>}
 */
export function profileImageFieldsFromDoc(row) {
  if (!row || typeof row !== "object") return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  if ("photoURL" in row) {
    const v = row.photoURL;
    out.photoURL = typeof v === "string" ? v : null;
  }
  return out;
}
