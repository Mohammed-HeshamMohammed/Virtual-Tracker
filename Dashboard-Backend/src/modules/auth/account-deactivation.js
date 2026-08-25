import { isDeactivationApprovalRole, deactivationGovernanceForRole } from "../../http/role-hierarchy.js";
import { revokeAgentDevicesForMember } from "../activity/agent-devices.service.js";
import { deleteMemberProfileData } from "../members/services/member-profile.service.js";
import { resolveRoleIdsWhere } from "../members/services/relation-sync.js";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { deleteMemberPg, listMembersPg } from "../../lib/postgres/members-postgres.service.js";

const DEACTIVATION_REQUESTS = "deactivation_requests";
const DEACTIVATION_COLUMNS =
  "id, member_id, firebase_uid, member_email, member_name, role_name, governance, status, source, resolved_by, resolved_at, created_at";

/**
 * The Firestore docs this replaced were camelCase (memberId, memberName, …)
 * and both the approvals UI and notifyAdminsOfDeactivationRequest read them
 * that way, so rows are widened to carry both spellings rather than renaming
 * fields across the callers.
 * @param {Record<string, unknown>} row
 */
function normalizeDeactivationRow(row) {
  return {
    ...row,
    memberId: row.member_id,
    firebaseUid: row.firebase_uid,
    memberEmail: row.member_email,
    memberName: row.member_name,
    roleName: row.role_name,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

function normalizeRoleName(role) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function isViewerRole(roleName) {
  return normalizeRoleName(roleName) === "viewer";
}

/**
 * `db` is unused - deactivation requests are Postgres rows now.
 * @param {import("firebase-admin/firestore").Firestore} _db
 * @param {string} memberId
 */
async function findPendingDeactivationRequest(_db, memberId) {
  const rows = await pgQuery(
    `SELECT ${DEACTIVATION_COLUMNS} FROM ${DEACTIVATION_REQUESTS}
      WHERE member_id = $1 AND status = 'pending' LIMIT 1`,
    [memberId],
  );
  return rows.length ? normalizeDeactivationRow(rows[0]) : null;
}

/**
 * Admin / Super Admin / Owner recipients for employee deactivation workflows.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} [excludeMemberId]
 */
async function resolveAdminLevelRecipientIds(db, excludeMemberId = "") {
  const adminRoleIds = new Set(await resolveRoleIdsWhere(isDeactivationApprovalRole));
  if (adminRoleIds.size === 0) return [];

  const recipients = new Set();
  const members = await listMembersPg({ limit: 2000 });
  for (const data of members) {
    if (data.id === excludeMemberId) continue;
    const roleId = typeof data.role_id === "string" ? data.role_id : "";
    if (roleId && adminRoleIds.has(roleId)) recipients.add(data.id);
  }

  return [...recipients];
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberName?: string; memberEmail?: string; roleName?: string }} requestDoc
 * @param {string} requesterMemberId
 */
async function notifyAdminsOfDeactivationRequest(db, requestDoc, requesterMemberId) {
  const { createNotification } = await import("../notifications/service.js");
  const recipients = await resolveAdminLevelRecipientIds(db, requesterMemberId);
  if (recipients.length === 0) return;

  const memberLabel =
    (typeof requestDoc.memberName === "string" && requestDoc.memberName.trim()) ||
    (typeof requestDoc.memberEmail === "string" && requestDoc.memberEmail.trim()) ||
    "A team member";
  const roleLabel =
    typeof requestDoc.roleName === "string" && requestDoc.roleName.trim()
      ? requestDoc.roleName.trim()
      : "member";

  await Promise.all(
    recipients.map((recipient_id) =>
      createNotification(db, {
        recipient_id,
        type: "account_deactivation_request",
        title: "Account deactivation request",
        message: `${memberLabel} (${roleLabel}) requested account deactivation.`,
        link: "people-members",
      }).catch(() => null),
    ),
  );
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 * @param {string} memberId
 * @param {string} roleName
 * @param {{ email?: string; displayName?: string }} [meta]
 */
export async function submitAccountDeactivationRequest(db, uid, memberId, roleName, meta = {}) {
  if (isViewerRole(roleName)) {
    throw new Error("Viewer accounts must use direct account deletion instead of a deactivation request.");
  }

  const existing = await findPendingDeactivationRequest(db, memberId);
  if (existing) {
    return { id: existing.id, alreadyPending: true };
  }

  const governance = deactivationGovernanceForRole(roleName);
  const doc = {
    memberId,
    firebaseUid: uid,
    memberEmail: typeof meta.email === "string" ? meta.email.trim() : "",
    memberName: typeof meta.displayName === "string" ? meta.displayName.trim() : "",
    roleName: String(roleName || "").trim() || "Unknown",
    governance,
    status: "pending",
    createdAt: new Date(),
    source: "virtual-tracker-app",
  };
  const inserted = await pgQuery(
    `INSERT INTO ${DEACTIVATION_REQUESTS}
       (member_id, firebase_uid, member_email, member_name, role_name, governance, status, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
     RETURNING id`,
    [memberId, uid, doc.memberEmail, doc.memberName, doc.roleName, doc.governance, doc.source],
  );
  await notifyAdminsOfDeactivationRequest(db, doc, memberId);
  return { id: inserted[0].id, alreadyPending: false };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} approverRoleName
 */
export async function listPendingDeactivationRequests(db, approverRoleName) {
  if (!isDeactivationApprovalRole(approverRoleName)) {
    throw new Error("Only Admin, Super Admin, or Owner roles may review deactivation requests.");
  }
  const rows = await pgQuery(
    `SELECT ${DEACTIVATION_COLUMNS} FROM ${DEACTIVATION_REQUESTS}
      WHERE status = 'pending' ORDER BY created_at DESC LIMIT 200`,
  );
  return rows.map(normalizeDeactivationRow);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} requestId
 * @param {"approved" | "rejected"} action
 * @param {string} resolverMemberId
 * @param {string} resolverRoleName
 */
export async function resolveDeactivationRequest(db, requestId, action, resolverMemberId, resolverRoleName) {
  if (!isDeactivationApprovalRole(resolverRoleName)) {
    throw new Error("Only Admin, Super Admin, or Owner roles may approve or reject deactivation requests.");
  }
  if (action !== "approved" && action !== "rejected") {
    throw new Error("Invalid deactivation resolution action.");
  }

  // One conditional UPDATE instead of read-then-write: two approvers hitting
  // the same request at once both passed the old "still pending?" check and
  // both wrote a resolution. Here the second one matches no row.
  const resolved = await pgQuery(
    `UPDATE ${DEACTIVATION_REQUESTS}
        SET status = $2, resolved_at = now(), resolved_by = $3
      WHERE id = $1 AND status = 'pending'
      RETURNING member_id`,
    [requestId, action, resolverMemberId],
  );
  if (!resolved.length) {
    const existing = await pgQuery(`SELECT status FROM ${DEACTIVATION_REQUESTS} WHERE id = $1 LIMIT 1`, [requestId]);
    if (!existing.length) throw new Error("Deactivation request not found.");
    throw new Error("This deactivation request is no longer pending.");
  }

  return { id: requestId, status: action, memberId: resolved[0].member_id ?? "" };
}

/**
 * @param {import("firebase-admin/auth").Auth} auth
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 * @param {string} memberId
 * @param {string} roleName
 */
export async function deleteViewerSelfAccount(auth, db, uid, memberId, roleName) {
  if (!isViewerRole(roleName)) {
    throw new Error("Only Viewer accounts can be deleted directly. Submit a deactivation request instead.");
  }

  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  // Before the member row goes, kill any desktop-agent device credentials tied
  // to it - they must not outlive the account.
  await revokeAgentDevicesForMember(memberId).catch(() => {});
  await deleteMemberProfileData(db, memberId);
  await deleteMemberPg(memberId, memberId);
  await pgQuery("DELETE FROM pending_auth_members WHERE firebase_uid = $1", [uid]).catch(() => {});
  await profileRef.delete().catch(() => {});

  try {
    await auth.deleteUser(uid);
  } catch (e) {
    const code =
      typeof e === "object" && e !== null && "code" in e ? String(/** @type {{ code?: unknown }} */ (e).code) : "";
    if (code !== "auth/user-not-found") {
      throw e;
    }
  }
  return { deleted: true, memberId };
}
