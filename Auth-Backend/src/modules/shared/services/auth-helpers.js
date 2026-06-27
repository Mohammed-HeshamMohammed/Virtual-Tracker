import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { upsertProfileFromUserRecord } from "../../auth/profile/profile-sync.js";

const PENDING_AUTH = "pending_auth_members";
const USER_PROFILES_COLLECTION = "User_profiles";

export async function syncMemberPrimaryRole(db, memberId, roleName, assignedBy = "") {
  const name = typeof roleName === "string" && roleName.trim() ? roleName.trim() : "Viewer";
  const snap = await db.collection("roles").where("name", "==", name).limit(1).get();
  let roleId;
  if (!snap.empty) {
    roleId = snap.docs[0].id;
  } else {
    roleId = crypto.randomUUID();
    await db.collection("roles").doc(roleId).set({
      id: roleId,
      name,
      description: "",
      created_at: new Date(),
    });
  }
  await db.collection("members").doc(memberId).set(
    {
      role_id: roleId,
      updated_at: new Date(),
      updated_by: assignedBy,
    },
    { merge: true },
  );
  return roleId;
}

export async function promotePendingMemberCore(db, auth, uid) {
  const pendRef = db.collection(PENDING_AUTH).doc(uid);
  const pendSnap = await pendRef.get();
  if (!pendSnap.exists) {
    const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
    await profileRef.set({ must_change_password: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const userRecord = await auth.getUser(uid);
    return { promoted: false, profile: await upsertProfileFromUserRecord(db, userRecord) };
  }
  const p = pendSnap.data() || {};
  const email = typeof p.email === "string" ? p.email : "";
  const displayName = typeof p.display_name === "string" ? p.display_name : "";
  const pendingPhone = typeof p.phone_number === "string" ? p.phone_number.trim() : "";
  const [firstName, ...rest] = displayName.split(/\s+/).filter(Boolean);
  const lastName = rest.join(" ");
  const memberId = crypto.randomUUID();
  const memberPayload = {
    id: memberId,
    first_name: firstName || "Member",
    last_name: lastName,
    work_email: email,
    personal_email: "",
    employee_id: "",
    ip_address: "",
    ...(pendingPhone ? { phone_number: pendingPhone, phone_verified: false } : {}),
    status: "active",
    date_added: new Date(),
    created_by: "invite-preprovision",
    created_by_uid: typeof p.created_by_uid === "string" ? p.created_by_uid : "",
    updated_by: "",
    updated_at: new Date(),
    firebase_uid: uid,
  };
  let roleName = "Viewer";
  if (typeof p.role_id === "string" && p.role_id) {
    const roleDoc = await db.collection("roles").doc(p.role_id).get();
    if (roleDoc.exists && typeof roleDoc.data()?.name === "string" && roleDoc.data().name.trim()) {
      roleName = roleDoc.data().name.trim();
    }
  } else if (typeof p.role_name === "string" && p.role_name) {
    roleName = p.role_name;
  }

  await db.collection("members").doc(memberId).set(memberPayload);
  await syncMemberPrimaryRole(db, memberId, roleName, typeof p.created_by_uid === "string" ? p.created_by_uid : "");

  await pendRef.delete();
  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  await profileRef.set({ must_change_password: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const userRecord = await auth.getUser(uid);
  const profile = await upsertProfileFromUserRecord(db, userRecord);
  
  await db.collection("member_auth_index").doc(uid).set({
    member_id: memberId,
    updated_at: new Date(),
  });

  return { promoted: true, memberId, profile };
}

export async function ensureMemberLinkedRecordsForUserRecord(db, userRecord) {
  const uid = userRecord.uid;
  const email = (userRecord.email || "").trim().toLowerCase();

  const indexSnap = await db.collection("member_auth_index").doc(uid).get();
  if (indexSnap.exists) {
    const memberId = indexSnap.data()?.member_id;
    if (memberId) {
      const memberDoc = await db.collection("members").doc(memberId).get();
      if (memberDoc.exists) {
        return { memberId, created: [] };
      }
      await db.collection("member_auth_index").doc(uid).delete();
    }
  }

  const byUid = await db.collection("members").where("firebase_uid", "==", uid).limit(1).get();
  if (!byUid.empty) {
    const memberId = byUid.docs[0].id;
    await db.collection("member_auth_index").doc(uid).set({ member_id: memberId, updated_at: new Date() });
    return { memberId, created: [] };
  }

  if (email) {
    const byEmail = await db.collection("members").where("work_email", "==", email).limit(1).get();
    if (!byEmail.empty) {
      const doc = byEmail.docs[0];
      await doc.ref.update({ firebase_uid: uid, updated_at: new Date() });
      await db.collection("member_auth_index").doc(uid).set({ member_id: doc.id, updated_at: new Date() });
      return { memberId: doc.id, created: [] };
    }
  }

  const memberId = crypto.randomUUID();
  const displayName = typeof userRecord.displayName === "string" ? userRecord.displayName.trim() : "";
  const [first, ...rest] = displayName.split(/\s+/).filter(Boolean);
  const last = rest.join(" ");

  const memberPayload = {
    id: memberId,
    first_name: first || "Member",
    last_name: last || "",
    work_email: email || `noemail+${uid}@users.virtual-tracker.local`,
    status: "active",
    date_added: new Date(),
    created_by: "auth-sign-in",
    created_by_uid: uid,
    updated_at: new Date(),
    firebase_uid: uid,
  };

  await db.collection("members").doc(memberId).set(memberPayload);
  await db.collection("member_auth_index").doc(uid).set({ member_id: memberId, created_at: new Date() });
  await syncMemberPrimaryRole(db, memberId, "Viewer", "auth-bootstrap");

  return { memberId, created: [memberId] };
}

export async function resolveMemberRoleName(db, memberId) {
  if (!memberId) return "Viewer";
  const memberSnap = await db.collection("members").doc(memberId).get();
  if (!memberSnap.exists) return "Viewer";
  const roleId = memberSnap.data()?.role_id;
  if (!roleId) return "Viewer";
  const roleSnap = await db.collection("roles").doc(roleId).get();
  if (!roleSnap.exists) return "Viewer";
  return roleSnap.data()?.name || "Viewer";
}

export async function alignMemberRoleTables(db, memberId) {
  return null;
}

export async function enforcePrivilegedRoleGovernanceForMember(db, memberId, opts = {}) {
  return { ok: true };
}

export async function enforceUnauthorizedPrivilegedRole(db, memberId, roleName, memberData, opts = {}) {
  return { ok: true };
}

export function checkHierarchyAccess(memberData, pathname, method = "GET") {
  return { blocked: false };
}

export function normalizeMemberEmail(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

export async function assertDeviceNotBanned(db, ip) {
  const normalized = typeof ip === "string" ? ip.trim() : "";
  if (!normalized || normalized === "unknown") return { ok: true };
  const snap = await db.collection("device_bans").doc(normalized).get();
  if (snap.exists && snap.data()?.permanently_banned === true) {
    return {
      ok: false,
      status: 403,
      code: "DEVICE_BANNED",
      error: "Access from this device has been permanently restricted due to repeated policy violations.",
    };
  }
  return { ok: true };
}

export async function assertMemberNotBanned(db, input) {
  const emailNorm = normalizeMemberEmail(input.email || "");
  if (emailNorm) {
    const snap = await db.collection("member_bans").where("email", "==", emailNorm).where("active", "==", true).limit(1).get();
    if (!snap.empty) {
      return {
        ok: false,
        status: 403,
        code: "ACCOUNT_BANNED",
        error: "Your access to Virtual Tracker has been restricted. If you believe this was a mistake, contact support.",
      };
    }
  }
  if (input.memberId) {
    const snap = await db.collection("member_bans").where("member_id", "==", input.memberId).where("active", "==", true).limit(1).get();
    if (!snap.empty) {
      return {
        ok: false,
        status: 403,
        code: "ACCOUNT_BANNED",
        error: "Your access to Virtual Tracker has been restricted. If you believe this was a mistake, contact support.",
      };
    }
  }
  return { ok: true };
}

export async function assertEmailCanUseMemberInviteOrPreprovision(db, auth, emailNorm, opts = {}) {
  const e = normalizeMemberEmail(emailNorm);
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { ok: false, reason: "invalid_email", message: "That email address is not valid." };
  }
  const banGate = await assertMemberNotBanned(db, { email: e });
  if (!banGate.ok) {
    return { ok: false, reason: "account_banned", message: banGate.error };
  }
  try {
    await auth.getUserByEmail(e);
    return { ok: false, reason: "auth_exists", message: "This email is already registered." };
  } catch (err) {
    // Continue
  }
  const memberSnap = await db.collection("members").where("work_email", "==", e).limit(1).get();
  if (!memberSnap.empty) {
    return { ok: false, reason: "member_exists", message: "This email is already listed as a member." };
  }
  return { ok: true, reason: "", message: "" };
}

export async function validateEmailsForAddMembersFlow(db, auth, rawEmails, opts = {}) {
  const unique = new Map();
  for (const r of Array.isArray(rawEmails) ? rawEmails : []) {
    const n = normalizeMemberEmail(r);
    if (n) unique.set(n, n);
  }
  const results = [];
  let allOk = true;
  for (const email of unique.keys()) {
    const res = await assertEmailCanUseMemberInviteOrPreprovision(db, auth, email, opts);
    if (!res.ok) allOk = false;
    results.push({ email, ok: res.ok, reason: res.reason, message: res.message });
  }
  return { allOk, results };
}

export function resolveInviteExpiryMs(row) {
  if (!row || typeof row !== "object") return null;
  const exp = row.expires_at ?? row.expiresAt;
  if (exp instanceof Date) return exp.getTime();
  if (exp && typeof exp === "object" && typeof exp.toDate === "function") return exp.toDate().getTime();
  return null;
}

export function isInviteExpired(row, nowMs = Date.now()) {
  const ms = resolveInviteExpiryMs(row);
  if (ms == null) return false;
  return nowMs >= ms;
}

export function isInviteConsumed(row) {
  if (!row || typeof row !== "object") return true;
  const status = typeof row.status === "string" ? row.status : "";
  if (status === "completed" || status === "accepted") return true;
  return false;
}

export function assertInviteAvailableForRegistration(row) {
  const status = typeof row.status === "string" ? row.status : "";
  if (status !== "pending_signup") {
    return { ok: false, error: "This invite is no longer valid.", httpStatus: 410 };
  }
  if (isInviteExpired(row)) {
    return { ok: false, error: "This invite link has expired.", httpStatus: 410 };
  }
  if (isInviteConsumed(row)) {
    return { ok: false, error: "This invite link has already been used.", httpStatus: 410 };
  }
  return { ok: true };
}

export function shareLinkInviteFields() {
  return {
    max_uses: 1,
    use_count: 0,
    expires_at: new Date(Date.now() + 168 * 60 * 60 * 1000), // 7 days default
  };
}

export function resolveAppPublicUrl(appOrigin = "") {
  if (typeof appOrigin === "string" && appOrigin.startsWith("http")) {
    return appOrigin.endsWith("/") ? appOrigin : `${appOrigin}/`;
  }
  return "http://localhost:3000/";
}

export async function deleteMemberProfileData(db, memberId) {
  return true;
}
