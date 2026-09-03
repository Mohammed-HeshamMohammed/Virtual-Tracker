import { requireAuthContext } from "../../../http/auth-context.js";
import { canUseBatchMemberActions, assertMembersRemovable, BATCH_MEMBER_ACTIONS_DENIED_MESSAGE } from "../../../http/batch-member-actions.js";
import { canManageMember } from "../../../http/authorization.js";
import { readJsonBody } from "../../../http/read-json-body.js";
import { rejectUnknownFields } from "../../../http/validate-body.js";
import { sendJson } from "../../../http/response.js";
import { logSafeError } from "../../../http/sanitize-error.js";
import {
  batchRemoveMembersFromTree,
  removeMemberFromTree,
} from "../services/member-remove-from-tree-service.js";

export async function routeMemberRemoveFromTree(req, res, url, origin) {
  const pn = url.pathname.replace(/^\/api\/v1/, "/api");

  if (pn === "/api/members/remove-from-tree" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!canUseBatchMemberActions(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: BATCH_MEMBER_ACTIONS_DENIED_MESSAGE });
      return true;
    }

    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["memberId"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";
    if (!memberId) {
      sendJson(res, origin, 400, { success: false, error: "memberId is required." });
      return true;
    }

    try {
      const { getDb } = await import("../../../config/firebase.js");
      const db = getDb();
      if (!db) {
        sendJson(res, origin, 503, { success: false, error: "Database is not configured." });
        return true;
      }

      const allowed = await canManageMember(db, viewer.memberId, viewer.roleName, memberId);
      if (!allowed) {
        sendJson(res, origin, 403, { success: false, error: "This member is outside your management scope." });
        return true;
      }

      const removeErr = await assertMembersRemovable(db, [memberId]);
      if (removeErr) {
        sendJson(res, origin, 403, { success: false, error: removeErr });
        return true;
      }

      const data = await removeMemberFromTree(db, {
        memberId,
        actorMemberId: viewer.memberId,
        actorRoleName: viewer.roleName,
      });
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      const status = typeof e === "object" && e !== null && "status" in e ? Number(e.status) || 500 : 500;
      if (status >= 500) logSafeError("[members/remove-from-tree]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to remove member from tree.",
      });
    }
    return true;
  }

  if (pn === "/api/members/batch-remove-from-tree" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!canUseBatchMemberActions(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: BATCH_MEMBER_ACTIONS_DENIED_MESSAGE });
      return true;
    }

    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["ids"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const ids = (Array.isArray(body.ids) ? body.ids : []).filter((id) => typeof id === "string" && id.length > 0);
    if (!ids.length) {
      sendJson(res, origin, 400, { success: false, error: "body.ids must be a non-empty array." });
      return true;
    }
    const limitedIds = ids.slice(0, 100);

    if (limitedIds.includes(viewer.memberId)) {
      sendJson(res, origin, 400, {
        success: false,
        error: "You cannot remove yourself from the tree here. Use Settings or Profile for self-removal.",
      });
      return true;
    }

    try {
      const { getDb } = await import("../../../config/firebase.js");
      const db = getDb();
      if (!db) {
        sendJson(res, origin, 503, { success: false, error: "Database is not configured." });
        return true;
      }

      for (const id of limitedIds) {
        const allowed = await canManageMember(db, viewer.memberId, viewer.roleName, id);
        if (!allowed) {
          sendJson(res, origin, 403, { success: false, error: "One or more members are outside your management scope." });
          return true;
        }
      }

      const removeErr = await assertMembersRemovable(db, limitedIds);
      if (removeErr) {
        sendJson(res, origin, 403, { success: false, error: removeErr });
        return true;
      }

      const data = await batchRemoveMembersFromTree(db, {
        memberIds: limitedIds,
        actorMemberId: viewer.memberId,
        actorRoleName: viewer.roleName,
      });
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      const status = typeof e === "object" && e !== null && "status" in e ? Number(e.status) || 500 : 500;
      if (status >= 500) logSafeError("[members/batch-remove-from-tree]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to remove members from tree.",
      });
    }
    return true;
  }

  return false;
}
