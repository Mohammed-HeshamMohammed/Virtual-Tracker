import { requireAuthContext } from "../../../http/auth-context.js";
import { assertBanManagementRole } from "../../../http/member-ban-policy.js";
import { readJsonBody } from "../../../http/read-json-body.js";
import { rejectUnknownFields, assertMaxLength } from "../../../http/validate-body.js";
import { sendJson } from "../../../http/response.js";
import { getRequestIp } from "../../../http/request-ip.js";
import { logSafeError } from "../../../http/sanitize-error.js";
import {
  banMember,
  listActiveMemberBans,
  revokeMemberBan,
} from "../services/member-ban-service.js";
import { getMemberByIdPg } from "../../../lib/postgres/members-postgres.service.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeMemberBans(req, res, url, origin) {
  const pn = url.pathname.replace(/^\/api\/v1/, "/api");

  if (pn === "/api/member-bans" && req.method === "GET") {
    if (!assertBanManagementRole(req, res, origin)) return true;
    try {
      const { getDb } = await import("../../../config/firebase.js");
      const db = getDb();
      if (!db) {
        sendJson(res, origin, 503, { success: false, error: "Database is not configured." });
        return true;
      }
      const bans = await listActiveMemberBans(db);
      sendJson(res, origin, 200, { success: true, data: bans });
    } catch (e) {
      logSafeError("[member-bans/list]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load bans." });
    }
    return true;
  }

  if (pn === "/api/member-bans" && req.method === "POST") {
    if (!assertBanManagementRole(req, res, origin)) return true;
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["memberId", "reason"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    try {
      assertMaxLength(reason, 2000, "reason");
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid reason" });
      return true;
    }
    try {
      const { getDb } = await import("../../../config/firebase.js");
      const db = getDb();
      if (!db) {
        sendJson(res, origin, 503, { success: false, error: "Database is not configured." });
        return true;
      }
      const viewerData = (await getMemberByIdPg(viewer.memberId)) || {};
      const viewerFirst = typeof viewerData.first_name === "string" ? viewerData.first_name.trim() : "";
      const viewerLast = typeof viewerData.last_name === "string" ? viewerData.last_name.trim() : "";
      const bannedByName =
        (typeof viewerData.name === "string" && viewerData.name.trim()) ||
        [viewerFirst, viewerLast].filter(Boolean).join(" ").trim() ||
        viewer.email ||
        "Administrator";
      const result = await banMember(db, {
        memberId,
        reason,
        bannedByMemberId: viewer.memberId,
        bannedByName,
        requestIp: getRequestIp(req),
      });
      sendJson(res, origin, 201, { success: true, data: result });
    } catch (e) {
      const status = typeof e === "object" && e !== null && "status" in e ? Number(e.status) || 500 : 500;
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to ban member.",
      });
    }
    return true;
  }

  const revokeMatch = pn.match(/^\/api\/member-bans\/([^/]+)\/revoke$/);
  if (revokeMatch && req.method === "POST") {
    if (!assertBanManagementRole(req, res, origin)) return true;
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const banId = decodeURIComponent(revokeMatch[1]);
    try {
      const { getDb } = await import("../../../config/firebase.js");
      const db = getDb();
      if (!db) {
        sendJson(res, origin, 503, { success: false, error: "Database is not configured." });
        return true;
      }
      const result = await revokeMemberBan(db, {
        banId,
        revokedByMemberId: viewer.memberId,
        revokedByName: viewer.email || "Administrator",
      });
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      const status = typeof e === "object" && e !== null && "status" in e ? Number(e.status) || 500 : 500;
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to revoke ban.",
      });
    }
    return true;
  }

  return false;
}
