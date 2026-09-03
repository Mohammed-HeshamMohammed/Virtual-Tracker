import crypto from "node:crypto";
import { query as pgQuery } from "../../../lib/postgres/client.js";
import { createMemberPg, getMemberByFirebaseUidPg, updateMemberPg } from "../../../lib/postgres/members-postgres.service.js";
import { logSafeWarn } from "../../../http/sanitize-error.js";
import { USER_PROFILES_COLLECTION } from "../../auth/profile-collection-name.js";
import { placeholderEmailForUid, resolveEmailFromUserRecord } from "./auth-user-email.js";
import { syncMemberPrimaryRole } from "./relation-sync.js";
import { sanitizeMemberNamePart } from "./member-display-name.js";

export async function ensureMemberRowForUserRecord(db, userRecord) {
  const uid = userRecord.uid;
  if (!uid) {
    return { created: false, memberId: null, linked: false, skipped: "no_uid" };
  }

  const emailRaw = resolveEmailFromUserRecord(userRecord) || placeholderEmailForUid(uid);
  const email = emailRaw.toLowerCase();

  const pendRows = await pgQuery("SELECT 1 FROM pending_auth_members WHERE firebase_uid = $1 LIMIT 1", [uid]);
  if (pendRows.length) {
    return { created: false, memberId: null, linked: false, skipped: "pending_auth" };
  }

  const existingMember = await getMemberByFirebaseUidPg(uid);
  if (existingMember) {
    return { created: false, memberId: String(existingMember.id), linked: false };
  }

  if (email && email !== placeholderEmailForUid(uid)) {
    const rows = await pgQuery(
      "SELECT * FROM members WHERE LOWER(work_email) = LOWER($1) OR LOWER(personal_email) = LOWER($1) LIMIT 1",
      [email],
    );
    if (rows[0]) {
      const matched = rows[0];
      const memberId = String(matched.id);
      const existingFid = typeof matched.firebase_uid === "string" ? matched.firebase_uid : "";
      if (!existingFid) {
        await updateMemberPg(memberId, { firebase_uid: uid, updated_by: "auth-verify-link" });
        return { created: false, memberId, linked: true };
      }
      if (existingFid === uid) {
        return { created: false, memberId, linked: false };
      }
      logSafeWarn("[ensureMemberFromAuth] work_email already linked to another firebase_uid", {
        email,
        memberId,
      });
      return { created: false, memberId: null, linked: false, skipped: "email_uid_conflict" };
    }
  }

  let profileRow = null;
  try {
    const profileSnap = await db.collection(USER_PROFILES_COLLECTION).doc(uid).get();
    if (profileSnap.exists) profileRow = profileSnap.data();
  } catch {
    /* Optional profile fetch failure non-fatal */
  }

  const profileFirst = profileRow && typeof profileRow.firstName === "string" ? profileRow.firstName.trim() : "";
  const profileLast = profileRow && typeof profileRow.lastName === "string" ? profileRow.lastName.trim() : "";
  const profilePhone = profileRow && typeof profileRow.phone === "string" ? profileRow.phone.trim() : "";

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

  await createMemberPg(memberPayload);
  await syncMemberPrimaryRole(db, memberId, "Viewer", uid);

  return { created: true, memberId, linked: false };
}
