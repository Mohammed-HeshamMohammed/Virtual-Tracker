import { FieldValue } from "firebase-admin/firestore";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { upsertProfileFromUserRecord } from "./profile-sync.js";
import { resolveMemberDisplayName, sanitizeMemberNamePart, assertValidMemberNamePart } from "../members/services/member-display-name.js";
import { assertValidPhone } from "../../http/validate-body.js";

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 * @param {string} email
 */
async function syncMemberEmailForUid(db, uid, email) {
  const snap = await db.collection("members").where("firebase_uid", "==", uid).limit(1).get();
  if (snap.empty) return;
  await snap.docs[0].ref.set(
    {
      work_email: email,
      updated_at: new Date(),
      updated_by: uid,
    },
    { merge: true },
  );
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 * @param {string} firstName
 * @param {string} lastName
 */
export async function syncMemberNamesForUid(db, uid, firstName, lastName) {
  const snap = await db.collection("members").where("firebase_uid", "==", uid).limit(1).get();
  if (snap.empty) return;
  const trimmedFirst = sanitizeMemberNamePart(typeof firstName === "string" ? firstName : "", "");
  const trimmedLast = sanitizeMemberNamePart(typeof lastName === "string" ? lastName : "", "");
  await snap.docs[0].ref.set(
    {
      first_name: trimmedFirst || "Member",
      last_name: trimmedLast,
      updated_at: new Date(),
      updated_by: uid,
    },
    { merge: true },
  );
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 * @param {string} phone
 */
export async function syncMemberPhoneForUid(db, uid, phone, options = {}) {
  const snap = await db.collection("members").where("firebase_uid", "==", uid).limit(1).get();
  if (snap.empty) return;
  /** @type {Record<string, unknown>} */
  const patch = {
    phone_number: typeof phone === "string" ? phone.trim() : "",
    updated_at: new Date(),
    updated_by: uid,
  };
  if (options.phoneVerified === true) {
    patch.phone_verified = true;
  } else if (options.phoneVerified === false) {
    patch.phone_verified = false;
  }
  await snap.docs[0].ref.set(patch, { merge: true });
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 * @param {string} timezone IANA zone id, e.g. "America/Los_Angeles"
 */
export async function syncMemberTimezoneForUid(db, uid, timezone) {
  const snap = await db.collection("members").where("firebase_uid", "==", uid).limit(1).get();
  if (snap.empty) return;
  await snap.docs[0].ref.set(
    {
      timezone,
      updated_at: new Date(),
      updated_by: uid,
    },
    { merge: true },
  );
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 * @param {string} phone
 * @param {{ phoneVerified?: boolean }} [options]
 */
export async function syncUserProfilePhoneForUid(db, uid, phone, options = {}) {
  if (!uid) return;
  const ref = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  await ref.set(
    {
      phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
      phoneVerified: options.phoneVerified === true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Prefer profile first/last over members row when they differ. */
export async function reconcileMemberNamesFromProfile(db, uid, memberId) {
  const profileSnap = await db.collection(USER_PROFILES_COLLECTION).doc(uid).get();
  if (!profileSnap.exists) return;
  const profile = profileSnap.data() || {};
  const profileFirst = sanitizeMemberNamePart(typeof profile.firstName === "string" ? profile.firstName.trim() : "", "");
  const profileLast = sanitizeMemberNamePart(typeof profile.lastName === "string" ? profile.lastName.trim() : "", "");
  if (!profileFirst && !profileLast) return;

  const memberRef = db.collection("members").doc(memberId);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) return;
  const member = memberSnap.data() || {};
  const memberFirst = typeof member.first_name === "string" ? member.first_name.trim() : "";
  const memberLast = typeof member.last_name === "string" ? member.last_name.trim() : "";
  if (profileFirst === memberFirst && profileLast === memberLast) return;

  await memberRef.set(
    {
      first_name: profileFirst || memberFirst || "Member",
      last_name: profileLast || memberLast,
      updated_at: new Date(),
      updated_by: uid,
    },
    { merge: true },
  );
}

/** Merge profile settings + optional Auth displayName update. */
export async function patchProfileSettings(auth, db, uid, body) {
  const ref = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  /** @type {Record<string, unknown>} */
  const patch = {};

  if ("firstName" in body) {
    assertValidMemberNamePart(body.firstName, "First name");
    const trimmed = typeof body.firstName === "string" ? body.firstName.trim() : "";
    patch.firstName = trimmed || null;
  }
  if ("lastName" in body) {
    assertValidMemberNamePart(body.lastName, "Last name");
    const trimmed = typeof body.lastName === "string" ? body.lastName.trim() : "";
    patch.lastName = trimmed || null;
  }
  if ("phone" in body) {
    const phone = await assertValidPhone(body.phone, { required: false, label: "Phone number" });
    patch.phone = phone || null;
    patch.phoneVerified = false;
  }

  if ("timezone" in body) {
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
    if (timezone && !Intl.supportedValuesOf("timeZone").includes(timezone)) {
      throw new Error("Not a recognized timezone.");
    }
    patch.timezone = timezone || null;
  }

  let authEmailPatch = null;
  if ("email" in body) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required.");
    }
    const current = await auth.getUser(uid);
    const currentEmail = typeof current.email === "string" ? current.email.trim().toLowerCase() : "";
    if (email !== currentEmail) {
      try {
        const existing = await auth.getUserByEmail(email);
        if (existing.uid !== uid) {
          throw new Error("This email is already in use by another account.");
        }
      } catch (err) {
        const code = typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
        if (code !== "auth/user-not-found") {
          throw err;
        }
      }
      authEmailPatch = { email, emailVerified: false };
    }
  }

  if (Object.keys(patch).length === 0 && !authEmailPatch) {
    throw new Error("No profile fields to update. Send firstName, lastName, phone, and/or email.");
  }

  if (Object.keys(patch).length > 0) {
    patch.uid = uid;
    patch.updatedAt = FieldValue.serverTimestamp();
    await ref.set(patch, { merge: true });
  }

  if ("firstName" in body || "lastName" in body) {
    const f = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const l = typeof body.lastName === "string" ? body.lastName.trim() : "";
    const snap = await ref.get();
    const cur = snap.exists ? snap.data() : {};
    const mergedFirst = "firstName" in body ? f : typeof cur.firstName === "string" ? cur.firstName : "";
    const mergedLast = "lastName" in body ? l : typeof cur.lastName === "string" ? cur.lastName : "";
    const combined = `${mergedFirst} ${mergedLast}`.trim();
    await auth.updateUser(uid, { displayName: combined.length > 0 ? combined : null });
    await syncMemberNamesForUid(db, uid, mergedFirst, mergedLast);
  }

  if ("phone" in body) {
    const phone = await assertValidPhone(body.phone, { required: false, label: "Phone number" });
    await syncMemberPhoneForUid(db, uid, phone, { phoneVerified: false });
  }

  if ("timezone" in body && typeof body.timezone === "string" && body.timezone.trim()) {
    await syncMemberTimezoneForUid(db, uid, body.timezone.trim());
  }

  if (authEmailPatch) {
    await auth.updateUser(uid, authEmailPatch);
    await syncMemberEmailForUid(db, uid, authEmailPatch.email);
  }

  const userRecord = await auth.getUser(uid);
  return upsertProfileFromUserRecord(db, userRecord);
}
