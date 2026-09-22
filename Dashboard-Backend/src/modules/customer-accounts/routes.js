import { getAuthContext, requireAuthContext } from "../../http/auth-context.js";
import { isOwnerOrSuperAdminRole } from "../../http/role-hierarchy.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { sendJson } from "../../http/response.js";
import { logSafeError } from "../../http/sanitize-error.js";
import {
  assertUnlockRequestAllowed,
  issueUnlockCode,
  verifyUnlockCode,
} from "./verification-code.service.js";
import { issueUnlockToken, verifyUnlockToken } from "./unlock-token.js";
import { sendUnlockCodeEmail } from "./unlock-email.js";
import {
  CustomerAccountError,
  createCustomerTenant,
  listCustomerTenants,
  getCustomerTenantDetail,
  renewCustomerTenantPeriod,
  changeCustomerTenantSeats,
  getRemovalPreview,
  removeCustomerTenant,
  recordCustomerDataView,
} from "./tenant.service.js";

/**
 * §16.3: the verification code gates the SYSTEM, not the tab. Every
 * mutating endpoint below calls this - a valid session with no unlock token
 * can do nothing here, including by curl. Read endpoints (list/detail) are
 * intentionally NOT gated by this: US-1 gates opening the tab (the unlock
 * flow itself), and re-verifying on every GET would make the tab
 * unusable - the token protects the write surface, the role check plus the
 * unlock flow together protect the read surface.
 */
function requireUnlockToken(req, res, origin, memberId) {
  const token = req.headers["x-customer-accounts-unlock"];
  if (typeof token !== "string" || !verifyUnlockToken(token, memberId)) {
    sendJson(res, origin, 403, {
      success: false,
      error: "Verification required. Re-enter the code sent to your email.",
      code: "UNLOCK_REQUIRED",
    });
    return false;
  }
  return true;
}

function requireOwnerOrSuperAdmin(req, res, origin) {
  const viewer = requireAuthContext(req, res, origin);
  if (!viewer) return null;
  if (!isOwnerOrSuperAdminRole(viewer.roleName)) {
    // Backend rejects every other role, exactly as the spec requires -
    // there is no "you can see the tab but not use it" state.
    sendJson(res, origin, 403, { success: false, error: "Only Owners and Super Admins can access customer accounts." });
    return null;
  }
  return viewer;
}

