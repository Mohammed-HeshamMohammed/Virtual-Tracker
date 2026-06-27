import { getAuthAdmin } from "../../../core/database/firebase.js";
import { logSafeError, logSafeWarn } from "../../../core/middleware/http/sanitize-error.js";
import { normalizeMemberEmail } from "./eligibility.js";
import { sendMemberBanEmail } from "./ban-email.js";

const MEMBER_BANS = "member_bans";
const DEVICE_BANS = "device_bans";
const DEVICE_BAN_THRESHOLD = 2;

const BAN_ACCESS_MESSAGE =
  "Your access to Virtual Tracker has been restricted. If you believe this was a mistake, contact support.";
const DEVICE_BAN_MESSAGE =
  "Access from this device has been permanently restricted due to repeated policy violations.";

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} emailNorm
 */
export async function findActiveBanByEmail(db, emailNorm) {
  const e = normalizeMemberEmail(emailNorm);
  if (!e) return null;
  const snap = await db
    .collection(MEMBER_BANS)
    .where("email", "==", e)
    .where("active", "==", true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...(doc.data() || {}) };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function findActiveBanByMemberId(db, memberId) {
  if (!memberId) return null;
  const snap = await db
    .collection(MEMBER_BANS)
    .where("member_id", "==", memberId)
    .where("active", "==", true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...(doc.data() || {}) };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} ip
 */
export async function isDevicePermanentlyBanned(db, ip) {
  const normalized = typeof ip === "string" ? ip.trim() : "";
  if (!normalized || normalized === "unknown") return false;
  const snap = await db.collection(DEVICE_BANS).doc(normalized).get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  return data.permanently_banned === true;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} ip
 */
export async function assertDeviceNotBanned(db, ip) {
  const banned = await isDevicePermanentlyBanned(db, ip);
  if (!banned) return { ok: true };
  return {
    ok: false,
    status: 403,
    code: "DEVICE_BANNED",
    error: DEVICE_BAN_MESSAGE,
  };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ email?: string; memberId?: string; firebaseUid?: string }} input
 */
export async function assertMemberNotBanned(db, input) {
  const emailNorm = normalizeMemberEmail(input.email || "");
  if (emailNorm) {
    const byEmail = await findActiveBanByEmail(db, emailNorm);
    if (byEmail) {
      return {
        ok: false,
        status: 403,
        code: "ACCOUNT_BANNED",
        error: BAN_ACCESS_MESSAGE,
      };
    }
  }
  if (input.memberId) {
    const byMember = await findActiveBanByMemberId(db, input.memberId);
    if (byMember) {
      return {
        ok: false,
        status: 403,
        code: "ACCOUNT_BANNED",
        error: BAN_ACCESS_MESSAGE,
      };
    }
  }
  if (input.firebaseUid) {
    const snap = await db
      .collection(MEMBER_BANS)
      .where("firebase_uid", "==", input.firebaseUid)
      .where("active", "==", true)
      .limit(1)
      .get();
    if (!snap.empty) {
      return {
        ok: false,
        status: 403,
        code: "ACCOUNT_BANNED",
        error: BAN_ACCESS_MESSAGE,
      };
    }
  }
  return { ok: true };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} ip
 * @param {string} memberId
 */
async function recordBanIpAndMaybeDeviceBan(db, ip, memberId) {
  const normalized = typeof ip === "string" ? ip.trim() : "";
  if (!normalized || normalized === "unknown") return;

  const ref = db.collection(DEVICE_BANS).doc(normalized);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() || {} : {};
    const banCount = Number(prev.ban_count || 0) + 1;
    const memberIds = Array.isArray(prev.banned_member_ids) ? [...prev.banned_member_ids] : [];
    if (memberId && !memberIds.includes(memberId)) memberIds.push(memberId);
    const permanentlyBanned = banCount >= DEVICE_BAN_THRESHOLD;
    tx.set(
      ref,
      {
        ip_address: normalized,
        ban_count: banCount,
        banned_member_ids: memberIds,
        permanently_banned: permanentlyBanned || prev.permanently_banned === true,
        ...(permanentlyBanned && !prev.permanently_banned_at
          ? { permanently_banned_at: new Date() }
          : {}),
        updated_at: new Date(),
      },
      { merge: true },
    );
  });
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 */
export async function listActiveMemberBans(db) {
  const snap = await db.collection(MEMBER_BANS).where("active", "==", true).get();
  const rows = snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      memberId: data.member_id || "",
      memberName: data.member_name || "Member",
      email: data.email || "",
      reason: data.reason || "",
      ipAddress: data.ip_address || "",
      bannedAt: data.banned_at?.toDate?.()?.toISOString?.() || null,
      bannedByMemberId: data.banned_by_member_id || "",
      bannedByName: data.banned_by_name || "",
      emailSent: Boolean(data.email_sent),
    };
  });
  rows.sort((a, b) => {
    const ta = a.bannedAt ? Date.parse(a.bannedAt) : 0;
    const tb = b.bannedAt ? Date.parse(b.bannedAt) : 0;
    return tb - ta;
  });
  return rows;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{
 *   memberId: string;
 *   reason: string;
 *   bannedByMemberId: string;
 *   bannedByName: string;
 *   requestIp?: string;
 * }} input
 */
