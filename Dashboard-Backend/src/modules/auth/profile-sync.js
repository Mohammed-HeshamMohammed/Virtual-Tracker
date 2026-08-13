import { FieldValue } from "firebase-admin/firestore";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import {
  profileImageFieldsFromDoc,
  resolveProfileAvatarUrl,
} from "./profile-image-resolve.js";
import { isPostgresConfigured } from "../../lib/postgres/client.js";
import { resolveMemberIdForFirebaseUidPg, updateMemberPg } from "../../lib/postgres/members-postgres.service.js";

/**
 * User_profiles payload from Auth user record.
 * @param {import('firebase-admin/auth').UserRecord} userRecord
 * @returns {object}
 */
export function buildProfilePayload(userRecord) {
  const providerData = Array.isArray(userRecord.providerData) ? userRecord.providerData : [];
  const providers = [...new Set(providerData.map((p) => p.providerId).filter(Boolean))];
  const identities = providerData.map((p) => ({
    provider: p.providerId,
    /** Email, phone, or provider-specific id string shown in Firebase Auth “Identifier” column when applicable */
    identifier: p.email || p.phoneNumber || p.uid || null,
    federatedUid: p.uid || null,
    displayName: p.displayName || null,
    photoURL: p.photoURL || null,
  }));

  return {
    uid: userRecord.uid,
    primaryEmail: userRecord.email || null,
    emailVerified: Boolean(userRecord.emailVerified),
    displayName: userRecord.displayName || null,
    photoURL: userRecord.photoURL || null,
    phoneNumber: userRecord.phoneNumber || null,
    disabled: Boolean(userRecord.disabled),
    providers,
    identities,
    authCreationTime: userRecord.metadata?.creationTime || null,
    authLastSignInTime: userRecord.metadata?.lastSignInTime || null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/** Merge User_profiles/{uid}; set createdAt on first write. */
export async function upsertProfileFromUserRecord(db, userRecord) {
  const ref = db.collection(USER_PROFILES_COLLECTION).doc(userRecord.uid);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : null;
  const payload = buildProfilePayload(userRecord);
  if (existing?.photoURL && String(existing.photoURL).includes("profile-avatars/")) {
    payload.photoURL = existing.photoURL;
  }
  if (!snap.exists) {
    payload.createdAt = FieldValue.serverTimestamp();
  }
  await ref.set(payload, { merge: true });

  const merged = await ref.get();
  const row = merged.exists ? merged.data() : null;
  const resolvedPhoto = resolveProfileAvatarUrl(row) || userRecord.photoURL || null;

  // Members list/table reads avatar_url from Postgres, not this Firestore
  // doc - every login/profile flow routes through here, so this is the one
  // place that keeps it in sync instead of patching each caller.
  if (isPostgresConfigured()) {
    const memberId = await resolveMemberIdForFirebaseUidPg(userRecord.uid);
    if (memberId) await updateMemberPg(memberId, { avatar_url: resolvedPhoto }).catch(() => {});
  }

  return {
    uid: userRecord.uid,
    primaryEmail: userRecord.email || null,
    emailVerified: Boolean(userRecord.emailVerified),
    displayName: userRecord.displayName || null,
    photoURL: resolvedPhoto,
    phoneNumber: userRecord.phoneNumber || null,
    disabled: Boolean(userRecord.disabled),
    providers: payload.providers,
    identities: payload.identities,
    authCreationTime: payload.authCreationTime,
    authLastSignInTime: payload.authLastSignInTime,
    ...profileAppFieldsFromDoc(row),
    ...profileImageFieldsFromDoc(row),
  };
}

/** App-specific User_profiles fields (not from Auth). */
export function profileAppFieldsFromDoc(row) {
  if (!row || typeof row !== "object") return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  if ("firstName" in row) {
    const v = row.firstName;
    out.firstName = v === null ? null : typeof v === "string" ? v : null;
  }
  if ("lastName" in row) {
    const v = row.lastName;
    out.lastName = v === null ? null : typeof v === "string" ? v : null;
  }
  if ("payRateUsdPerHour" in row) {
    const v = row.payRateUsdPerHour;
    if (v === null) out.payRateUsdPerHour = null;
    else if (typeof v === "number" && !Number.isNaN(v)) out.payRateUsdPerHour = v;
  }
  if ("twoFactorEnabled" in row && typeof row.twoFactorEnabled === "boolean") {
    out.twoFactorEnabled = row.twoFactorEnabled;
  }
  if ("must_change_password" in row && typeof row.must_change_password === "boolean") {
    out.must_change_password = row.must_change_password;
    out.mustChangePassword = row.must_change_password;
  } else if ("mustChangePassword" in row && typeof row.mustChangePassword === "boolean") {
    out.mustChangePassword = row.mustChangePassword;
    out.must_change_password = row.mustChangePassword;
  }
  if ("first_login" in row && typeof row.first_login === "boolean") {
    out.first_login = row.first_login;
    out.firstLogin = row.first_login;
  } else   if ("firstLogin" in row && typeof row.firstLogin === "boolean") {
    out.firstLogin = row.firstLogin;
    out.first_login = row.firstLogin;
  }
  if ("phone" in row) {
    const v = row.phone;
    out.phone = v === null ? null : typeof v === "string" ? v : null;
  }
  if ("phoneVerified" in row && typeof row.phoneVerified === "boolean") {
    out.phoneVerified = row.phoneVerified;
  }
  if ("timezone" in row) {
    const v = row.timezone;
    out.timezone = v === null ? null : typeof v === "string" ? v : null;
  }
  return out;
}
