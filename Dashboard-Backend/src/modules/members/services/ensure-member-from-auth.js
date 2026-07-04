import crypto from "node:crypto";
import { logSafeWarn } from "../../../http/sanitize-error.js";
import { USER_PROFILES_COLLECTION } from "../../auth/profile-collection-name.js";
import { dedupeMembersForFirebaseUid, ensureMemberAuthIndex } from "./member-dedupe.js";
import { placeholderEmailForUid, resolveEmailFromUserRecord } from "./auth-user-email.js";
import { syncMemberPrimaryRole } from "./relation-sync.js";
import { sanitizeMemberNamePart } from "./member-display-name.js";

const PENDING_AUTH = "pending_auth_members";
const MEMBER_AUTH_INDEX = "member_auth_index";

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 * @param {import("firebase-admin/firestore").DocumentReference} indexRef
 * @param {unknown} error
 */
async function resolveMemberIdAfterCreateRace(db, uid, indexRef, error) {
  const code =
    error && typeof error === "object" && error !== null && "code" in error
      ? String(/** @type {{ code?: unknown }} */ (error).code)
      : "";
  const message = error instanceof Error ? error.message : "";
  const isRace =
    message === "VT_MEMBER_INDEX_EXISTS" ||
    code === "aborted" ||
    code === "10" ||
    code === "already-exists" ||
    code === "6";
  if (!isRace) return null;

  const again = await indexRef.get();
  const existingId = again.data()?.member_id;
  if (typeof existingId === "string" && existingId) {
    return { created: false, memberId: existingId, linked: false };
  }

  const byUid = await db.collection("members").where("firebase_uid", "==", uid).limit(1).get();
  if (!byUid.empty) {
    const memberId = byUid.docs[0].id;
    await ensureMemberAuthIndex(db, uid, memberId);
    return { created: false, memberId, linked: false };
  }

  return null;
}

/**
 * Create a members row on first sign-in if missing. Skips pending_auth_members (pre-provision flow).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {import("firebase-admin/auth").UserRecord} userRecord
 * @returns {Promise<{ created: boolean, memberId: string | null, linked: boolean, skipped?: string }>}
 */
export async function ensureMemberRowForUserRecord(db, userRecord) {
  const uid = userRecord.uid;
  const emailRaw = resolveEmailFromUserRecord(userRecord) || placeholderEmailForUid(uid);
  const email = emailRaw.toLowerCase();

  const pend = await db.collection(PENDING_AUTH).doc(uid).get();
  if (pend.exists) {
    return { created: false, memberId: null, linked: false, skipped: "pending_auth" };
  }

  const dedupe = await dedupeMembersForFirebaseUid(db, uid);
  if (dedupe.canonicalId) {
    return { created: false, memberId: dedupe.canonicalId, linked: false };
  }

  const indexRef = db.collection(MEMBER_AUTH_INDEX).doc(uid);
  const indexSnap = await indexRef.get();
  if (indexSnap.exists && typeof indexSnap.data()?.member_id === "string") {
    const memberId = indexSnap.data().member_id;
    const memberDoc = await db.collection("members").doc(memberId).get();
    if (memberDoc.exists) {
      return { created: false, memberId, linked: false };
    }
  }

  const byUid = await db.collection("members").where("firebase_uid", "==", uid).limit(1).get();
  if (!byUid.empty) {
    const memberId = byUid.docs[0].id;
    await ensureMemberAuthIndex(db, uid, memberId);
    return { created: false, memberId, linked: false };
  }

  let byEmail = await db.collection("members").where("work_email", "==", email).limit(1).get();
  if (byEmail.empty && emailRaw && emailRaw !== email) {
    byEmail = await db.collection("members").where("work_email", "==", emailRaw).limit(1).get();
  }
  if (byEmail.empty) {
    const scan = await db.collection("members").limit(500).get();
    const matched = scan.docs.find((d) => {
      const data = d.data() || {};
      const workEmail = typeof data.work_email === "string" ? data.work_email.trim().toLowerCase() : "";
      return workEmail !== "" && workEmail === email;
    });
    if (matched) {
      byEmail = { empty: false, docs: [matched] };
    }
  }
  if (!byEmail.empty) {
    const d = byEmail.docs[0];
    const data = d.data() || {};
    const existingFid = typeof data.firebase_uid === "string" ? data.firebase_uid : "";
    if (!existingFid) {
      await d.ref.update({ firebase_uid: uid, updated_at: new Date(), updated_by: "auth-verify-link" });
      await ensureMemberAuthIndex(db, uid, d.id);
      return { created: false, memberId: d.id, linked: true };
    }
    if (existingFid === uid) {
      await ensureMemberAuthIndex(db, uid, d.id);
      return { created: false, memberId: d.id, linked: false };
    }
    logSafeWarn("[ensureMemberFromAuth] work_email already linked to another firebase_uid", {
      email,
      memberId: d.id,
    });
    return { created: false, memberId: null, linked: false, skipped: "email_uid_conflict" };
  }

  const profileSnap = await db.collection(USER_PROFILES_COLLECTION).doc(uid).get();
  const profileRow = profileSnap.exists ? profileSnap.data() : null;
  const profileFirst =
    profileRow && typeof profileRow.firstName === "string" ? profileRow.firstName.trim() : "";
  const profileLast =
    profileRow && typeof profileRow.lastName === "string" ? profileRow.lastName.trim() : "";
  const profilePhone =
    profileRow && typeof profileRow.phone === "string" ? profileRow.phone.trim() : "";

  const displayName = typeof userRecord.displayName === "string" ? userRecord.displayName.trim() : "";
  const parts = displayName ? displayName.split(/\s+/).filter(Boolean) : [];

  let firstName = sanitizeMemberNamePart(profileFirst || parts[0] || "", email);
  let lastName = sanitizeMemberNamePart(profileLast || (parts.length > 1 ? parts.slice(1).join(" ") : ""), email);
  if (!firstName) {
    firstName = email.split("@")[0] || "Member";
  }

  const memberId = crypto.randomUUID();
  const memberPayload = {
    id: memberId,
    first_name: firstName,
    last_name: lastName,
    work_email: email,
    personal_email: "",
    employee_id: "",
    ip_address: "",
    ...(profilePhone ? { phone_number: profilePhone } : {}),
    status: "active",
    date_added: new Date(),
    created_by: "auth-sign-in",
    created_by_uid: uid,
    updated_by: "",
    updated_at: new Date(),
    firebase_uid: uid,
    hierarchy_status: "unassigned",
  };

  try {
    await db.runTransaction(async (tx) => {
      const idx = await tx.get(indexRef);
      if (idx.exists && typeof idx.data()?.member_id === "string") {
        throw new Error("VT_MEMBER_INDEX_EXISTS");
      }
      tx.set(indexRef, { member_id: memberId, created_at: new Date() });
      tx.set(db.collection("members").doc(memberId), memberPayload);
    });
  } catch (e) {
    const resolved = await resolveMemberIdAfterCreateRace(db, uid, indexRef, e);
    if (resolved) return resolved;
    throw e;
  }

  await syncMemberPrimaryRole(db, memberId, "Viewer", uid);

  return { created: true, memberId, linked: false };
}
