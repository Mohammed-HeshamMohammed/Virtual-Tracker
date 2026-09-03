import { getAuthAdmin } from "../../../config/firebase.js";
import { logSafeError, logSafeWarn } from "../../../http/sanitize-error.js";
import {
  createMemberBanRecord,
  findActiveBanByEmail,
  findActiveBanByFirebaseUid,
  findActiveBanByMemberId,
  getMemberBanRecord,
  isDevicePermanentlyBanned,
  listActiveMemberBans,
  patchMemberBanRecord,
  recordBanIpAndMaybeDeviceBan,
} from "../../../lib/postgres/member-data-store.js";
import { revokeAgentDevicesForMember } from "../../activity/agent-devices.service.js";
import { normalizeMemberEmail } from "./eligibility.js";
import { sendMemberBanEmail } from "./ban-email.js";

const DEVICE_BAN_THRESHOLD = 2;

const BAN_ACCESS_MESSAGE =
  "Your access to Virtual Tracker has been restricted. If you believe this was a mistake, contact support.";
const DEVICE_BAN_MESSAGE =
  "Access from this device has been permanently restricted due to repeated policy violations.";

export { findActiveBanByEmail, findActiveBanByMemberId };

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
    const byUid = await findActiveBanByFirebaseUid(db, input.firebaseUid);
    if (byUid) {
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

export { listActiveMemberBans };

import { getMemberByIdPg, updateMemberPg } from "../../../lib/postgres/members-postgres.service.js";

export async function banMember(db, input) {
  const memberId = typeof input.memberId === "string" ? input.memberId.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!memberId) throw Object.assign(new Error("Member id is required."), { status: 400 });
  if (!reason) throw Object.assign(new Error("A ban reason is required."), { status: 400 });

  const memberData = await getMemberByIdPg(memberId);
  if (!memberData) {
    throw Object.assign(new Error("Member not found."), { status: 404 });
  }
  const existing = await findActiveBanByMemberId(db, memberId);
  if (existing) {
    throw Object.assign(new Error("This member is already banned."), { status: 409 });
  }

  const first = typeof memberData.first_name === "string" ? memberData.first_name.trim() : "";
  const last = typeof memberData.last_name === "string" ? memberData.last_name.trim() : "";
  const memberName =
    (typeof memberData.display_name === "string" && memberData.display_name.trim()) ||
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

  try {
    await revokeAgentDevicesForMember(memberId);
  } catch (err) {
    logSafeWarn("[member-ban] Failed to revoke agent devices:", err);
  }

  const now = new Date();
  const banPayload = {
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
  };
  const { id: banId } = await createMemberBanRecord(db, banPayload);

  const { isPostgresConfigured } = await import("../../../lib/postgres/client.js");
  if (isPostgresConfigured()) {
    const { updateMemberPg, revokeAllMemberSessionsPg } = await import("../../../lib/postgres/members-postgres.service.js");
    await updateMemberPg(memberId, {
      status: "banned",
      updated_at: now.toISOString(),
      updated_by: input.bannedByMemberId || null,
    });
    await revokeAllMemberSessionsPg(memberId).catch(() => {});
  }

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
      await patchMemberBanRecord(db, banId, { email_sent: emailResult.sent === true });
    } catch (err) {
      logSafeWarn("[member-ban] Ban email failed:", err);
    }
  }

  return {
    id: banId,
    memberId,
    memberName,
    email,
    reason,
    ipAddress: memberIp,
    bannedAt: now.toISOString(),
    emailSent: emailResult.sent === true,
  };
}

export async function revokeMemberBan(db, input) {
  const banId = typeof input.banId === "string" ? input.banId.trim() : "";
  if (!banId) throw Object.assign(new Error("Ban id is required."), { status: 400 });

  const banData = await getMemberBanRecord(db, banId);
  if (!banData) throw Object.assign(new Error("Ban record not found."), { status: 404 });
  if (!banData.active) throw Object.assign(new Error("This ban has already been revoked."), { status: 409 });

  const memberId = typeof banData.member_id === "string" ? banData.member_id : "";
  const firebaseUid = typeof banData.firebase_uid === "string" ? banData.firebase_uid : "";
  const now = new Date();

  await patchMemberBanRecord(db, banId, {
    active: false,
    revoked_at: now,
    revoked_by_member_id: input.revokedByMemberId || "",
    revoked_by_name: input.revokedByName || "",
  });

  if (memberId) {
    await updateMemberPg(memberId, {
      status: "active",
      updated_at: now.toISOString(),
      updated_by: input.revokedByMemberId || null,
    });
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
