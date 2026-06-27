import { FieldValue } from "firebase-admin/firestore";
import { normalizeRoleKey } from "./relation-sync.js";
import { resolveMemberRoleName } from "./activity-scope.js";
import { banMember, findActiveBanByMemberId } from "./member-ban-service.js";
import { logSafeWarn } from "../../../core/middleware/http/sanitize-error.js";

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
  return Boolean(memberData && memberData.privileged_role_owner_granted === true);
}

/**
 * Persist whether an Owner explicitly granted Admin / Super Admin.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 * @param {string} [actorRoleName]
 */
export async function syncPrivilegedRoleOwnerGrant(db, memberId, roleName, actorRoleName = "") {
  if (!memberId) return;
  const roleKey = normalizeRoleKey(roleName);
  if (!PRIVILEGED_ROLE_KEYS.has(roleKey)) {
    await db.collection("members").doc(memberId).set(
      {
        privileged_role_owner_granted: FieldValue.delete(),
        privileged_role_owner_granted_at: FieldValue.delete(),
      },
      { merge: true },
    );
    return;
  }

  // Role alignment / login bootstrap calls syncMemberPrimaryRole without actor context.
  // Do not clear an Owner-granted flag that was set during an explicit role change.
  const actorKey = normalizeRoleKey(actorRoleName);
  if (!actorKey) return;

  const granted = actorKey === "owner";
  await db.collection("members").doc(memberId).set(
    {
      privileged_role_owner_granted: granted,
      privileged_role_owner_granted_at: granted ? new Date() : FieldValue.delete(),
    },
    { merge: true },
  );
}

/**
 * Admin / Super Admin without Owner grant → demote to Viewer and ban.
 *
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
  const memberSnap = await db.collection("members").doc(memberId).get();
  const memberData = memberSnap.exists ? memberSnap.data() || {} : {};
  return enforceUnauthorizedPrivilegedRole(db, memberId, roleName, memberData, opts);
}
