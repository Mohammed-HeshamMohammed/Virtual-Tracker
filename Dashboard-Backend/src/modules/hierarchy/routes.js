import { getDb } from "../../config/firebase.js";
import { getAuthContext } from "../../http/auth-context.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { sendJson } from "../../http/response.js";
import { auditHierarchyViolations } from "./hierarchy-audit.js";
import { repairOrphanHierarchyMembers } from "./hierarchy-repair.js";
import { syncMemberHierarchyStatus } from "./hierarchy-sync.js";
import {
  acceptMemberTransferRequest,
  createMemberTransferRequest,
  declineMemberTransferRequest,
  getTransferRequestPreview,
} from "./transfer-request.service.js";

function normalizePathname(pathname) {
  return pathname.replace(/^\/api\/v1\//, "/api/");
}

/**
 * Owner / Super Admin / Admin — hierarchy management operations.
 */
function assertHierarchyAdminRole(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }
  const role = String(viewer.roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (role !== "owner" && role !== "superadmin" && role !== "admin") {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions." });
    return false;
  }
  return true;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeMemberTransferRequests(req, res, url, origin) {
  const db = getDb();
  if (!db) return false;

  const pn = normalizePathname(url.pathname);

  // GET /api/public/member-transfer-requests/:token — preview (no auth)
  const publicPreviewMatch = pn.match(/^\/api\/public\/member-transfer-requests\/([^/]+)$/);
  if (publicPreviewMatch && req.method === "GET") {
    try {
      const result = await getTransferRequestPreview(db, publicPreviewMatch[1]);
      if (!result.ok) {
        sendJson(res, origin, result.httpStatus || 400, { success: false, error: result.error });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to load invitation." });
    }
    return true;
  }

  // POST /api/public/member-transfer-requests/:token/accept — requires auth
  const publicAcceptMatch = pn.match(/^\/api\/public\/member-transfer-requests\/([^/]+)\/accept$/);
  if (publicAcceptMatch && req.method === "POST") {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }
    try {
      const result = await acceptMemberTransferRequest(db, {
        token: publicAcceptMatch[1],
        acceptorMemberId: viewer.memberId,
        acceptorEmail: viewer.email || "",
      });
      if (!result.ok) {
        sendJson(res, origin, result.httpStatus || 400, { success: false, error: result.error });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Accept failed." });
    }
    return true;
  }

  // POST /api/public/member-transfer-requests/:token/decline — requires auth
  const publicDeclineMatch = pn.match(/^\/api\/public\/member-transfer-requests\/([^/]+)\/decline$/);
  if (publicDeclineMatch && req.method === "POST") {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }
    try {
      const result = await declineMemberTransferRequest(db, {
        token: publicDeclineMatch[1],
        declinerMemberId: viewer.memberId,
      });
      if (!result.ok) {
        sendJson(res, origin, result.httpStatus || 400, { success: false, error: result.error });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Decline failed." });
    }
    return true;
  }

  // POST /api/member-transfer-requests — create request
  if (pn === "/api/member-transfer-requests" && req.method === "POST") {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const targetEmail = typeof body.target_email === "string" ? body.target_email : "";
    const appOrigin = typeof origin === "string" ? origin : undefined;
    try {
      const result = await createMemberTransferRequest(db, {
        requesterMemberId: viewer.memberId,
        requesterRoleName: viewer.roleName || "",
        targetEmail,
        appOrigin,
      });
      if (!result.ok) {
        sendJson(res, origin, result.httpStatus || 400, { success: false, error: result.error });
        return true;
      }
      sendJson(res, origin, 201, { success: true, data: result });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to create transfer request." });
    }
    return true;
  }

  // GET /api/member-relationships/audit — hierarchy audit (admin)
  if (pn === "/api/member-relationships/audit" && req.method === "GET") {
    if (!assertHierarchyAdminRole(req, res, origin)) return true;
    try {
      const dryRun = url.searchParams.get("dry_run") !== "false";
      const report = await auditHierarchyViolations(db);
      sendJson(res, origin, 200, { success: true, data: { ...report, dry_run: dryRun } });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Audit failed." });
    }
    return true;
  }

  // POST /api/member-relationships/repair-orphans — fix orphan employees (admin)
  if (pn === "/api/member-relationships/repair-orphans" && req.method === "POST") {
    if (!assertHierarchyAdminRole(req, res, origin)) return true;
    const viewer = getAuthContext(req);
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
    const strategy = body.strategy === "downgrade_to_viewer" ? "downgrade_to_viewer" : "assign_to_owner";
    const dryRun = body.dry_run !== false;
    try {
      const result = await repairOrphanHierarchyMembers(db, {
        strategy,
        dryRun,
        actorMemberId: viewer?.memberId || "system",
      });
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Orphan repair failed." });
    }
    return true;
  }

  // POST /api/member-relationships/repair-status — sync hierarchy_status fields (admin)
  if (pn === "/api/member-relationships/repair-status" && req.method === "POST") {
    if (!assertHierarchyAdminRole(req, res, origin)) return true;
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
    const dryRun = body.dry_run !== false;
    try {
      const report = await auditHierarchyViolations(db);
      if (dryRun) {
        sendJson(res, origin, 200, {
          success: true,
          data: { dry_run: true, would_update: report.violations.length, report },
        });
        return true;
      }
      const { resolveMemberRoleName } = await import("../activity/activity-scope.js");
      let updated = 0;
      for (const item of report.summary) {
        const roleName = item.role_name;
        const status = await syncMemberHierarchyStatus(db, item.member_id, roleName);
        if (status) updated += 1;
      }
      sendJson(res, origin, 200, { success: true, data: { updated, report } });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Repair failed." });
    }
    return true;
  }

  return false;
}
