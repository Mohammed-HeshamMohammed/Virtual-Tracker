import { getAuthAdmin, getDb } from "../../config/firebase.js";
import { readIdToken } from "../../http/auth-token.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { sendJson } from "../../http/response.js";
import { getRequestIp } from "../../http/request-ip.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { quotaErrorHttpResponse } from "../../http/quota-error.js";
import { assertDeviceNotBanned, assertMemberNotBanned } from "../members/services/member-ban-service.js";
import { ensureMemberLinkedRecordsForUserRecord } from "../members/services/ensure-member-linked-records.js";
import { alignMemberRoleTables } from "../members/services/relation-sync.js";
import { enforceUnauthorizedPrivilegedRole } from "../members/services/privileged-role-governance.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { upsertProfileFromUserRecord } from "./profile-sync.js";
import { validateSessionAuthorization } from "./session-authorization.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {URL} url
 * @returns {Promise<boolean>}
 */
export async function handleSessionBootstrap(req, res, origin, url) {
  const authPath = url.pathname.replace(/^\/api\/v1\/auth\//, "/api/auth/");
  if (authPath !== "/api/auth/session-bootstrap" || req.method !== "POST") {
    return false;
  }

  const db = getDb();
  if (!db) {
    sendJson(res, origin, 503, { success: false, error: "Firestore is not configured" });
    return true;
  }

  const deviceGate = await assertDeviceNotBanned(db, getRequestIp(req));
  if (!deviceGate.ok) {
    sendJson(res, origin, deviceGate.status, {
      success: false,
      error: deviceGate.error,
      code: deviceGate.code,
    });
    return true;
  }

  const auth = getAuthAdmin();
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

  const idToken = readIdToken(req, url, body);
  if (!idToken) {
    sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
    return true;
  }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    const userRecord = await auth.getUser(decoded.uid);
    const email = typeof userRecord.email === "string" ? userRecord.email.trim().toLowerCase() : "";
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

    let profile = null;
    let memberId = undefined;
    let memberBootstrapSkipped = undefined;
    let memberData = null;

    const bootstrapMemberSession = async () => {
      profile = await upsertProfileFromUserRecord(db, userRecord);
      const memberBootstrap = await ensureMemberLinkedRecordsForUserRecord(db, userRecord);
      memberId = memberBootstrap.memberId;
      memberBootstrapSkipped = memberBootstrap.skipped;
      memberData = null;
      const profileMustChange =
        profile &&
        typeof profile === "object" &&
        (profile.must_change_password === true || profile.mustChangePassword === true);
      if (!memberId && memberBootstrap.skipped !== "pending_auth") {
        logSafeWarn("[session-bootstrap] member bootstrap incomplete:", memberBootstrap);
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
            const gateErr = new Error(gov.error || "Access restricted");
            gateErr.status = gov.status;
            gateErr.code = gov.code;
            throw gateErr;
          }
        }

        try {
          const { maybeNotifyTeamMemberFirstLogin } = await import("../notifications/first-login-notify.js");
          await maybeNotifyTeamMemberFirstLogin(db, {
            memberId,
            memberData: memberData || {},
            profile,
            userRecord,
          });
        } catch (notifyErr) {
          logSafeWarn("[session-bootstrap] failed to notify team of first login:", notifyErr);
        }
      }
    };

    try {
      try {
        await bootstrapMemberSession();
      } catch (firstErr) {
        if (firstErr && typeof firstErr === "object" && "status" in firstErr) {
          throw firstErr;
        }
        logSafeWarn("[session-bootstrap] bootstrap attempt 1 failed, retrying:", firstErr);
        await new Promise((resolve) => setTimeout(resolve, 400));
        profile = null;
        memberId = undefined;
        memberBootstrapSkipped = undefined;
        memberData = null;
        await bootstrapMemberSession();
      }
    } catch (dbErr) {
      if (dbErr && typeof dbErr === "object" && "status" in dbErr && "code" in dbErr) {
        sendJson(res, origin, Number(dbErr.status) || 403, {
          success: false,
          error: dbErr instanceof Error ? dbErr.message : "Access restricted",
          code: String(dbErr.code),
        });
        return true;
      }
      logSafeWarn("[session-bootstrap] Firestore operations failed:", dbErr);
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
    if (!profileMustChangeForAlert) {
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
        logSafeWarn("[session-bootstrap] new sign-in alert failed:", alertErr);
      }
    }

    if (decoded.email_verified) {
      try {
        const { maybeSendRegistrationWelcomeEmail } = await import("./registration-welcome-email.js");
        void maybeSendRegistrationWelcomeEmail(db, auth, { uid: decoded.uid });
      } catch (welcomeErr) {
        logSafeWarn("[session-bootstrap] registration welcome email failed:", welcomeErr);
      }
    }

    sendJson(res, origin, 200, {
      success: true,
      authorized: true,
      profile,
      memberId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid or expired token";
    sendJson(res, origin, 401, { success: false, error: msg });
  }
  return true;
}
