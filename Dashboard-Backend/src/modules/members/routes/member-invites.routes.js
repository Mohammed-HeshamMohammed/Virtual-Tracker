import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getEnv } from "../../../config/env.js";
import { getAuthAdmin, getDb } from "../../../config/firebase.js";
import { getAuthContext, requireManagementRole } from "../../../http/auth-context.js";
import { canViewerManageInvite } from "../../../http/invite-scope.js";
import { readJsonBody } from "../../../http/read-json-body.js";
import { sendJson } from "../../../http/response.js";
import { normalizeDoc } from "../../schema/services/schema-crud.service.js";
import { USER_PROFILES_COLLECTION } from "../../auth/profile-collection-name.js";
import { createMemberPg, getMemberByFirebaseUidPg } from "../../../lib/postgres/members-postgres.service.js";
import { query } from "../../../lib/postgres/client.js";
import { upsertProfileFromUserRecord } from "../../auth/profile-sync.js";
import { sendPreprovisionWelcomeEmail } from "../../auth/preprovision-email.js";
import { isNotifyEmailRoutingConfigured } from "../../../lib/notify/email-client.js";
import { assertEmailCanUseMemberInviteOrPreprovision, validateEmailsForAddMembersFlow } from "../services/eligibility.js";
import { recordMemberRelationship } from "../../member-relationships/service.js";
import { isExcludedFromHierarchy } from "../../hierarchy/hierarchy-placement.js";
import { ensureMemberLinkedRecordsForUserRecord } from "../services/ensure-member-linked-records.js";
import { validateMemberNamePart } from "../services/member-display-name.js";
import { assertValidPhone } from "../../../http/validate-body.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import {
  deletePendingAuthProjects,
  getInviteProjectIds,
  getPendingAuthProjectIds,
  resolveRoleIdByName,
  resolveRoleNameById,
  syncInviteProjects,
  syncMemberPrimaryRole,
  syncPendingAuthProjects,
  syncProjectMembersForMember,
} from "../services/relation-sync.js";
import { validateRegistrationPassword } from "../../../http/password-validation.js";
import { logSafeError, logSafeWarn } from "../../../http/sanitize-error.js";
import { validateRoleAssignment } from "../../../http/role-assignment-guard.js";
import {
  checkInviteRegisterAllowed,
  recordInviteRegisterFailure,
  recordInviteRegisterSuccess,
} from "../../../http/invite-abuse-guard.js";
import { resolveAppPublicUrl } from "../../auth/app-public-url.js";
import {
  assertInviteAvailableForRegistration,
  resolveInviteExpiryMs,
  shareLinkInviteFields,
} from "../services/invite-lifecycle.js";
import {
  getInviteManagementLink,
  renewInviteForManagement,
  resendInviteEmailForManagement,
} from "../services/invite-management.service.js";

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Record<string, unknown>} row
 */
async function resolveInviteCreatorRoleName(db, row) {
  const createdByMemberId = typeof row.created_by === "string" ? row.created_by.trim() : "";
  if (createdByMemberId) {
    return resolveMemberRoleName(db, createdByMemberId);
  }
  const creatorUid = typeof row.created_by_uid === "string" ? row.created_by_uid.trim() : "";
  if (!creatorUid) return "";
  const member = await getMemberByFirebaseUidPg(creatorUid);
  if (!member) return "";
  return resolveMemberRoleName(db, String(member.id));
}

function normalizePathname(pathname) {
  return pathname.replace(/^\/api\/v1\//, "/api/");
}

function randomInviteToken() {
  return crypto.randomBytes(24).toString("hex");
}

function randomTempPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 14; i += 1) s += chars[crypto.randomInt(chars.length)];
  return `${s}!a1`;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} token
 */
