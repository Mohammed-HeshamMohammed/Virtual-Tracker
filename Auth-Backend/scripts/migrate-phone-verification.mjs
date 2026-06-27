/**
 * Align Firestore member/profile phone verification fields with self-verify policy.
 *
 * - Members with a phone but no proof of self-verification → phone_verified: false
 * - Keeps phone_verified: true only when linked User_profiles has phoneVerified: true and matching phone
 * - Clears stale phone_verification_challenges / phone_verification_tokens
 *
 * Usage:
 *   npm run migrate:phone-verification -- --dry-run
 *   npm run migrate:phone-verification
 */

import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../src/config/firebase.js";
import { USER_PROFILES_COLLECTION } from "../src/modules/auth/profile-collection-name.js";
import { phonesMatch } from "../src/modules/auth/phone-verification.service.js";

const BATCH_LIMIT = 400;
const CHALLENGE_COLLECTION = "phone_verification_challenges";
const TOKEN_COLLECTION = "phone_verification_tokens";

function hasDryRunFlag() {
  return process.argv.includes("--dry-run");
}

function memberPhone(data) {
  if (!data || typeof data !== "object") return "";
  return (
    (typeof data.phone_number === "string" ? data.phone_number : "") ||
    (typeof data.mobile === "string" ? data.mobile : "") ||
    (typeof data.phone === "string" ? data.phone : "")
  ).trim();
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} firebaseUid
 */
async function loadProfilePhoneState(db, firebaseUid) {
  if (!firebaseUid) return { phone: "", verified: false, hasVerifiedField: false };
  const snap = await db.collection(USER_PROFILES_COLLECTION).doc(firebaseUid).get();
  if (!snap.exists) return { phone: "", verified: false, hasVerifiedField: false };
  const row = snap.data() || {};
  const phone = typeof row.phone === "string" ? row.phone.trim() : "";
  return {
    phone,
    verified: row.phoneVerified === true,
    hasVerifiedField: Object.prototype.hasOwnProperty.call(row, "phoneVerified"),
  };
}

async function migrateMembers(db, dryRun) {
  const snap = await db.collection("members").get();
  let scanned = 0;
  let membersUpdated = 0;
  let profilesUpdated = 0;
  let verifiedKept = 0;
  let verifiedReset = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    scanned += 1;
    const data = doc.data() || {};
    const phone = memberPhone(data);
    const firebaseUid = typeof data.firebase_uid === "string" ? data.firebase_uid.trim() : "";
    const currentVerified = data.phone_verified === true;
    const profile = await loadProfilePhoneState(db, firebaseUid);

    let nextVerified = false;
    if (phone) {
      const profileProof =
        profile.verified && profile.phone && phonesMatch(profile.phone, phone);
      nextVerified = profileProof;
    }

    const memberPatch = {};
    if (!phone) {
      if (!("phone_verified" in data) || currentVerified) {
        memberPatch.phone_verified = false;
      }
    } else if (currentVerified !== nextVerified || !("phone_verified" in data)) {
      memberPatch.phone_verified = nextVerified;
    }

    const profileRef = firebaseUid ? db.collection(USER_PROFILES_COLLECTION).doc(firebaseUid) : null;
    const profilePatch = {};
    if (profileRef) {
      if (phone && profile.phone !== phone) profilePatch.phone = phone;
      if (phone) {
        if (profile.verified !== nextVerified || !profile.hasVerifiedField) {
          profilePatch.phoneVerified = nextVerified;
        }
      } else if (!profile.hasVerifiedField || profile.verified) {
        profilePatch.phoneVerified = false;
      }
      if (Object.keys(profilePatch).length > 0) {
        profilePatch.updatedAt = FieldValue.serverTimestamp();
      }
    }

    if (Object.keys(memberPatch).length === 0 && Object.keys(profilePatch).length === 0) {
      if (nextVerified) verifiedKept += 1;
      continue;
    }

    if (memberPatch.phone_verified === true) verifiedKept += 1;
    if (currentVerified && memberPatch.phone_verified === false) verifiedReset += 1;

    if (Object.keys(memberPatch).length > 0) membersUpdated += 1;
    if (Object.keys(profilePatch).length > 0) profilesUpdated += 1;

    if (dryRun) continue;

    if (Object.keys(memberPatch).length > 0) {
      batch.update(doc.ref, memberPatch);
      batchCount += 1;
    }
    if (profileRef && Object.keys(profilePatch).length > 0) {
      batch.set(profileRef, profilePatch, { merge: true });
      batchCount += 1;
    }

    if (batchCount >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (!dryRun && batchCount > 0) {
    await batch.commit();
  }

  return { scanned, membersUpdated, profilesUpdated, verifiedKept, verifiedReset };
}

async function clearEphemeralVerificationCollections(db, dryRun) {
  /** @type {Record<string, number>} */
  const cleared = { challenges: 0, tokens: 0 };

  for (const [key, collection] of [
    ["challenges", CHALLENGE_COLLECTION],
    ["tokens", TOKEN_COLLECTION],
  ]) {
    const snap = await db.collection(collection).get();
    if (snap.empty) continue;

    let batch = db.batch();
    let batchCount = 0;
    for (const doc of snap.docs) {
      cleared[key] += 1;
      if (dryRun) continue;
      batch.delete(doc.ref);
      batchCount += 1;
      if (batchCount >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }
    if (!dryRun && batchCount > 0) {
      await batch.commit();
    }
  }

  return cleared;
}

async function main() {
  const dryRun = hasDryRunFlag();
  const db = getDb();
  if (!db) {
    console.error(
      "Firebase Admin is not configured. Add firebase-admin.local.json or service account env vars in Backend/.env.",
    );
    process.exit(1);
  }

  const members = await migrateMembers(db, dryRun);
  const ephemeral = await clearEphemeralVerificationCollections(db, dryRun);

  console.info(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        members,
        ephemeral,
        note: dryRun
          ? "Re-run without --dry-run to apply changes."
          : "Migration applied.",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
