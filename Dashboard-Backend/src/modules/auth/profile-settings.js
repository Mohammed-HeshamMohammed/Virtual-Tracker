import { FieldValue } from "firebase-admin/firestore";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { upsertProfileFromUserRecord } from "./profile-sync.js";
import { resolveMemberDisplayName, sanitizeMemberNamePart, assertValidMemberNamePart } from "../members/services/member-display-name.js";
import { assertValidPhone } from "../../http/validate-body.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { getMemberByIdPg, updateMemberPg } from "../../lib/postgres/members-postgres.service.js";

async function syncMemberEmailForUid(db, uid, email) {
  if (!uid) return;
  await pgQuery(
    "UPDATE members SET work_email = $2, updated_at = now(), updated_by = $1 WHERE firebase_uid = $1",
    [uid, email],
  );
}

export async function syncMemberNamesForUid(db, uid, firstName, lastName) {
  if (!uid) return;
  const trimmedFirst = sanitizeMemberNamePart(typeof firstName === "string" ? firstName : "", "");
  const trimmedLast = sanitizeMemberNamePart(typeof lastName === "string" ? lastName : "", "");
  const first = trimmedFirst || "Member";
  const last = trimmedLast || "";
  const display = `${first} ${last}`.trim();

  await pgQuery(
    "UPDATE members SET first_name = $2, last_name = $3, display_name = $4, updated_at = now(), updated_by = $1 WHERE firebase_uid = $1",
    [uid, first, last, display],
  );
}

export async function syncMemberPhoneForUid(db, uid, phone, options = {}) {
  if (!uid) return;
  const p = typeof phone === "string" ? phone.trim() : "";
  const verified = options.phoneVerified === true ? true : options.phoneVerified === false ? false : null;

  if (verified !== null) {
    await pgQuery(
      "UPDATE members SET phone_number = $2, phone_verified = $3, updated_at = now(), updated_by = $1 WHERE firebase_uid = $1",
      [uid, p, verified],
    );
  } else {
    await pgQuery(
      "UPDATE members SET phone_number = $2, updated_at = now(), updated_by = $1 WHERE firebase_uid = $1",
      [uid, p],
    );
  }
}

export async function syncMemberTimezoneForUid(db, uid, timezone) {
  if (!uid) return;
  await pgQuery(
    "UPDATE members SET timezone = $2, updated_at = now(), updated_by = $1 WHERE firebase_uid = $1",
    [uid, timezone],
  );
}

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

export async function reconcileMemberNamesFromProfile(db, uid, memberId) {
  const profileSnap = await db.collection(USER_PROFILES_COLLECTION).doc(uid).get();
  if (!profileSnap.exists) return;
  const profile = profileSnap.data() || {};
  const profileFirst = sanitizeMemberNamePart(typeof profile.firstName === "string" ? profile.firstName.trim() : "", "");
  const profileLast = sanitizeMemberNamePart(typeof profile.lastName === "string" ? profile.lastName.trim() : "", "");
  if (!profileFirst && !profileLast) return;

  const member = await getMemberByIdPg(memberId);
  if (!member) return;
  const memberFirst = typeof member.first_name === "string" ? member.first_name.trim() : "";
  const memberLast = typeof member.last_name === "string" ? member.last_name.trim() : "";
  if (profileFirst === memberFirst && profileLast === memberLast) return;

  const first = profileFirst || memberFirst || "Member";
  const last = profileLast || memberLast;
  const display = `${first} ${last}`.trim();

  await updateMemberPg(memberId, {
    first_name: first,
    last_name: last,
    display_name: display,
    updated_at: new Date().toISOString(),
    updated_by: uid,
  });
}

export async function patchProfileSettings(auth, db, uid, body) {
  const ref = db.collection(USER_PROFILES_COLLECTION).doc(uid);
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
    // Accept anything Intl can actually resolve, not just what
    // `supportedValuesOf` lists. That list is canonical-only *and*
    // ICU-version-dependent: this runtime reports `Asia/Calcutta` and
    // `Europe/Kiev` while omitting the modern `Asia/Kolkata` / `Europe/Kyiv`
    // that Chromium hands to a browser or WebView2 picker. Membership-testing
    // it therefore rejected the exact ids our own clients offer, so a member
    // in India or Ukraine could not save their timezone at all. Resolvability
    // is the real requirement anyway - it is what every read path already
    // uses (see canonicalizeTimeZone in lib/time/timezone-utils.js, which was
    // written for these same aliases) - and it still rejects genuine junk,
    // which throws a RangeError here.
    if (timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
      } catch {
        throw new Error("Not a recognized timezone.");
      }
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
