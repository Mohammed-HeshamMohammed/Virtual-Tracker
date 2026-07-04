import { getAuthAdmin, getDb } from "../../config/firebase.js";
import { readIdToken } from "../../http/auth-token.js";
import { corsHeaders } from "../../http/cors.js";
import { getSecurityHeaders } from "../../http/security-headers.js";
import { sendToMember } from "../presence/index.js";
import { resolveMemberIdForUid } from "../members/services/member-presence.service.js";
import {
  buildSessionCookieHeader,
  buildClearSessionCookieHeader,
  readSessionCookie,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "./session-cookie.js";

/**
 * @param {import("node:http").ServerResponse} res
 * @param {import("node:http").IncomingMessage} req
 * @param {string|undefined} origin
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string,string>} [extraHeaders]
 */
function sendCredentialedJson(res, req, origin, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(origin, { credentials: true }),
    ...getSecurityHeaders(req),
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

/** Sign-out everywhere: revoke refresh tokens + WS push to open tabs. */
async function forceSignOutEverywhere(req) {
  const auth = getAuthAdmin();
  const cookie = readSessionCookie(req);
  if (!auth || !cookie) return;
  try {
    const decoded = await auth.verifySessionCookie(cookie, true);
    await auth.revokeRefreshTokens(decoded.uid);
    const db = getDb();
    if (db) {
      const memberId = await resolveMemberIdForUid(db, decoded.uid);
      if (memberId) sendToMember(memberId, { type: "force-sign-out" });
    }
  } catch {
    /* invalid/expired cookie — nothing to revoke */
  }
}

// Session cookie routes — landing↔dashboard sign-in hint only; API auth stays Bearer.
export async function routeSessionCookie(req, res, url, origin) {
  const authPath = url.pathname.replace(/^\/api\/v1\/auth\//, "/api/auth/");

  if (authPath === "/api/auth/session-cookie" && req.method === "POST") {
    const auth = getAuthAdmin();
    if (!auth) {
      sendCredentialedJson(res, req, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }
    const idToken = readIdToken(req, url, {});
    if (!idToken) {
      sendCredentialedJson(res, req, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const sessionCookie = await auth.createSessionCookie(idToken, {
        expiresIn: SESSION_COOKIE_MAX_AGE_SECONDS * 1000,
      });
      sendCredentialedJson(res, req, origin, 200, { success: true }, {
        "Set-Cookie": buildSessionCookieHeader(sessionCookie),
      });
    } catch {
      sendCredentialedJson(res, req, origin, 401, { success: false, error: "Could not create session." });
    }
    return true;
  }

  if (authPath === "/api/auth/session-status" && req.method === "GET") {
    const auth = getAuthAdmin();
    const cookie = readSessionCookie(req);
    if (!auth || !cookie) {
      sendCredentialedJson(res, req, origin, 200, { success: true, signedIn: false });
      return true;
    }
    try {
      const decoded = await auth.verifySessionCookie(cookie, true);
      sendCredentialedJson(res, req, origin, 200, {
        success: true,
        signedIn: true,
        displayName: typeof decoded.name === "string" ? decoded.name : null,
        avatarUrl: typeof decoded.picture === "string" ? decoded.picture : null,
      });
    } catch {
      sendCredentialedJson(res, req, origin, 200, { success: true, signedIn: false });
    }
    return true;
  }

  if (authPath === "/api/auth/session-logout" && req.method === "POST") {
    await forceSignOutEverywhere(req);
    sendCredentialedJson(res, req, origin, 200, { success: true }, {
      "Set-Cookie": buildClearSessionCookieHeader(),
    });
    return true;
  }

  return false;
}