export async function banMember(db, input) {
  const memberId = typeof input.memberId === "string" ? input.memberId.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!memberId) throw Object.assign(new Error("Member id is required."), { status: 400 });
  if (!reason) throw Object.assign(new Error("A ban reason is required."), { status: 400 });

  const memberSnap = await db.collection("members").doc(memberId).get();
  if (!memberSnap.exists) {
    throw Object.assign(new Error("Member not found."), { status: 404 });
  }
  const memberData = memberSnap.data() || {};
  const existing = await findActiveBanByMemberId(db, memberId);
  if (existing) {
    throw Object.assign(new Error("This member is already banned."), { status: 409 });
  }

  const first = typeof memberData.first_name === "string" ? memberData.first_name.trim() : "";
  const last = typeof memberData.last_name === "string" ? memberData.last_name.trim() : "";
  const memberName =
    (typeof memberData.name === "string" && memberData.name.trim()) ||
    [first, last].filter(Boolean).join(" ").trim() ||
    "Member";
  const email =
    normalizeMemberEmail(memberData.work_email || memberData.email || "") ||
    normalizeMemberEmail(memberData.personal_email || "");
  const firebaseUid = typeof memberData.firebase_uid === "string" ? memberData.firebase_uid : "";
  const memberIp =
    typeof memberData.ip_address === "string" && memberData.ip_address.trim()
      ? memberData.ip_address.trim()
      : typeof input.requestIp === "string"
        ? input.requestIp.trim()
        : "";

  const auth = getAuthAdmin();
  if (auth && firebaseUid) {
    try {
      await auth.updateUser(firebaseUid, { disabled: true });
    } catch (err) {
      logSafeWarn("[member-ban] Failed to disable Firebase user:", err);
    }
  }

  const now = new Date();
  const banRef = db.collection(MEMBER_BANS).doc();
  await banRef.set({
    member_id: memberId,
    member_name: memberName,
    email,
    firebase_uid: firebaseUid,
    reason,
    ip_address: memberIp,
    active: true,
    banned_at: now,
    banned_by_member_id: input.bannedByMemberId || "",
    banned_by_name: input.bannedByName || "",
    email_sent: false,
    revoked_at: null,
    revoked_by_member_id: null,
  });

  await db.collection("members").doc(memberId).set(
    {
      status: "banned",
      updated_at: now,
      updated_by: input.bannedByMemberId || null,
    },
    { merge: true },
  );

  if (memberIp) {
    try {
      await recordBanIpAndMaybeDeviceBan(db, memberIp, memberId);
    } catch (err) {
      logSafeError("[member-ban] Failed to record device ban:", err);
    }
  }

  let emailResult = { sent: false, channel: "skipped" };
  if (email) {
    try {
      emailResult = await sendMemberBanEmail({ to: email, memberName, reason });
      await banRef.set({ email_sent: emailResult.sent === true }, { merge: true });
    } catch (err) {
      logSafeWarn("[member-ban] Ban email failed:", err);
    }
  }

  return {
    id: banRef.id,
    memberId,
    memberName,
    email,
    reason,
    ipAddress: memberIp,
    bannedAt: now.toISOString(),
    emailSent: emailResult.sent === true,
  };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ banId: string; revokedByMemberId: string; revokedByName: string }} input
 */
export async function revokeMemberBan(db, input) {
  const banId = typeof input.banId === "string" ? input.banId.trim() : "";
  if (!banId) throw Object.assign(new Error("Ban id is required."), { status: 400 });

  const banSnap = await db.collection(MEMBER_BANS).doc(banId).get();
  if (!banSnap.exists) throw Object.assign(new Error("Ban record not found."), { status: 404 });

  const banData = banSnap.data() || {};
  if (!banData.active) throw Object.assign(new Error("This ban has already been revoked."), { status: 409 });

  const memberId = typeof banData.member_id === "string" ? banData.member_id : "";
  const firebaseUid = typeof banData.firebase_uid === "string" ? banData.firebase_uid : "";
  const now = new Date();

  await banSnap.ref.set(
    {
      active: false,
      revoked_at: now,
      revoked_by_member_id: input.revokedByMemberId || "",
      revoked_by_name: input.revokedByName || "",
    },
    { merge: true },
  );

  if (memberId) {
    await db.collection("members").doc(memberId).set(
      {
        status: "active",
        updated_at: now,
        updated_by: input.revokedByMemberId || null,
      },
      { merge: true },
    );
  }

  const auth = getAuthAdmin();
  if (auth && firebaseUid) {
    try {
      await auth.updateUser(firebaseUid, { disabled: false });
    } catch (err) {
      logSafeWarn("[member-ban] Failed to re-enable Firebase user:", err);
    }
  }

  return {
    id: banId,
    memberId,
    revokedAt: now.toISOString(),
  };
}

export { BAN_ACCESS_MESSAGE, DEVICE_BAN_MESSAGE };
