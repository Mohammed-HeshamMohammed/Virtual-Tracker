import { getAuthAdmin, getDb, readFirebaseWebConfigFromEnv } from "../../config/firebase.js";
import { getEnv } from "../../config/env.js";
import { requireManagementRole } from "../../http/auth-context.js";
import { authenticateRequest } from "../../http/auth-middleware.js";
import { readIdToken } from "../../http/auth-token.js";
import { readJsonBody, MAX_AVATAR_JSON_BODY_BYTES } from "../../http/read-json-body.js";
import { assertMaxLength, rejectUnknownFields } from "../../http/validate-body.js";
import { sendJson } from "../../http/response.js";
import { upsertProfileFromUserRecord } from "./profile-sync.js";
import { patchProfileSettings } from "./profile-settings.js";
import { clearProfileAvatar, setProfileAvatarFromUpload, stripBase64DataUrl } from "./profile-avatar.js";
import { deleteViewerSelfAccount, listPendingDeactivationRequests, resolveDeactivationRequest, submitAccountDeactivationRequest } from "./account-deactivation.js";
import { validateSessionAuthorization, isPasswordProviderUser } from "./session-authorization.js";
import { completeFirstLoginPasswordChange } from "./complete-first-login.js";
import { promotePendingMemberCore } from "../members/routes/member-invites.routes.js";
import { handleSessionBootstrap } from "./session-bootstrap.js";
import { ensureMemberLinkedRecordsForUserRecord } from "../members/services/ensure-member-linked-records.js";
import { alignMemberRoleTables } from "../members/services/relation-sync.js";
import { enforceUnauthorizedPrivilegedRole } from "../members/services/privileged-role-governance.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { normalizePasswordInput } from "../../http/password-request-guard.js";
import { logSafeError, logSafeWarn } from "../../http/sanitize-error.js";
import { quotaErrorHttpResponse } from "../../http/quota-error.js";
import { probeFirestoreReadiness } from "./readiness.js";
import {
  resolveAuthContinueUrl,
  sendEmailVerificationEmail,
  withEmailVerifiedContinueUrl,
} from "./verification-email.js";
import { assertDeviceNotBanned, assertMemberNotBanned } from "../members/services/member-ban-service.js";
import { getRequestIp } from "../../http/request-ip.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {{ email?: string }} [opts]
 * @returns {Promise<boolean>} true when blocked (response already sent)
 */
async function enforceAuthAccessGuards(req, res, origin, opts = {}) {
  const db = getDb();
  if (!db) return false;
  const deviceGate = await assertDeviceNotBanned(db, getRequestIp(req));
  if (!deviceGate.ok) {
    sendJson(res, origin, deviceGate.status, {
      success: false,
      error: deviceGate.error,
      code: deviceGate.code,
    });
    return true;
  }
  const email = typeof opts.email === "string" ? opts.email.trim().toLowerCase() : "";
  if (email) {
    const banGate = await assertMemberNotBanned(db, { email });
    if (!banGate.ok) {
      sendJson(res, origin, banGate.status, {
        success: false,
        error: banGate.error,
        code: banGate.code,
      });
      return true;
    }
  }
  return false;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>} true if handled
 */