async function findInviteByToken(db, token) {
  if (!token || typeof token !== "string" || token.length < 16) return null;
  const rows = await query("SELECT * FROM invites WHERE invite_token = $1 LIMIT 1", [token]);
  if (!rows.length) return null;
  const doc = rows[0];
  const id = String(doc.id);
  return {
    id,
    data: doc,
    ref: {
      update: async (patch) => {
        const useCountInc = patch.use_count ? 1 : 0;
        await query(
          "UPDATE invites SET status = $1, accepted_at = $2, firebase_uid = $3, use_count = COALESCE(use_count, 0) + $4, updated_at = now() WHERE id = $5",
          [patch.status ?? doc.status, patch.accepted_at ?? new Date(), patch.firebase_uid ?? "", useCountInc, id],
        );
      },
    },
  };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {import("firebase-admin/auth").Auth} auth
 * @param {string} uid
 */
async function promotePendingMemberCore(db, auth, uid) {
  const pendRows = await query("SELECT * FROM pending_auth_members WHERE firebase_uid = $1 LIMIT 1", [uid]);
  if (!pendRows.length) {
    const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
    await profileRef.set({ must_change_password: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const userRecord = await auth.getUser(uid);
    return { promoted: false, profile: await upsertProfileFromUserRecord(db, userRecord) };
  }
  const p = pendRows[0];
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
    const resolvedRoleName = await resolveRoleNameById(db, p.role_id);
    if (resolvedRoleName) roleName = resolvedRoleName;
  } else if (typeof p.role_name === "string" && p.role_name) {
    roleName = p.role_name;
  }
  const payRate = typeof p.pay_rate === "number" && !Number.isNaN(p.pay_rate) ? p.pay_rate : 0;

  const projects = await getPendingAuthProjectIds(db, uid);

  await createMemberPg(memberPayload);
  const creatorRoleName = await resolveInviteCreatorRoleName(db, p);
  await syncMemberPrimaryRole(
    db,
    memberId,
    roleName,
    typeof p.created_by_uid === "string" ? p.created_by_uid : "",
    creatorRoleName,
  );
  const { upsertMemberPayRate } = await import("../services/member-profile.service.js");
  await upsertMemberPayRate(db, memberId, payRate, typeof p.created_by_uid === "string" ? p.created_by_uid : "");
  if (projects.length > 0) {
    await syncProjectMembersForMember(db, memberId, projects, typeof p.created_by_uid === "string" ? p.created_by_uid : "");
  }

  // Record relationship: who added this member (organizational roles only — not Clients)
  const createdByUid = typeof p.created_by_uid === "string" ? p.created_by_uid : "";
  if (createdByUid && !isExcludedFromHierarchy(roleName)) {
    try {
      // Find the member ID of the creator
      const creatorMember = await getMemberByFirebaseUidPg(createdByUid);
      if (creatorMember) {
        const creatorMemberId = String(creatorMember.id);
        await recordMemberRelationship(db, {
          parentMemberId: creatorMemberId,
          childMemberId: memberId,
          relationshipType: "preprovision",
          createdBy: creatorMemberId,
          projects,
        });
      }
    } catch (relErr) {
      logSafeError("[promotePendingMemberCore] Failed to record relationship:", relErr);
      // Don't fail the promotion if relationship recording fails
    }
  }

  await query("DELETE FROM pending_auth_members WHERE firebase_uid = $1", [uid]);
  await deletePendingAuthProjects(db, uid);
  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  await profileRef.set({ must_change_password: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const userRecord = await auth.getUser(uid);
  try {
    await ensureMemberLinkedRecordsForUserRecord(db, userRecord);
  } catch (e) {
    logSafeWarn("[promotePendingMemberCore] ensure member-linked records failed:", e);
  }
  const profile = await upsertProfileFromUserRecord(db, userRecord);
  return { promoted: true, memberId, profile };
}

export { promotePendingMemberCore };

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeMemberInvites(req, res, url, origin) {
  const db = getDb();
  if (!db) return false;
  const auth = getAuthAdmin();
  const pn = normalizePathname(url.pathname);

  const paInvite = /^\/api(?:\/v1)?\/invites\/(pa_[^/]+)$/.exec(pn);
  if (paInvite && (req.method === "PUT" || req.method === "PATCH")) {
    sendJson(res, origin, 400, {
      success: false,
      error: "Pre-provisioned accounts cannot be edited from this list. Remove the pending account to cancel it.",
    });
    return true;
  }
  if (paInvite && req.method === "DELETE") {
    if (!requireManagementRole(getAuthContext(req))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions." });
      return true;
    }
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }
    const rawId = paInvite[1];
    const uid = rawId.startsWith("pa_") ? rawId.slice(3) : rawId;
    if (!uid || uid.length < 10) {
      sendJson(res, origin, 400, { success: false, error: "Invalid id" });
      return true;
    }
    const pendRows = await query("SELECT * FROM pending_auth_members WHERE firebase_uid = $1 LIMIT 1", [uid]);
    if (!pendRows.length) {
      sendJson(res, origin, 404, { success: false, error: "Pending account not found" });
      return true;
    }
    const viewer = getAuthContext(req);
    const pendingRow = pendRows[0];
    if (!(await canViewerManageInvite(db, viewer, pendingRow))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to cancel this pending account." });
      return true;
    }
    try {
      await query("DELETE FROM pending_auth_members WHERE firebase_uid = $1", [uid]);
      await deletePendingAuthProjects(db, uid);
      try {
        await auth.deleteUser(uid);
      } catch (e) {
        const code = typeof e === "object" && e !== null && "code" in e ? String(/** @type {{ code?: string }} */ (e).code) : "";
        if (code !== "auth/user-not-found") {
          logSafeError("[invites/pa_ delete] auth", e);
        }
      }
      sendJson(res, origin, 200, { success: true, data: { id: rawId, deleted: true } });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Delete failed" });
    }
    return true;
  }

  const inviteActionMatch = /^\/api(?:\/v1)?\/invites\/([^/]+)\/(resend|link|renew)$/.exec(pn);
  if (inviteActionMatch && req.method === "POST") {
    if (!requireManagementRole(getAuthContext(req))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions." });
      return true;
    }
    const inviteId = inviteActionMatch[1];
    const action = inviteActionMatch[2];
    const viewer = getAuthContext(req);
    const inviteRows = await query("SELECT * FROM invites WHERE id = $1 LIMIT 1", [inviteId]);
    if (!inviteRows.length) {
      sendJson(res, origin, 404, { success: false, error: "Invite not found." });
      return true;
    }
    const inviteRow = inviteRows[0];
    if (!(await canViewerManageInvite(db, viewer, inviteRow))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this invite." });
      return true;
    }
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
    const appOrigin = typeof body.appOrigin === "string" ? body.appOrigin : undefined;

    if (action === "link") {
      const result = await getInviteManagementLink(db, inviteId, appOrigin);
      if (!result.ok) {
        sendJson(res, origin, result.httpStatus, { success: false, error: result.error });
        return true;
      }
      sendJson(res, origin, 200, { success: true, inviteUrl: result.inviteUrl });
      return true;
    }

    if (action === "renew") {
      const result = await renewInviteForManagement(db, inviteId);
      if (!result.ok) {
        sendJson(res, origin, result.httpStatus, { success: false, error: result.error });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: normalizeDoc(result.row) });
      return true;
    }

    const result = await resendInviteEmailForManagement(db, inviteId, { appOrigin });
    if (!result.ok) {
      sendJson(res, origin, result.httpStatus, { success: false, error: result.error });
      return true;
    }
    sendJson(res, origin, 200, {
      success: true,
      emailSent: result.emailSent,
      channel: result.channel,
      emailError: result.emailError,
      emailDeliveryConfigured: isNotifyEmailRoutingConfigured(),
      inviteUrl: result.inviteUrl,
      data: normalizeDoc(result.row),
    });
    return true;
  }

  if (pn === "/api/members/validate-add" && req.method === "POST") {
    if (!requireManagementRole(getAuthContext(req))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions." });
      return true;
    }
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin is not configured." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const emails = Array.isArray(body.emails) ? body.emails : [];
    const forOpen = body.forOpenInviteLink === true;
    try {
      const { allOk, results } = await validateEmailsForAddMembersFlow(db, auth, emails, { forOpenInviteLink: forOpen });
      sendJson(res, origin, 200, { success: true, allOk, results });
    } catch (e) {
      logSafeError("[members/validate-add]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Validation failed" });
    }
    return true;
  }

  if (pn.startsWith("/api/public/invites/") && req.method === "GET") {
    const token = decodeURIComponent(pn.replace("/api/public/invites/", "").split("/")[0] || "");
    const inv = await findInviteByToken(db, token);
    if (!inv) {
      sendJson(res, origin, 404, { success: false, error: "Invite not found or expired." });
      return true;
    }
    const row = inv.data;
    const availability = assertInviteAvailableForRegistration(row);
    if (!availability.ok) {
      sendJson(res, origin, availability.httpStatus, { success: false, error: availability.error });
      return true;
    }
    const inviteKind = typeof row.invite_kind === "string" ? row.invite_kind : "email";
    const email = typeof row.email === "string" ? row.email.trim() : "";
    const expiryMs = resolveInviteExpiryMs(row);
    sendJson(res, origin, 200, {
      success: true,
      invite: {
        inviteKind,
        emailLocked: inviteKind === "email",
        email: inviteKind === "email" ? email : "",
        roleName: await resolveRoleNameById(db, typeof row.role_id === "string" ? row.role_id : "") || "Viewer",
        expiresAt: expiryMs != null ? new Date(expiryMs).toISOString() : null,
        singleUse: typeof row.max_uses === "number" ? row.max_uses === 1 : inviteKind === "open_link",
      },
    });
    return true;
  }

  if (pn.startsWith("/api/public/invites/") && pn.endsWith("/register") && req.method === "POST") {
    const token = decodeURIComponent(pn.replace("/api/public/invites/", "").replace(/\/register$/, ""));
    const auth = getAuthAdmin();
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : password;
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    let phone = "";
    try {
      phone = await assertValidPhone(body.phone, { required: true, label: "Phone number" });
    } catch (phoneErr) {
      sendJson(res, origin, 400, {
        success: false,
        error: phoneErr instanceof Error ? phoneErr.message : "Invalid phone number.",
      });
      return true;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendJson(res, origin, 400, { success: false, error: "A valid email is required." });
      return true;
    }
    if (!firstName) {
      sendJson(res, origin, 400, { success: false, error: "First name is required." });
      return true;
    }
    if (!lastName) {
      sendJson(res, origin, 400, { success: false, error: "Last name is required." });
      return true;
    }
    const firstNameValidation = validateMemberNamePart(firstName, "First name");
    if (firstNameValidation) {
      sendJson(res, origin, 400, { success: false, error: firstNameValidation });
      return true;
    }
    const lastNameValidation = validateMemberNamePart(lastName, "Last name");
    if (lastNameValidation) {
      sendJson(res, origin, 400, { success: false, error: lastNameValidation });
      return true;
    }
    if (firstName.length > 120 || lastName.length > 120) {
      sendJson(res, origin, 400, { success: false, error: "Name is too long." });
      return true;
    }
    const abuseCheck = checkInviteRegisterAllowed(req, email);
    if (!abuseCheck.allowed) {
      sendJson(res, origin, 429, {
        success: false,
        error: abuseCheck.message ?? "Too many failed registration attempts.",
        retryAfterSeconds: abuseCheck.retryAfterSeconds,
      });
      return true;
    }
    const passwordValidation = await validateRegistrationPassword(password, {
      confirmPassword,
      requireConfirm: true,
    });
    if (!passwordValidation.valid) {
      recordInviteRegisterFailure(req, email);
      sendJson(res, origin, 400, { success: false, error: passwordValidation.error ?? "Invalid password." });
      return true;
    }
    const inv = await findInviteByToken(db, token);
    if (!inv) {
      sendJson(res, origin, 404, { success: false, error: "Invite not found." });
      return true;
    }
    const row = inv.data;
    const availability = assertInviteAvailableForRegistration(row);
    if (!availability.ok) {
      sendJson(res, origin, availability.httpStatus, { success: false, error: availability.error });
      return true;
    }
    const inviteKind = typeof row.invite_kind === "string" ? row.invite_kind : "email";
    const inviteEmail = (typeof row.email === "string" ? row.email : "").trim().toLowerCase();
    if (inviteKind === "email" && inviteEmail && inviteEmail !== email) {
      sendJson(res, origin, 400, { success: false, error: "Email must match the invited address." });
      return true;
    }
    const preCheck = await assertEmailCanUseMemberInviteOrPreprovision(db, auth, email, { ignoreInviteId: inv.id });
    if (!preCheck.ok) {
      recordInviteRegisterFailure(req, email);
      sendJson(res, origin, 400, { success: false, error: preCheck.message, reason: preCheck.reason });
      return true;
    }
    try {
      const displayName = `${firstName} ${lastName}`.trim();
      const userRecord = await auth.createUser({
        email,
        password,
        emailVerified: inviteKind === "email",
        displayName,
      });
      const uid = userRecord.uid;
      const memberId = crypto.randomUUID();
      const inviteRoleId = typeof row.role_id === "string" && row.role_id ? row.role_id : "";
      const resolvedRoleName = inviteRoleId ? await resolveRoleNameById(db, inviteRoleId) : "";
      const roleName = resolvedRoleName || "Viewer";
      const payRate = typeof row.pay_rate === "number" && !Number.isNaN(row.pay_rate) ? row.pay_rate : 0;
      const inviteProjects = await getInviteProjectIds(db, inv.id);
      const memberPayload = {
        id: memberId,
        first_name: firstName,
        last_name: lastName,
        work_email: email,
        personal_email: "",
        employee_id: "",
        ip_address: "",
        phone_number: phone,
        phone_verified: false,
        status: "active",
        date_added: new Date(),
        created_by: "self-invite",
        registration_invite_kind: inviteKind,
        created_by_uid: typeof row.created_by_uid === "string" ? row.created_by_uid : "",
        updated_by: "",
        updated_at: new Date(),
        firebase_uid: uid,
      };
      await createMemberPg(memberPayload);
      const creatorRoleName = await resolveInviteCreatorRoleName(db, row);
      await syncMemberPrimaryRole(
        db,
        memberId,
        roleName,
        typeof row.created_by_uid === "string" ? row.created_by_uid : "",
        creatorRoleName,
      );
      const { upsertMemberPayRate } = await import("../services/member-profile.service.js");
      await upsertMemberPayRate(db, memberId, payRate, typeof row.created_by_uid === "string" ? row.created_by_uid : "");
      if (inviteProjects.length > 0) {
        await syncProjectMembersForMember(
          db,
          memberId,
          inviteProjects,
          typeof row.created_by_uid === "string" ? row.created_by_uid : "",
        );
      }

      // Record relationship: who invited this member (organizational roles only — not Clients)
      const inviterUid = typeof row.created_by_uid === "string" ? row.created_by_uid : "";
      if (inviterUid && !isExcludedFromHierarchy(roleName)) {
        try {
          const inviterMember = await getMemberByFirebaseUidPg(inviterUid);
          if (inviterMember) {
            const inviterMemberId = String(inviterMember.id);
            await recordMemberRelationship(db, {
              parentMemberId: inviterMemberId,
              childMemberId: memberId,
              relationshipType: "invite",
              createdBy: inviterMemberId,
              projects: inviteProjects,
            });
          }
        } catch (relErr) {
          logSafeError("[invite/register] Failed to record relationship:", relErr);
        }
      }

      await inv.ref.update({
        status: "completed",
        accepted_at: new Date(),
        firebase_uid: uid,
        use_count: FieldValue.increment(1),
        updated_at: new Date(),
      });
      await db.collection(USER_PROFILES_COLLECTION).doc(uid).set(
        {
          uid,
          firstName,
          lastName,
          phone,
          phoneVerified: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await upsertProfileFromUserRecord(db, await auth.getUser(uid));
      if (inviteKind === "email") {
        try {
          const { maybeSendRegistrationWelcomeEmail } = await import("../../auth/registration-welcome-email.js");
          void maybeSendRegistrationWelcomeEmail(db, auth, { uid });
        } catch (welcomeErr) {
          logSafeWarn("[invite/register] welcome email failed:", welcomeErr);
        }
      }
      recordInviteRegisterSuccess(req, email);
      sendJson(res, origin, 201, {
        success: true,
        uid,
        message: "Account created. You can sign in now.",
      });
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String(/** @type {{ code?: string }} */ (e).code) : "";
      if (code === "auth/email-already-exists") {
        recordInviteRegisterFailure(req, email);
        sendJson(res, origin, 409, { success: false, error: "An account already exists for this email. Sign in instead." });
        return true;
      }
      recordInviteRegisterFailure(req, email);
      const msg = e instanceof Error ? e.message : "Registration failed";
      logSafeError("[public/invites/register]", e);
      sendJson(res, origin, 500, { success: false, error: msg });
    }
    return true;
  }

  if (pn === "/api/invites/open-link" && req.method === "POST") {
    if (!requireManagementRole(getAuthContext(req))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to create invite links." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const viewer = getAuthContext(req);
    const roleName = typeof body.role === "string" ? body.role.trim() : "Viewer";
    const roleErr = await validateRoleAssignment(db, viewer?.roleName ?? "", { roleName });
    if (roleErr) {
      sendJson(res, origin, 403, { success: false, error: roleErr });
      return true;
    }
    const payRate = typeof body.payRate === "number" && !Number.isNaN(body.payRate) ? body.payRate : 0;
    const token = randomInviteToken();
    const id = crypto.randomUUID();
    const role_id = await resolveRoleIdByName(db, roleName);
    const payload = {
      id,
      email: "",
      invite_token: token,
      invite_kind: "open_link",
      role_id,
      pay_rate: payRate,
      currency: "USD",
      status: "pending_signup",
      sent_at: new Date(),
      accepted_at: null,
      created_by: typeof body.createdBy === "string" ? body.createdBy : viewer?.memberId ?? "open-link",
      created_by_uid: typeof body.createdByUid === "string" ? body.createdByUid : viewer?.uid ?? "",
      updated_by: "",
      ...shareLinkInviteFields(),
    };
    const INVITE_COLS = ["id","email","invite_token","invite_kind","role_id","pay_rate","currency","status","sent_at","accepted_at","created_by","created_by_uid","updated_by"];
    const colList = INVITE_COLS.join(", ");
    const phList = INVITE_COLS.map((_, i) => `$${i + 1}`).join(", ");
    const vals = INVITE_COLS.map((c) => payload[c] instanceof Date ? payload[c] : (payload[c] ?? null));
    await query(`INSERT INTO invites (${colList}) VALUES (${phList})`, vals);
    const appOrigin = typeof body.appOrigin === "string" && body.appOrigin.startsWith("http") ? body.appOrigin : "";
    const inviteBase = resolveAppPublicUrl(appOrigin);
    const invitePath = `/invite/${token}`;
    const inviteUrl = `${inviteBase}${invitePath}`;
    sendJson(res, origin, 201, {
      success: true,
      data: normalizeDoc({ ...payload, id }),
      token,
      inviteUrl,
      expiresAt: payload.expires_at instanceof Date ? payload.expires_at.toISOString() : null,
      maxUses: payload.max_uses,
    });
    return true;
  }

  if (pn === "/api/members/preprovision" && req.method === "POST") {
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin is not configured." });
      return true;
    }
    if (!requireManagementRole(getAuthContext(req))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to pre-provision members." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    let phone = "";
    if ("phone" in body && body.phone != null && String(body.phone).trim()) {
      try {
        phone = await assertValidPhone(body.phone, { required: false, label: "Phone number" });
      } catch (phoneErr) {
        sendJson(res, origin, 400, {
          success: false,
          error: phoneErr instanceof Error ? phoneErr.message : "Invalid phone number.",
        });
        return true;
      }
    }
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendJson(res, origin, 400, { success: false, error: "name and a valid email are required." });
      return true;
    }
    const [preprovisionFirst, ...preprovisionRest] = name.split(/\s+/).filter(Boolean);
    const preprovisionLast = preprovisionRest.join(" ");
    const preprovisionNameValidation =
      validateMemberNamePart(preprovisionFirst, "First name") ?? validateMemberNamePart(preprovisionLast, "Last name");
    if (preprovisionNameValidation) {
      sendJson(res, origin, 400, { success: false, error: preprovisionNameValidation });
      return true;
    }
    const viewer = getAuthContext(req);
    const roleName = typeof body.role === "string" ? body.role.trim() : "Viewer";
    const roleErr = await validateRoleAssignment(db, viewer?.roleName ?? "", { roleName });
    if (roleErr) {
      sendJson(res, origin, 403, { success: false, error: roleErr });
      return true;
    }
    const createdByUid =
      typeof body.createdByUid === "string" && body.createdByUid.trim()
        ? body.createdByUid.trim()
        : (viewer?.uid ?? "");
    const payRate = typeof body.payRate === "number" && !Number.isNaN(body.payRate) ? body.payRate : 0;
    const tempPassword = randomTempPassword();
    const eligible = await assertEmailCanUseMemberInviteOrPreprovision(db, auth, email);
    if (!eligible.ok) {
      const status = eligible.reason === "auth_exists" || eligible.reason === "member_exists" ? 409 : 400;
      sendJson(res, origin, status, { success: false, error: eligible.message, reason: eligible.reason });
      return true;
    }
    try {
      const userRecord = await auth.createUser({
        email,
        password: tempPassword,
        displayName: name,
        emailVerified: false,
      });
      const uid = userRecord.uid;
      const role_id = await resolveRoleIdByName(db, roleName);
      await query(
        `INSERT INTO pending_auth_members (firebase_uid, email, display_name, phone_number, role_id, pay_rate, created_by_uid, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (firebase_uid) DO UPDATE SET
           email = EXCLUDED.email, display_name = EXCLUDED.display_name, phone_number = EXCLUDED.phone_number,
           role_id = EXCLUDED.role_id, pay_rate = EXCLUDED.pay_rate, created_by_uid = EXCLUDED.created_by_uid`,
        [uid, email, name, phone || "", role_id, payRate, createdByUid, new Date()],
      );
      await db.collection(USER_PROFILES_COLLECTION).doc(uid).set(
        {
          uid,
          must_change_password: true,
          mustChangePassword: true,
          first_login: true,
          firstLogin: true,
          primaryEmail: email,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await upsertProfileFromUserRecord(db, userRecord);
      const sendWelcomeEmail = body.sendWelcomeEmail === true;
      let emailSent = false;
      if (sendWelcomeEmail) {
        const emailResult = await sendPreprovisionWelcomeEmail({
          email,
          displayName: name,
          temporaryPassword: tempPassword,
        });
        emailSent = emailResult.sent;
      }
      const devHint =
        getEnv().isDevelopment && !emailSent
          ? { tempPassword, note: "Remove in production: credentials echoed for local testing only." }
          : {};
      console.info(
        `[members/preprovision] Created pending user ${email}. Welcome email requested: ${sendWelcomeEmail}. Sent: ${emailSent}.`,
      );
      sendJson(res, origin, 201, {
        success: true,
        firebaseUid: uid,
        emailSent,
        sendWelcomeEmailRequested: sendWelcomeEmail,
        ...devHint,
      });
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String(/** @type {{ code?: string }} */ (e).code) : "";
      if (code === "auth/email-already-exists") {
        sendJson(res, origin, 409, { success: false, error: "This email is already registered." });
        return true;
      }
      logSafeError("[members/preprovision]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Pre-provision failed" });
    }
    return true;
  }

  return false;
}
