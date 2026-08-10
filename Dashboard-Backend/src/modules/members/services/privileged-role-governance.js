import { FieldValue } from "firebase-admin/firestore";
import { normalizeRoleKey } from "./relation-sync.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import { banMember, findActiveBanByMemberId } from "./member-ban-service.js";
import { logSafeWarn } from "../../../http/sanitize-error.js";
import { getMemberByIdPg, updateMemberPg } from "../../../lib/postgres/members-postgres.service.js";
import { query as pgQuery } from "../../../lib/postgres/client.js";

export const UNAUTHORIZED_PRIVILEGED_ROLE_REASON =
  "Administrative access (Admin or Super Admin) was not authorized by an Owner.";

const PRIVILEGED_ROLE_KEYS = new Set(["admin", "superadmin"]);

/**
 * @param {string} roleName
 */
export function requiresOwnerGrantedRole(roleName) {
  return PRIVILEGED_ROLE_KEYS.has(normalizeRoleKey(roleName));
}

/**
 * @param {Record<string, unknown> | null | undefined} memberData
 */
export function hasOwnerRoleGrant(memberData) {
  return Boolean(memberData && (memberData.privileged_role_owner_granted === true || memberData.privilegedRoleOwnerGranted === true));
}

/**
 * Track whether Owner signed off on Admin / Super Admin.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 * @param {string} [actorRoleName]
 */
export async function syncPrivilegedRoleOwnerGrant(db, memberId, roleName, actorRoleName = "") {
  if (!memberId) return;
  const roleKey = normalizeRoleKey(roleName);
  if (!PRIVILEGED_ROLE_KEYS.has(roleKey)) {
    await updateMemberPg(memberId, {
      privileged_role_owner_granted: null,
      privileged_role_owner_granted_at: null,
    }).catch(() => null);
    return;
  }

  const actorKey = normalizeRoleKey(actorRoleName);
  if (!actorKey) return;

  const granted = actorKey === "owner";
  await updateMemberPg(memberId, {
    privileged_role_owner_granted: granted,
    privileged_role_owner_granted_at: granted ? new Date().toISOString() : null,
  }).catch(() => null);
}

/**
 * Admin / Super Admin without Owner grant → demote to Viewer and ban.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 * @param {Record<string, unknown> | null | undefined} memberData
 * @param {{ requestIp?: string }} [opts]
 */
export async function enforceUnauthorizedPrivilegedRole(db, memberId, roleName, memberData, opts = {}) {
  if (!memberId || !requiresOwnerGrantedRole(roleName)) {
    return { ok: true };
  }
  if (hasOwnerRoleGrant(memberData)) {
    return { ok: true };
  }

  try {
    const { syncMemberPrimaryRole } = await import("./relation-sync.js");
    await syncMemberPrimaryRole(db, memberId, "Viewer", "system:privilege-governance");
    await syncPrivilegedRoleOwnerGrant(db, memberId, "Viewer", "");

    const existingBan = await findActiveBanByMemberId(db, memberId);
    if (!existingBan) {
      await banMember(db, {
        memberId,
        reason: UNAUTHORIZED_PRIVILEGED_ROLE_REASON,
        bannedByMemberId: "system",
        bannedByName: "System",
        requestIp: typeof opts.requestIp === "string" ? opts.requestIp : "",
      });
    }
  } catch (err) {
    logSafeWarn("[privileged-role-governance] enforcement failed:", err);
  }

  return {
    ok: false,
    status: 403,
    code: "ACCOUNT_BANNED",
    error:
      "Your account had unauthorized administrative access and has been restricted. Contact support if you believe this was a mistake.",
  };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {{ requestIp?: string }} [opts]
 */
export async function enforcePrivilegedRoleGovernanceForMember(db, memberId, opts = {}) {
  if (!memberId) return { ok: true };
  const roleName = await resolveMemberRoleName(db, memberId);
  const memberData = (await getMemberByIdPg(memberId)) || {};
  return enforceUnauthorizedPrivilegedRole(db, memberId, roleName, memberData, opts);
}
