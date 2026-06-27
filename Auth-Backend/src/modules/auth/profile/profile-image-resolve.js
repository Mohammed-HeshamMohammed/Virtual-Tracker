/**
 * Resolves a displayable avatar URL from `User_profiles` fields.
 * Priority: embedded base64 → legacy `photoURL` (Storage/OAuth) → null.
 *
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown> | null | undefined} doc
 * @returns {string | null}
 */
export function resolveProfileAvatarUrl(doc) {
  if (!doc || typeof doc !== "object") return null;

  const data = typeof doc.profileImageData === "string" ? doc.profileImageData.trim() : "";
  const mime = typeof doc.profileImageMimeType === "string" ? doc.profileImageMimeType.trim().toLowerCase() : "";
  if (data && mime.startsWith("image/")) {
    return `data:${mime};base64,${data}`;
  }

  const photoURL = typeof doc.photoURL === "string" ? doc.photoURL.trim() : "";
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
  return typeof doc.avatarStoragePath === "string" && doc.avatarStoragePath.length > 0;
}

/**
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown> | null | undefined} row
 * @returns {Record<string, unknown>}
 */
export function profileImageFieldsFromDoc(row) {
  if (!row || typeof row !== "object") {
    return {
      profileImageData: "",
      profileImageMimeType: "",
      profileImageUpdatedAt: null,
    };
  }

  /** @type {Record<string, unknown>} */
  const out = {};

  if ("profileImageData" in row) {
    const v = row.profileImageData;
    out.profileImageData = typeof v === "string" ? v : "";
  }
  if ("profileImageMimeType" in row) {
    const v = row.profileImageMimeType;
    out.profileImageMimeType = typeof v === "string" ? v : "";
  }
  if ("profileImageUpdatedAt" in row) {
    const v = row.profileImageUpdatedAt;
    if (v === null) out.profileImageUpdatedAt = null;
    else if (v && typeof v.toDate === "function") out.profileImageUpdatedAt = v.toDate().toISOString();
    else if (typeof v === "string") out.profileImageUpdatedAt = v;
    else if (v instanceof Date) out.profileImageUpdatedAt = v.toISOString();
  }

  return out;
}
