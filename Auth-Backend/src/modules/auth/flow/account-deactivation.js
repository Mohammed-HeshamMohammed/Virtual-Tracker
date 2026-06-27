import { isDeactivationApprovalRole, deactivationGovernanceForRole } from "../../../core/middleware/auth/role-hierarchy.js";
import { deleteMemberProfileData } from "../../shared/services/auth-helpers.js";
import { USER_PROFILES_COLLECTION } from "../profile/profile-collection-name.js";

const DEACTIVATION_REQUESTS = "deactivation_requests";
const MEMBER_AUTH_INDEX = "member_auth_index";
const PENDING_AUTH = "pending_auth_members";

function normalizeRoleName(role) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function isViewerRole(roleName) {
  return normalizeRoleName(roleName) === "viewer";
}

async function findPendingDeactivationRequest(db, memberId) {
  const snap = await db
    .collection(DEACTIVATION_REQUESTS)
    .where("memberId", "==", memberId)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

async function resolveAdminLevelRecipientIds(db, excludeMemberId = "") {
  const rolesSnap = await db.collection("roles").limit(100).get();
  const adminRoleIds = new Set();
  for (const doc of rolesSnap.docs) {
    const name = typeof doc.data()?.name === "string" ? doc.data().name : "";
    if (isDeactivationApprovalRole(name)) adminRoleIds.add(doc.id);
  }
  if (adminRoleIds.size === 0) return [];

  const recipients = new Set();
  const membersSnap = await db.collection("members").limit(2000).get();
  for (const doc of membersSnap.docs) {
    if (doc.id === excludeMemberId) continue;
    const roleId = typeof doc.data()?.role_id === "string" ? doc.data().role_id : "";
    if (roleId && adminRoleIds.has(roleId)) recipients.add(doc.id);
  }

  return [...recipients];
}

async function notifyAdminsOfDeactivationRequest(db, requestDoc, requesterMemberId) {
  // No-op for minimal backend
}

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
  const ref = await db.collection(DEACTIVATION_REQUESTS).add(doc);
  await notifyAdminsOfDeactivationRequest(db, doc, memberId);
  return { id: ref.id, alreadyPending: false };
}

export async function listPendingDeactivationRequests(db, approverRoleName) {
  if (!isDeactivationApprovalRole(approverRoleName)) {
    throw new Error("Only Admin, Super Admin, or Owner roles may review deactivation requests.");
  }
  const snap = await db
    .collection(DEACTIVATION_REQUESTS)
    .where("status", "==", "pending")
    .limit(200)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

export async function resolveDeactivationRequest(db, requestId, action, resolverMemberId, resolverRoleName) {
  if (!isDeactivationApprovalRole(resolverRoleName)) {
    throw new Error("Only Admin, Super Admin, or Owner roles may approve or reject deactivation requests.");
  }
  if (action !== "approved" && action !== "rejected") {
    throw new Error("Invalid deactivation resolution action.");
  }

  const ref = db.collection(DEACTIVATION_REQUESTS).doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Deactivation request not found.");
  const data = snap.data() || {};
  if (data.status !== "pending") throw new Error("This deactivation request is no longer pending.");

  await ref.set(
    {
      status: action,
      resolvedAt: new Date(),
      resolvedBy: resolverMemberId,
    },
    { merge: true },
  );

  return { id: requestId, status: action, memberId: data.memberId ?? "" };
}

export async function deleteViewerSelfAccount(auth, db, uid, memberId, roleName) {
  if (!isViewerRole(roleName)) {
    throw new Error("Only Viewer accounts can be deleted directly. Submit a deactivation request instead.");
  }

  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  await deleteMemberProfileData(db, memberId);
  await db.collection("members").doc(memberId).delete();
  await db.collection(MEMBER_AUTH_INDEX).doc(uid).delete().catch(() => {});
  await db.collection(PENDING_AUTH).doc(uid).delete().catch(() => {});
  await profileRef.delete().catch(() => {});

  try {
    await auth.deleteUser(uid);
  } catch (e) {
    const code =
      typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
    if (code !== "auth/user-not-found") {
      throw e;
    }
  }
  return { deleted: true, memberId };
}