export async function routeAuthIdentity(req, res, url, origin) {
  const authPath = url.pathname.replace(/^\/api\/v1\/auth\//, "/api/auth/");

  if (await handleSessionBootstrap(req, res, origin, url)) return true;

  if (authPath === "/api/auth/sign-in-client-extras" && req.method === "GET") {
    const vapidPublicKey = getEnv().firebase.webPush.vapidPublicKey || null;
    sendJson(res, origin, 200, {
      success: true,
      ...(vapidPublicKey ? { webPush: { vapidPublicKey } } : {}),
    });
    return true;
  }

  if (authPath === "/api/auth/send-verification-email" && req.method === "POST") {
    const auth = getAuthAdmin();
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin is not configured." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["continueUrl"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const decoded = await auth.verifyIdToken(idToken);
      const userRecord = await auth.getUser(decoded.uid);
      const email = typeof userRecord.email === "string" ? userRecord.email.trim().toLowerCase() : "";
      if (!email) {
        sendJson(res, origin, 400, { success: false, error: "Account has no email address." });
        return true;
      }
      if (!isPasswordProviderUser(userRecord)) {
        sendJson(res, origin, 400, {
          success: false,
          code: "NOT_PASSWORD_ACCOUNT",
          error: "Email verification is only required for email/password accounts.",
        });
        return true;
      }
      if (userRecord.emailVerified) {
        sendJson(res, origin, 400, {
          success: false,
          code: "ALREADY_VERIFIED",
          error: "This email address is already verified.",
        });
        return true;
      }
      const continueUrl = resolveAuthContinueUrl(body, getEnv());
      const verificationLink = await auth.generateEmailVerificationLink(email, {
        url: withEmailVerifiedContinueUrl(continueUrl),
      });
      const result = await sendEmailVerificationEmail({
        email,
        verificationLink,
        appPublicUrl: continueUrl,
      });
      if (result.sent) {
        sendJson(res, origin, 200, { success: true, sent: true, channel: result.channel });
        return true;
      }
      if (result.channel === "console") {
        sendJson(res, origin, 503, {
          success: false,
          code: "EMAIL_NOT_CONFIGURED",
          sent: false,
          channel: result.channel,
          error:
            "Outbound email is not configured on Notify-Backend. Configure SMTP_* in Notify-Backend/.env or ensure NOTIFY_BACKEND_URL points to a running vt-notify-api instance.",
        });
        return true;
      }
      sendJson(res, origin, 502, {
        success: false,
        code: "EMAIL_SEND_FAILED",
        sent: false,
        channel: result.channel,
        error: result.error || "Could not send verification email.",
      });
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String(/** @type {{ code?: unknown }} */ (e).code) : "";
      if (code.startsWith("auth/")) {
        sendJson(res, origin, 401, { success: false, error: e instanceof Error ? e.message : "Invalid token" });
        return true;
      }
      logSafeError("[auth/send-verification-email]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Could not send verification email.",
      });
    }
    return true;
  }

  if (authPath === "/api/auth/complete-first-login" && req.method === "POST") {
    const auth = getAuthAdmin();
    const db = getDb();
    if (!auth || !db) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin or Firestore is not configured." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["currentPassword", "newPassword", "confirmPassword"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const decoded = await auth.verifyIdToken(idToken);
      const result = await completeFirstLoginPasswordChange(db, auth, decoded.uid, body);
      sendJson(res, origin, 200, {
        success: true,
        requireSignIn: true,
        promoted: result.promoted,
        memberId: result.memberId,
        profile: result.profile,
      });
    } catch (e) {
      const status = typeof e === "object" && e !== null && "status" in e ? Number(e.status) || 400 : 500;
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Password change failed",
      });
    }
    return true;
  }

  if (authPath === "/api/auth/notify-password-changed" && req.method === "POST") {
    const auth = getAuthAdmin();
    const db = getDb();
    if (!auth || !db) {
      sendJson(res, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }
    const authResult = await authenticateRequest(req, url, db);
    if (!authResult.ok) {
      sendJson(res, origin, authResult.status, { success: false, error: authResult.error });
      return true;
    }
    const { notifyPasswordUpdated } = await import("./security-login-alerts.js");
    void notifyPasswordUpdated(auth, authResult.context.uid, "changed");
    sendJson(res, origin, 200, { success: true });
    return true;
  }

  if (authPath === "/api/auth/notify-password-reset" && req.method === "POST") {
    const auth = getAuthAdmin();
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["email"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email) {
      const { notifyPasswordUpdatedByEmail } = await import("./security-login-alerts.js");
      void notifyPasswordUpdatedByEmail(auth, email, "reset");
    }
    sendJson(res, origin, 200, { success: true });
    return true;
  }

  if (authPath === "/api/auth/notify-email-verified" && req.method === "POST") {
    const auth = getAuthAdmin();
    const db = getDb();
    if (!auth || !db) {
      sendJson(res, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["email"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email) {
      try {
        const { maybeSendRegistrationWelcomeEmail } = await import("./registration-welcome-email.js");
        void maybeSendRegistrationWelcomeEmail(db, auth, { email });
      } catch (welcomeErr) {
        logSafeWarn("[auth/notify-email-verified]", welcomeErr);
      }
    }
    sendJson(res, origin, 200, { success: true });
    return true;
  }

  if (authPath === "/api/auth/promote-pending-member" && req.method === "POST") {
    const auth = getAuthAdmin();
    const db = getDb();
    if (!auth || !db) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin or Firestore is not configured." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const decoded = await auth.verifyIdToken(idToken);
      const profileSnap = await db.collection("User_profiles").doc(decoded.uid).get();
      const profileData = profileSnap.exists ? profileSnap.data() || {} : {};
      const mustChange =
        profileData.must_change_password === true || profileData.mustChangePassword === true;
      if (!mustChange) {
        sendJson(res, origin, 403, {
          success: false,
          error: "Password change is not required for this account.",
          code: "MUST_CHANGE_PASSWORD",
        });
        return true;
      }
      const result = await promotePendingMemberCore(db, auth, decoded.uid);
      const profile = result.profile ?? (await upsertProfileFromUserRecord(db, await auth.getUser(decoded.uid)));
      sendJson(res, origin, 200, { success: true, promoted: result.promoted, profile });
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String(/** @type {{ code?: unknown }} */ (e).code) : "";
      if (code.startsWith("auth/")) {
        sendJson(res, origin, 401, { success: false, error: e instanceof Error ? e.message : "Invalid token" });
        return true;
      }
      logSafeError("[auth/promote-pending-member]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Promote failed" });
    }
    return true;
  }


  if (authPath === "/api/auth/presence" && req.method === "POST") {
    sendJson(res, origin, 410, {
      success: false,
      error: "Presence HTTP signals are deprecated. Connect via WebSocket at /api/presence/ws after authentication.",
      code: "PRESENCE_WS_REQUIRED",
    });
    return true;
  }

  if (url.pathname === "/api/auth/profile" && req.method === "POST") {
    const auth = getAuthAdmin();
    const db = getDb();
    if (!auth || !db) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin or Firestore is not configured." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      rejectUnknownFields(body, ["firstName", "lastName", "email", "phone"]);
      assertMaxLength(body.firstName, 120, "firstName");
      assertMaxLength(body.lastName, 120, "lastName");
      assertMaxLength(body.email, 320, "email");
      const decoded = await auth.verifyIdToken(idToken);
      const profile = await patchProfileSettings(auth, db, decoded.uid, body);
      sendJson(res, origin, 200, { success: true, profile });
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String(/** @type {{ code?: unknown }} */ (e).code) : "";
      if (code.startsWith("auth/")) {
        const authMsg =
          code === "auth/email-already-exists"
            ? "This email is already in use by another account."
            : e instanceof Error
              ? e.message
              : "Invalid or expired token";
        sendJson(res, origin, code === "auth/email-already-exists" ? 400 : 401, {
          success: false,
          error: authMsg,
        });
        return true;
      }
      const msg = e instanceof Error ? e.message : "Profile update failed";
      const lower = msg.toLowerCase();
      if (lower.includes("no profile fields") || lower.includes("unexpected field") || lower.includes("must be at most") || lower.includes("valid email") || lower.includes("already in use") || lower.includes("cannot be an email") || lower.includes("cannot contain @")) {
        sendJson(res, origin, 400, { success: false, error: msg });
        return true;
      }
      logSafeError("[auth/profile]", e);
      sendJson(res, origin, 500, { success: false, error: msg });
    }
    return true;
  }

  if (authPath === "/api/auth/profile-avatar" && req.method === "POST") {
    const auth = getAuthAdmin();
    const db = getDb();
    if (!auth || !db) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin or Firestore is not configured." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req, MAX_AVATAR_JSON_BODY_BYTES);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      rejectUnknownFields(body, ["imageBase64", "contentType", "clear"]);
      const decoded = await auth.verifyIdToken(idToken);
      const uid = decoded.uid;

      if (body.clear === true) {
        const profile = await clearProfileAvatar(auth, db, uid);
        sendJson(res, origin, 200, { success: true, profile });
        return true;
      }

      const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
      const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
      if (!imageBase64 || !contentType) {
        sendJson(res, origin, 400, {
          success: false,
          error: "body.imageBase64 and body.contentType are required (or set body.clear: true to remove the picture).",
        });
        return true;
      }

      const b64 = stripBase64DataUrl(imageBase64).replace(/\s/g, "");
      let buffer;
      try {
        buffer = Buffer.from(b64, "base64");
      } catch {
        sendJson(res, origin, 400, { success: false, error: "Invalid base64 image." });
        return true;
      }
      if (buffer.length === 0) {
        sendJson(res, origin, 400, { success: false, error: "Invalid or empty image data." });
        return true;
      }

      const profile = await setProfileAvatarFromUpload(auth, db, uid, buffer, contentType);
      sendJson(res, origin, 200, { success: true, profile });
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String(/** @type {{ code?: unknown }} */ (e).code) : "";
      if (code.startsWith("auth/")) {
        sendJson(res, origin, 401, {
          success: false,
          error: e instanceof Error ? e.message : "Invalid or expired token",
        });
        return true;
      }
      const msg = e instanceof Error ? e.message : "Avatar update failed";
      const lower = msg.toLowerCase();
      let status = 500;
      if (
        lower.includes("unsupported") ||
        lower.includes("too large") ||
        lower.includes("empty") ||
        lower.includes("invalid") ||
        lower.includes("no uploaded profile picture") ||
        lower.includes("unexpected field")
      ) {
        status = 400;
      } else if (lower.includes("not configured")) {
        status = 503;
      } else {
        logSafeError("[auth/profile-avatar]", e);
      }
      sendJson(res, origin, status, { success: false, error: msg });
    }
    return true;
  }

  if (authPath === "/api/auth/deactivation-requests" && req.method === "GET") {
    const db = getDb();
    if (!db) {
      sendJson(res, origin, 503, { success: false, error: "Firestore is not configured." });
      return true;
    }
    const authResult = await authenticateRequest(req, url, db);
    if (!authResult.ok) {
      sendJson(res, origin, authResult.status, { success: false, error: authResult.error });
      return true;
    }
    try {
      const rows = await listPendingDeactivationRequests(db, authResult.context.roleName);
      sendJson(res, origin, 200, { success: true, data: rows });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to list deactivation requests";
      const status = msg.toLowerCase().includes("only admin") ? 403 : 500;
      sendJson(res, origin, status, { success: false, error: msg });
    }
    return true;
  }

  const deactivationResolveMatch = authPath.match(/^\/api\/auth\/deactivation-requests\/([^/]+)\/(approve|reject)$/);
  if (deactivationResolveMatch && req.method === "POST") {
    const db = getDb();
    if (!db) {
      sendJson(res, origin, 503, { success: false, error: "Firestore is not configured." });
      return true;
    }
    const authResult = await authenticateRequest(req, url, db);
    if (!authResult.ok) {
      sendJson(res, origin, authResult.status, { success: false, error: authResult.error });
      return true;
    }
    const requestId = deactivationResolveMatch[1];
    const action = deactivationResolveMatch[2] === "approve" ? "approved" : "rejected";
    try {
      const result = await resolveDeactivationRequest(
        db,
        requestId,
        action,
        authResult.context.memberId,
        authResult.context.roleName,
      );
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to resolve deactivation request";
      let status = 500;
      if (msg.toLowerCase().includes("only admin")) status = 403;
      if (msg.toLowerCase().includes("not found")) status = 404;
      if (msg.toLowerCase().includes("no longer pending")) status = 409;
      sendJson(res, origin, status, { success: false, error: msg });
    }
    return true;
  }

  if (authPath === "/api/auth/deactivation-request" && req.method === "POST") {
    const auth = getAuthAdmin();
    const db = getDb();
    if (!auth || !db) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin or Firestore is not configured." });
      return true;
    }
    const authResult = await authenticateRequest(req, url, db);
    if (!authResult.ok) {
      sendJson(res, origin, authResult.status, { success: false, error: authResult.error });
      return true;
    }
    const { uid, memberId, roleName, email } = authResult.context;
    try {
      let body = {};
      try {
        body = await readJsonBody(req);
        rejectUnknownFields(body, []);
      } catch (e) {
        if (!(e instanceof Error && e.message === "Invalid JSON body")) {
          const msg = e instanceof Error ? e.message : "Invalid body";
          if (msg !== "Request body too large") {
            sendJson(res, origin, 400, { success: false, error: msg });
            return true;
          }
        }
      }
      void body;
      const userRecord = await auth.getUser(uid);
      const result = await submitAccountDeactivationRequest(db, uid, memberId, roleName, {
        email: email ?? userRecord.email ?? "",
        displayName: userRecord.displayName ?? "",
      });
      sendJson(res, origin, 201, {
        success: true,
        data: { id: result.id, alreadyPending: result.alreadyPending },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Deactivation request failed";
      const lower = msg.toLowerCase();
      const status = lower.includes("viewer") ? 400 : 500;
      sendJson(res, origin, status, { success: false, error: msg });
    }
    return true;
  }

  if (authPath === "/api/auth/delete-account" && req.method === "POST") {
    const auth = getAuthAdmin();
    const db = getDb();
    if (!auth || !db) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin or Firestore is not configured." });
      return true;
    }
    const authResult = await authenticateRequest(req, url, db);
    if (!authResult.ok) {
      sendJson(res, origin, authResult.status, { success: false, error: authResult.error });
      return true;
    }
    const { uid, memberId, roleName } = authResult.context;
    try {
      await deleteViewerSelfAccount(auth, db, uid, memberId, roleName);
      sendJson(res, origin, 200, { success: true, data: { deleted: true } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Account deletion failed";
      const lower = msg.toLowerCase();
      let status = 500;
      if (lower.includes("only viewer") || lower.includes("deactivation request")) status = 403;
      sendJson(res, origin, status, { success: false, error: msg });
    }
    return true;
  }

  if (authPath === "/api/auth/access-request" && req.method === "POST") {
    const db = getDb();
    if (!db) {
      sendJson(res, origin, 503, { success: false, error: "Database is not configured" });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["name", "email", "phone"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    assertMaxLength(name, 200, "name");
    assertMaxLength(email, 320, "email");
    assertMaxLength(phone, 40, "phone");
    if (!name || !email) {
      sendJson(res, origin, 400, { success: false, error: "name and email are required" });
      return true;
    }
    const doc = {
      name,
      email,
      phone,
      createdAt: new Date(),
      source: "virtual-tracker-app",
    };
    const ref = await db.collection("access_requests").add(doc);
    sendJson(res, origin, 201, { success: true, data: { id: ref.id } });
    return true;
  }

  return false;
}
