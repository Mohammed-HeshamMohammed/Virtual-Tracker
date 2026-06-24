import { getAuthAdmin, getDb, readFirebaseWebConfigFromEnv } from "../../core/database/firebase.js";
import { getEnv } from "../../config/env/index.js";
import { requireManagementRole } from "../../core/middleware/auth/auth-context.js";
import { authenticateRequest } from "../../core/middleware/auth/auth-middleware.js";
import { readIdToken } from "../../core/middleware/auth/auth-token.js";
import { readJsonBody, MAX_AVATAR_JSON_BODY_BYTES } from "../../core/middleware/http/read-json-body.js";
import { assertMaxLength, assertValidPhone, rejectUnknownFields } from "../../core/middleware/http/validate-body.js";
import { sendJson } from "../../core/middleware/http/response.js";
import { upsertProfileFromUserRecord } from "./profile/profile-sync.js";
import { patchProfileSettings } from "./profile/profile-settings.js";
import { clearProfileAvatar, setProfileAvatarFromUpload, stripBase64DataUrl } from "./profile/profile-avatar.js";
import { deleteViewerSelfAccount, listPendingDeactivationRequests, resolveDeactivationRequest, submitAccountDeactivationRequest } from "./flow/account-deactivation.js";
import { validateSessionAuthorization, isPasswordProviderUser } from "./flow/session-authorization.js";
import { completeFirstLoginPasswordChange } from "./flow/complete-first-login.js";
import {
  promotePendingMemberCore,
  ensureMemberLinkedRecordsForUserRecord,
  alignMemberRoleTables,
  enforceUnauthorizedPrivilegedRole,
  resolveMemberRoleName,
  assertDeviceNotBanned,
  assertMemberNotBanned,
} from "../shared/services/auth-helpers.js";
import { validatePassword } from "../../config/password-policy/index.js";
import { getPublicPasswordPolicyResponse } from "../../config/password-policy/index.js";
import { normalizePasswordInput } from "../../core/middleware/security/password-request-guard.js";
import { logSafeError, logSafeWarn } from "../../core/middleware/http/sanitize-error.js";
import { quotaErrorHttpResponse } from "../../core/middleware/http/quota-error.js";
import { probeFirestoreReadiness } from "./flow/readiness.js";
import {
  resolveAuthContinueUrl,
  sendEmailVerificationEmail,
  withEmailVerifiedContinueUrl,
} from "./email/verification-email.js";
import { getEmailDeliveryConfig } from "./email/email-config.js";
import { getRequestIp } from "../../core/middleware/http/request-ip.js";
import {
  sendPhoneVerificationCode,
  confirmPhoneVerificationCode,
  assertPhoneVerificationToken,
  phonesMatch,
  exchangeFirebasePhoneVerification,
  isPhoneVerificationDevMode,
} from "./flow/phone-verification.service.js";

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
export async function routeAuth(req, res, url, origin) {
  const authPath = url.pathname.replace(/^\/api\/v1\/auth\//, "/api/auth/");

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

  if (url.pathname === "/api/auth/password-policy" && req.method === "GET") {
    sendJson(res, origin, 200, { success: true, ...getPublicPasswordPolicyResponse() });
    return true;
  }

  if (url.pathname === "/api/auth/readiness" && req.method === "GET") {
    const readiness = await probeFirestoreReadiness(getDb());
    if (readiness.ok) {
      sendJson(res, origin, 200, { success: true, firestore: "ok" });
      return true;
    }
    sendJson(res, origin, readiness.status, {
      success: false,
      code: readiness.code,
      error: readiness.error,
    });
    return true;
  }

  if (url.pathname === "/api/auth/validate-password" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["password", "confirmPassword"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" }, req);
      return true;
    }

    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : undefined;
    const inputError = normalizePasswordInput(password);
    if (inputError) {
      sendJson(res, origin, 400, { success: false, valid: false, error: inputError }, req);
      return true;
    }
    const validation = validatePassword(password, {
      confirmPassword,
      requireConfirm: typeof confirmPassword === "string",
    });
    const requirements = {
      notBlocked: validation.analysis.requirements.notBlocked,
      notSimplePattern: validation.analysis.requirements.notSimplePattern,
    };

    if (!validation.valid) {
      sendJson(res, origin, 400, {
        success: false,
        valid: false,
        error: validation.error ?? "Password does not meet security requirements.",
        requirements,
      });
      return true;
    }

    sendJson(res, origin, 200, { success: true, valid: true, requirements });
    return true;
  }

  if (url.pathname === "/api/auth/firebase-config" && req.method === "GET") {
    const web = readFirebaseWebConfigFromEnv();
    if (!web.apiKey || !web.authDomain || !web.projectId || !web.appId) {
      sendJson(res, origin, 503, {
        success: false,
        error:
          "Firebase web app config is missing. In Firebase Console open project settings → Your apps → Add Web app, then run `npm run sync:firebase-local` in Backend/ or set FIREBASE_* in Backend/.env.",
      });
      return true;
    }
    const vapidPublicKey = getEnv().firebase.webPush.vapidPublicKey || null;
    sendJson(res, origin, 200, {
      success: true,
      config: web,
      phoneVerification: {
        mode: isPhoneVerificationDevMode() ? "dev" : "firebase",
        allowFirebaseInDev: isPhoneVerificationDevMode(),
      },
      ...(vapidPublicKey ? { webPush: { vapidPublicKey } } : {}),
    });
    return true;
  }

  if (url.pathname === "/api/auth/send-verification-email" && req.method === "POST") {
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
      const delivery = getEmailDeliveryConfig();
      const result = await sendEmailVerificationEmail({
        email,
        verificationLink,
        appPublicUrl: continueUrl,
      });

      if (result.sent) {
        console.info(`[auth/send-verification-email] Sent to ${email} via ${result.channel}`);
        sendJson(res, origin, 200, {
          success: true,
          sent: true,
          channel: result.channel,
        });
        return true;
      }

      if (!delivery.configured) {
        sendJson(res, origin, 503, {
          success: false,
          code: "EMAIL_NOT_CONFIGURED",
          sent: false,
          channel: result.channel,
          error:
            "Outbound email is not configured on the server. Use Firebase's built-in verification email or configure SMTP_* / RESEND_API_KEY in Backend/.env.",
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

  if (url.pathname === "/api/auth/verify" && req.method === "POST") {
    if (await enforceAuthAccessGuards(req, res, origin)) return true;
    const auth = getAuthAdmin();
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin is not configured; cannot verify tokens." });
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
      const db = getDb();
      const userRecord = await auth.getUser(decoded.uid);
      let profile = null;
      let memberId = undefined;
      let memberBootstrapSkipped = undefined;
      let memberData = null;

      if (db) {
        try {
          profile = await upsertProfileFromUserRecord(db, userRecord);
          const memberBootstrap = await ensureMemberLinkedRecordsForUserRecord(db, userRecord);
          memberId = memberBootstrap.memberId;
          memberBootstrapSkipped = memberBootstrap.skipped;
          const profileMustChange =
            profile &&
            typeof profile === "object" &&
            (profile.must_change_password === true || profile.mustChangePassword === true);
          if (!memberId && memberBootstrap.skipped !== "pending_auth") {
            logSafeWarn("[auth/verify] member bootstrap incomplete:", memberBootstrap);
          } else if (memberId && !profileMustChange) {
            await alignMemberRoleTables(db, memberId, decoded.uid);
            const memberSnap = await db.collection("members").doc(memberId).get();
            if (memberSnap.exists) {
              memberData = memberSnap.data() || null;
            }

            if (memberId && memberData) {
              const roleName = await resolveMemberRoleName(db, memberId);
              const gov = await enforceUnauthorizedPrivilegedRole(db, memberId, roleName, memberData, {
                requestIp: getRequestIp(req),
              });
              if (!gov.ok) {
                sendJson(res, origin, gov.status, {
                  success: false,
                  error: gov.error,
                  code: gov.code,
                });
                return true;
              }
            }

            // first-login notifications to team omitted in minimal auth backend
          }
        } catch (dbErr) {
          logSafeWarn("[auth/verify] Firestore operations failed:", dbErr);
          const quota = quotaErrorHttpResponse(dbErr);
          if (quota) {
            sendJson(res, origin, quota.status, quota.body);
            return true;
          }
          sendJson(res, origin, 503, {
            success: false,
            code: "SERVICE_UNAVAILABLE",
            error: "Unable to reach the database. The platform may be temporarily unavailable.",
          });
          return true;
        }
      }

      if (!profile) {
        profile = {
          uid: decoded.uid,
          primaryEmail: decoded.email || null,
          emailVerified: Boolean(decoded.email_verified),
          displayName: decoded.name || null,
          photoURL: decoded.picture || null,
          phoneNumber: decoded.phone_number || null,
          disabled: Boolean(userRecord.disabled),
          providers: decoded.firebase?.sign_in_provider ? [decoded.firebase.sign_in_provider] : [],
          identities: [],
        };
      }

      const authz = await validateSessionAuthorization({
        userRecord,
        memberId,
        memberData,
        profile,
        memberBootstrapSkipped,
        db,
      });
      if (!authz.ok) {
        sendJson(res, origin, authz.status, {
          success: false,
          error: authz.error,
          code: authz.code,
        });
        return true;
      }

      const profileMustChangeForAlert =
        profile &&
        typeof profile === "object" &&
        (profile.must_change_password === true || profile.mustChangePassword === true);
      if (db && !profileMustChangeForAlert) {
        try {
          const requestIp = getRequestIp(req);
          const { maybeNotifyNewSignIn, syncMemberLastLoginIp } = await import("./security-login-alerts.js");
          await maybeNotifyNewSignIn(db, {
            uid: decoded.uid,
            userRecord,
            profile,
            requestIp,
            userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "",
          });
          if (memberId) {
            await syncMemberLastLoginIp(db, memberId, requestIp);
          }
        } catch (alertErr) {
          logSafeWarn("[auth/verify] new sign-in alert failed:", alertErr);
        }
      }

      if (db && decoded.email_verified) {
        try {
          const { maybeSendRegistrationWelcomeEmail } = await import("./registration-welcome-email.js");
          void maybeSendRegistrationWelcomeEmail(db, auth, { uid: decoded.uid });
        } catch (welcomeErr) {
          logSafeWarn("[auth/verify] registration welcome email failed:", welcomeErr);
        }
      }

      sendJson(res, origin, 200, {
        success: true,
        authorized: true,
        user: { uid: decoded.uid, email: decoded.email || null, emailVerified: Boolean(decoded.email_verified) },
        profile,
        memberId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid or expired token";
      sendJson(res, origin, 401, { success: false, error: msg });
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
      rejectUnknownFields(body, ["firstName", "lastName", "email", "phone", "phoneVerificationToken"]);
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

  if (url.pathname === "/api/auth/resolve-sign-in-methods" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      rejectUnknownFields(body, ["email"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) {
      sendJson(res, origin, 400, { success: false, error: "A valid email is required." });
      return true;
    }
    assertMaxLength(email, 320, "email");
    if (await enforceAuthAccessGuards(req, res, origin, { email })) return true;

    const auth = getAuthAdmin();
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin is not configured." });
      return true;
    }
    try {
      const userRecord = await auth.getUserByEmail(email);
      const providerData = Array.isArray(userRecord.providerData) ? userRecord.providerData : [];
      const methods = [...new Set(providerData.map((p) => p.providerId).filter(Boolean))];
      const identities = providerData.map((p) => ({
        provider: p.providerId,
        identifier: p.email || p.phoneNumber || null,
      }));
      sendJson(res, origin, 200, {
        success: true,
        methods,
        identities,
      });
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String(/** @type {{ code?: string }} */ (e).code) : "";
      if (code === "auth/user-not-found") {
        // Uniform response shape — do not expose account existence via a `found` flag.
        sendJson(res, origin, 200, { success: true, methods: [], identities: [] });
        return true;
      }
      const msg = e instanceof Error ? e.message : "Lookup failed";
      sendJson(res, origin, 500, { success: false, error: msg });
    }
    return true;
  }

  if (url.pathname === "/api/auth/check-email" && req.method === "POST") {
    const db = getDb();
    if (!db) {
      sendJson(res, origin, 503, { success: false, error: "Database is not configured" });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["email", "idToken"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const authResult = await authenticateRequest(req, url, db);
    if (!authResult.ok) {
      sendJson(res, origin, authResult.status, { success: false, error: authResult.error });
      return true;
    }
    if (!requireManagementRole(authResult.context)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions." });
      return true;
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) {
      sendJson(res, origin, 400, { success: false, error: "A valid email is required." });
      return true;
    }
    assertMaxLength(email, 320, "email");
    try {
      const [byWorkEmail, byPersonalEmail] = await Promise.all([
        db.collection("members").where("work_email", "==", email).limit(1).get(),
        db.collection("members").where("personal_email", "==", email).limit(1).get(),
      ]);
      const exists = !byWorkEmail.empty || !byPersonalEmail.empty;
      sendJson(res, origin, 200, { success: true, exists });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Check failed";
      sendJson(res, origin, 500, { success: false, error: msg });
    }
    return true;
  }

  if (
    (url.pathname === "/api/auth/phone-verification/send" ||
      url.pathname === "/api/v1/auth/phone-verification/send") &&
    req.method === "POST"
  ) {
    const db = getDb();
    if (!db) {
      sendJson(res, origin, 503, { success: false, error: "Database is not configured" });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["phone"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const authResult = await authenticateRequest(req, url, db).catch(() => null);
      const result = await sendPhoneVerificationCode(db, body.phone, {
        uid: authResult?.ok ? authResult.context.uid : "",
        memberId: authResult?.ok ? authResult.context.memberId : "",
      });
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Failed to send code" });
    }
    return true;
  }

  if (
    (url.pathname === "/api/auth/phone-verification/confirm" ||
      url.pathname === "/api/v1/auth/phone-verification/confirm") &&
    req.method === "POST"
  ) {
    const db = getDb();
    if (!db) {
      sendJson(res, origin, 503, { success: false, error: "Database is not configured" });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["challengeId", "code"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const result = await confirmPhoneVerificationCode(db, body);
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Verification failed" });
    }
    return true;
  }

  if (
    (url.pathname === "/api/auth/phone-verification/exchange" ||
      url.pathname === "/api/v1/auth/phone-verification/exchange") &&
    req.method === "POST"
  ) {
    const db = getDb();
    const authAdmin = getAuthAdmin();
    if (!db || !authAdmin) {
      sendJson(res, origin, 503, { success: false, error: "Firebase Admin is not configured." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["idToken", "phone"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const authResult = await authenticateRequest(req, url, db).catch(() => null);
      const result = await exchangeFirebasePhoneVerification(db, authAdmin, {
        idToken: body.idToken,
        phone: body.phone,
        uid: authResult?.ok ? authResult.context.uid : "",
        memberId: authResult?.ok ? authResult.context.memberId : "",
      });
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Verification failed" });
    }
    return true;
  }

  if (url.pathname === "/api/auth/access-request" && req.method === "POST") {
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

  return false;
}
