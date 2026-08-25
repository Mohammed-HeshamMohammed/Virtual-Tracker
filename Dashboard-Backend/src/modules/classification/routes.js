import { requireAuthContext, isManagementRole } from "../../http/auth-context.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { sendJson } from "../../http/response.js";
import { logSafeError } from "../../http/sanitize-error.js";
import {
  getAllCategories,
  setCategory,
  removeCategory,
  getUnclassifiedReviewQueue,
  canClassifyActivity,
  CLASSIFY_DENIED_MESSAGE,
} from "./activity-categories.js";
import { getFocusedTimeSummary } from "./focused-time.js";

const ERROR_STATUS = {
  INVALID_MATCH_TYPE: 400,
  PATTERN_REQUIRED: 400,
  UNKNOWN_CATEGORY: 400,
  FORBIDDEN: 403,
};

/**
 * CLS-1 classification map. Reading is open to any authenticated member -
 * this is productivity labelling, not sensitive compliance data, and the
 * (future) dashboard views showing "productive/neutral/distracting minutes"
 * need it. Writing is management-only.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeClassification(req, res, url, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");
  if (!pn.startsWith("/api/classification")) return false;

  if (pn === "/api/classification/categories" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      sendJson(res, origin, 200, { success: true, data: await getAllCategories() });
    } catch (e) {
      logSafeError("[classification/categories GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load classification map." });
    }
    return true;
  }

  // CLS-2: "productive/neutral/distracting minutes" for one member over a
  // day range. Self-service, or management for another member - same
  // pattern as CF-5's DSAR export.
  if (pn === "/api/classification/focused-time" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const requestedId = url.searchParams.get("memberId") || viewer.memberId;
    if (requestedId !== viewer.memberId && !isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may view another member's focused time." });
      return true;
    }
    const fromDay = url.searchParams.get("fromDay");
    const toDay = url.searchParams.get("toDay");
    if (!fromDay || !toDay) {
      sendJson(res, origin, 400, { success: false, error: "fromDay and toDay are required (YYYY-MM-DD)." });
      return true;
    }
    try {
      sendJson(res, origin, 200, {
        success: true,
        data: await getFocusedTimeSummary(requestedId, { fromDay, toDay }),
      });
    } catch (e) {
      logSafeError("[classification/focused-time GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to compute focused time." });
    }
    return true;
  }

  if (pn === "/api/classification/categories" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!canClassifyActivity(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: CLASSIFY_DENIED_MESSAGE });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const updated = await setCategory(
        {
          matchType: String(body.matchType ?? ""),
          pattern: String(body.pattern ?? ""),
          category: typeof body.category === "string" ? body.category : undefined,
          displayName: typeof body.displayName === "string" ? body.displayName : undefined,
          roleOverride: body.roleOverride && typeof body.roleOverride === "object" ? body.roleOverride : undefined,
        },
        { memberId: viewer.memberId, roleName: viewer.roleName },
      );
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      const status = (e && ERROR_STATUS[/** @type {{code?:string}} */ (e).code]) || 500;
      if (status === 500) logSafeError("[classification/categories POST]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to update classification.",
      });
    }
    return true;
  }

  if (pn.startsWith("/api/classification/categories/") && req.method === "DELETE") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!canClassifyActivity(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: CLASSIFY_DENIED_MESSAGE });
      return true;
    }
    const id = pn.slice("/api/classification/categories/".length).split("/")[0];
    try {
      await removeCategory(id, { memberId: viewer.memberId, roleName: viewer.roleName });
      sendJson(res, origin, 200, { success: true, data: null });
    } catch (e) {
      const status = (e && ERROR_STATUS[/** @type {{code?:string}} */ (e).code]) || 500;
      if (status === 500) logSafeError("[classification/categories DELETE]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to remove classification.",
      });
    }
    return true;
  }

  // CLS-3: manager review queue - management-only, since deciding what to
  // classify is a management action (writes go through the existing POST
  // /categories route above once a decision is made).
  if (pn === "/api/classification/review-queue" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    // Same set as the writes: this list exists to feed the classify dialog,
    // and there is no point showing it to someone who cannot act on it.
    if (!canClassifyActivity(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: CLASSIFY_DENIED_MESSAGE });
      return true;
    }
    const sinceDays = Number(url.searchParams.get("sinceDays")) || undefined;
    const limit = Number(url.searchParams.get("limit")) || undefined;
    try {
      sendJson(res, origin, 200, { success: true, data: await getUnclassifiedReviewQueue(sinceDays, limit) });
    } catch (e) {
      logSafeError("[classification/review-queue GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load review queue." });
    }
    return true;
  }

  return false;
}
