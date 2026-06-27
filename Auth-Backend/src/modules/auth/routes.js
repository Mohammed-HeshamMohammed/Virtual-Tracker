import { getAuthAdmin, readFirebaseWebConfigFromEnv } from "../../config/firebase.js";
import { readIdToken } from "../../http/auth-token.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { assertMaxLength, rejectUnknownFields } from "../../http/validate-body.js";
import { sendJson } from "../../http/response.js";
import { validatePassword, getPublicPasswordPolicyResponse } from "../../config/password-policy/index.js";
import { normalizePasswordInput } from "../../http/password-request-guard.js";

/** Intentional Cache-Control overrides — win over security-headers `no-store` via sendJson extraHeaders. */
const CACHE_FIREBASE_CONFIG = "public, max-age=3600";
const CACHE_PASSWORD_POLICY = "public, max-age=0, stale-while-revalidate=3600";

/**
 * Authentication-only HTTP routes (`/api/auth/*` subset).
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeAuth(req, res, url, origin) {
  const authPath = url.pathname.replace(/^\/api\/v1\/auth\//, "/api/auth/");

  if (url.pathname === "/api/auth/password-policy" && req.method === "GET") {
    sendJson(res, origin, 200, { success: true, ...getPublicPasswordPolicyResponse() }, req, {
      "Cache-Control": CACHE_PASSWORD_POLICY,
    });
    return true;
  }

  if (url.pathname === "/api/auth/readiness" && req.method === "GET") {
    const auth = getAuthAdmin();
    if (!auth) {
      sendJson(res, origin, 503, {
        success: false,
        code: "SERVICE_UNAVAILABLE",
        error: "Firebase Admin is not configured.",
      });
      return true;
    }
    sendJson(res, origin, 200, { success: true, firebase: "ok" });
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
          "Firebase web app config is missing. In Firebase Console open project settings → Your apps → Add Web app, then set FIREBASE_* in .env or provide firebase-web.local.json.",
      });
      return true;
    }
    sendJson(res, origin, 200, { success: true, config: web }, req, {
      "Cache-Control": CACHE_FIREBASE_CONFIG,
    });
    return true;
  }

  if (url.pathname === "/api/auth/verify" && req.method === "POST") {
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
      sendJson(res, origin, 200, {
        success: true,
        user: {
          uid: decoded.uid,
          email: decoded.email || null,
          emailVerified: Boolean(decoded.email_verified),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid or expired token";
      sendJson(res, origin, 401, { success: false, error: msg });
    }
    return true;
  }

  if (url.pathname === "/api/auth/resolve-sign-in-methods" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
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
      sendJson(res, origin, 200, { success: true, methods, identities });
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String(/** @type {{ code?: string }} */ (e).code) : "";
      if (code === "auth/user-not-found") {
        sendJson(res, origin, 200, { success: true, methods: [], identities: [] });
        return true;
      }
      const msg = e instanceof Error ? e.message : "Lookup failed";
      sendJson(res, origin, 500, { success: false, error: msg });
    }
    return true;
  }

  return false;
}