function errorStatus(e) {
  if (e instanceof CustomerAccountError) return { status: e.status, code: e.code, message: e.message };
  return { status: 500, code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Unexpected error." };
}

export async function routeCustomerAccounts(req, res, url, origin) {
  const pn = url.pathname.replace(/^\/api\/v1/, "/api");
  if (!pn.startsWith("/api/customer-accounts")) return false;

  // US-1: the tab is visible only to Owners/Super Admins, and the backend
  // rejects every other role from every endpoint under this prefix -
  // checked once, here, rather than duplicated in each branch below.
  const viewer = requireOwnerOrSuperAdmin(req, res, origin);
  if (!viewer) return true;

  if (pn === "/api/customer-accounts/unlock/request" && req.method === "POST") {
    try {
      await assertUnlockRequestAllowed(viewer.memberId);
      const { code, expiresInMinutes } = await issueUnlockCode(viewer.memberId);
      if (!viewer.email) {
        sendJson(res, origin, 503, { success: false, error: "No email on file for this account." });
        return true;
      }
      const result = await sendUnlockCodeEmail({ email: viewer.email, code, expiresInMinutes });
      sendJson(res, origin, 200, {
        success: true,
        data: { sent: result.sent === true, expiresInMinutes },
      });
    } catch (e) {
      const { status, code, message } = errorStatus(e);
      if (status !== 429) logSafeError("[customer-accounts/unlock/request]", e);
      sendJson(res, origin, status, { success: false, error: message, code });
    }
    return true;
  }

  if (pn === "/api/customer-accounts/unlock/verify" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["code"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const result = await verifyUnlockCode(viewer.memberId, body.code);
      if (!result.ok) {
        sendJson(res, origin, 401, { success: false, error: result.error, attemptsRemaining: result.attemptsRemaining });
        return true;
      }
      const token = issueUnlockToken(viewer.memberId);
      sendJson(res, origin, 200, { success: true, data: { unlockToken: token } });
    } catch (e) {
      logSafeError("[customer-accounts/unlock/verify]", e);
      sendJson(res, origin, 500, { success: false, error: "Could not verify code." });
    }
    return true;
  }

  // US-5: list + read-only detail. Gated by role only (above), not the
  // unlock token - see requireUnlockToken's own comment for why.
  if (pn === "/api/customer-accounts" && req.method === "GET") {
    try {
      const rows = await listCustomerTenants();
      sendJson(res, origin, 200, { success: true, data: rows });
    } catch (e) {
      logSafeError("[customer-accounts/list]", e);
      sendJson(res, origin, 500, { success: false, error: "Could not load customer accounts." });
    }
    return true;
  }

  if (pn === "/api/customer-accounts" && req.method === "POST") {
    if (!requireUnlockToken(req, res, origin, viewer.memberId)) return true;
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["email", "periodEnd", "seats", "role"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const appOrigin = req.headers.origin;
      const result = await createCustomerTenant({
        email: body.email,
        periodEnd: body.periodEnd,
        seatLimit: body.seats,
        grantedRole: body.role,
        actorId: viewer.memberId,
        appOrigin: typeof appOrigin === "string" ? appOrigin : "",
      });
      sendJson(res, origin, 201, { success: true, data: result });
    } catch (e) {
      const { status, code, message } = errorStatus(e);
      if (status === 500) logSafeError("[customer-accounts/create]", e);
      sendJson(res, origin, status, { success: false, error: message, code });
    }
    return true;
  }

  const detailMatch = pn.match(/^\/api\/customer-accounts\/([^/]+)$/);
  if (detailMatch && req.method === "GET") {
    const tenantId = detailMatch[1];
    try {
      const detail = await getCustomerTenantDetail(tenantId);
      // US-5, §9: every Owner/Super Admin open of a customer's account
      // detail is audited.
      await recordCustomerDataView(tenantId, viewer.memberId, "account_detail");
      sendJson(res, origin, 200, { success: true, data: detail });
    } catch (e) {
      const { status, code, message } = errorStatus(e);
      if (status === 500) logSafeError("[customer-accounts/detail]", e);
      sendJson(res, origin, status, { success: false, error: message, code });
    }
    return true;
  }

  const periodMatch = pn.match(/^\/api\/customer-accounts\/([^/]+)\/period$/);
  if (periodMatch && req.method === "PATCH") {
    if (!requireUnlockToken(req, res, origin, viewer.memberId)) return true;
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["periodEnd"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const result = await renewCustomerTenantPeriod(periodMatch[1], body.periodEnd, viewer.memberId);
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      const { status, code, message } = errorStatus(e);
      if (status === 500) logSafeError("[customer-accounts/period]", e);
      sendJson(res, origin, status, { success: false, error: message, code });
    }
    return true;
  }

  const seatsMatch = pn.match(/^\/api\/customer-accounts\/([^/]+)\/seats$/);
  if (seatsMatch && req.method === "PATCH") {
    if (!requireUnlockToken(req, res, origin, viewer.memberId)) return true;
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["seats"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const result = await changeCustomerTenantSeats(seatsMatch[1], body.seats, viewer.memberId);
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      const { status, code, message } = errorStatus(e);
      if (status === 500) logSafeError("[customer-accounts/seats]", e);
      sendJson(res, origin, status, { success: false, error: message, code });
    }
    return true;
  }

  const removalPreviewMatch = pn.match(/^\/api\/customer-accounts\/([^/]+)\/removal-preview$/);
  if (removalPreviewMatch && req.method === "GET") {
    try {
      const preview = await getRemovalPreview(removalPreviewMatch[1]);
      sendJson(res, origin, 200, { success: true, data: preview });
    } catch (e) {
      const { status, code, message } = errorStatus(e);
      if (status === 500) logSafeError("[customer-accounts/removal-preview]", e);
      sendJson(res, origin, status, { success: false, error: message, code });
    }
    return true;
  }

  if (detailMatch && req.method === "DELETE") {
    if (!requireUnlockToken(req, res, origin, viewer.memberId)) return true;
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["confirmEmail"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const result = await removeCustomerTenant(detailMatch[1], viewer.memberId, { confirmEmail: body.confirmEmail });
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      const { status, code, message } = errorStatus(e);
      if (status === 500) logSafeError("[customer-accounts/remove]", e);
      sendJson(res, origin, status, { success: false, error: message, code });
    }
    return true;
  }

  sendJson(res, origin, 404, { success: false, error: "Not found" });
  return true;
}
