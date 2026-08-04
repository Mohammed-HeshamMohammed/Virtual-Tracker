import crypto from "node:crypto";
import { getEnv } from "../../config/env.js";
import { readFirebaseWebConfigFromEnv } from "../../config/firebase.js";
import { getSecurityHeaders } from "../../http/security-headers.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

// Kept inside agent_link_sessions' 15-minute TTL (agent-link-sessions.js,
// Dashboard-Backend) so a state token never outlives the link session it's
// tied to.
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Stateless CSRF-state token for the OAuth round trip: Auth-Backend has no
 * database of its own to hold a server-side nonce in (see agent_link_sessions
 * for the DB-backed equivalent this deliberately avoids needing), so the
 * `linkToken` + expiry are carried in the state itself, HMAC-signed so
 * Google's redirect can't be replayed with a forged/expired payload.
 * @param {string} linkToken
 */
function signState(linkToken) {
  const payload = JSON.stringify({ linkToken, exp: Date.now() + STATE_TTL_MS });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getEnv().googleOAuth.stateSecret).update(payloadB64).digest();
  return `${payloadB64}.${sig.toString("base64url")}`;
}

/**
 * @param {string} state
 * @returns {{ linkToken: string } | null}
 */
function verifyState(state) {
  if (typeof state !== "string" || !state) return null;
  const dot = state.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = state.slice(0, dot);
  const sigB64 = state.slice(dot + 1);
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto.createHmac("sha256", getEnv().googleOAuth.stateSecret).update(payloadB64).digest();
  let providedSig;
  try {
    providedSig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length || !crypto.timingSafeEqual(providedSig, expectedSig)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.linkToken !== "string" || !payload.linkToken) return null;
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  return { linkToken: payload.linkToken };
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {import("node:http").IncomingMessage} req
 * @param {string} location
 */
function redirect(res, req, location) {
  res.writeHead(302, { Location: location, ...getSecurityHeaders(req) });
  res.end();
}

/**
 * Exchange a Google authorization `code` for a Firebase ID token, via the
 * Identity Toolkit REST API directly (same pattern as
 * Dashboard-Backend's verifyCurrentPasswordWithFirebaseWebApi) — no Firebase
 * client SDK involved, this runs entirely server-side.
 * @param {string} code
 */
async function exchangeGoogleCodeForFirebaseTokens(code) {
  const { clientId, clientSecret, redirectUri } = getEnv().googleOAuth;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`google_token_exchange_failed:${tokenRes.status}`);
  }
  const tokenData = await tokenRes.json();
  const googleIdToken = typeof tokenData?.id_token === "string" ? tokenData.id_token : "";
  if (!googleIdToken) {
    throw new Error("google_token_exchange_missing_id_token");
  }

  const web = readFirebaseWebConfigFromEnv();
  if (!web.apiKey) {
    throw new Error("firebase_web_api_key_not_configured");
  }
  const idpRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(web.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
        requestUri: redirectUri,
        returnSecureToken: true,
      }),
    },
  );
  if (!idpRes.ok) {
    throw new Error(`firebase_idp_exchange_failed:${idpRes.status}`);
  }
  const idpData = await idpRes.json();
  const idToken = typeof idpData?.idToken === "string" ? idpData.idToken : "";
  const refreshToken = typeof idpData?.refreshToken === "string" ? idpData.refreshToken : "";
  if (!idToken) {
    throw new Error("firebase_idp_exchange_missing_id_token");
  }
  return { idToken, refreshToken };
}

/**
 * Completes the same desktop-agent link session the browser-driven flow
 * completes in Dashboard-Web's agent-link-flow.tsx (`completeAgentLink` →
 * `POST /api/activity/agent/link/complete`) — server-to-server here instead
 * of from the browser tab. That endpoint verifies the Bearer ID token itself
 * and doesn't care whether it was minted by the Firebase client SDK or, as
 * here, by the Identity Toolkit REST API.
 * @param {string} linkToken
 * @param {string} idToken
 * @param {string} refreshToken
 */
async function completeDesktopAgentLink(linkToken, idToken, refreshToken) {
  const dashboardApiUrl = getEnv().urls.dashboardApiUrl;
  if (!dashboardApiUrl) {
    throw new Error("dashboard_api_url_not_configured");
  }
  const res = await fetch(`${dashboardApiUrl}/api/activity/agent/link/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ linkToken, refreshToken, source: "tauri" }),
  });
  if (!res.ok) {
    throw new Error(`link_complete_failed:${res.status}`);
  }
}

/** `/api/auth/google/*` routes — the desktop agent's direct-to-Google sign-in. @returns {Promise<boolean>} */
export async function routeGoogleOAuth(req, res, url) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");
  const frontendOrigin = getEnv().urls.frontendOrigin.replace(/\/$/, "");

  if (pn === "/api/auth/google/start" && req.method === "GET") {
    const linkToken = (url.searchParams.get("link") || "").trim();
    const { clientId, redirectUri, stateSecret } = getEnv().googleOAuth;
    if (!linkToken) {
      redirect(res, req, `${frontendOrigin}/?agentLinkError=missing_link`);
      return true;
    }
    if (!clientId || !redirectUri || !stateSecret) {
      logSafeWarn("google-oauth", "start requested but GOOGLE_OAUTH_CLIENT_ID/REDIRECT_URI/STATE_SECRET are not configured");
      redirect(res, req, `${frontendOrigin}/?agentLinkError=not_configured`);
      return true;
    }
    const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "openid email profile");
    authorizeUrl.searchParams.set("state", signState(linkToken));
    authorizeUrl.searchParams.set("prompt", "select_account");
    authorizeUrl.searchParams.set("access_type", "online");
    redirect(res, req, authorizeUrl.toString());
    return true;
  }

  if (pn === "/api/auth/google/callback" && req.method === "GET") {
    if (url.searchParams.get("error")) {
      redirect(res, req, `${frontendOrigin}/?agentLinkError=cancelled`);
      return true;
    }
    const code = url.searchParams.get("code") || "";
    const verified = verifyState(url.searchParams.get("state") || "");
    if (!code || !verified) {
      redirect(res, req, `${frontendOrigin}/?agentLinkError=expired`);
      return true;
    }
    try {
      const { idToken, refreshToken } = await exchangeGoogleCodeForFirebaseTokens(code);
      await completeDesktopAgentLink(verified.linkToken, idToken, refreshToken);
      redirect(res, req, `${frontendOrigin}/?agentLinked=1`);
    } catch (e) {
      logSafeWarn("google-oauth", e);
      redirect(res, req, `${frontendOrigin}/?agentLinkError=failed`);
    }
    return true;
  }

  return false;
}

/** @internal exported for tests only */
export const __test__ = { signState, verifyState };
