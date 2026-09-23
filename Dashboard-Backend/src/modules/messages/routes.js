import { getAuthContext, requireAuthContext } from "../../http/auth-context.js";
import { isOwnerRole } from "../../http/role-hierarchy.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { sendJson } from "../../http/response.js";
import { logSafeError } from "../../http/sanitize-error.js";
import {
  MessageError,
  getThread,
  listThreads,
  markThreadRead,
  openThreads,
  replyToThread,
} from "./service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res, origin, error) {
  const status = error instanceof MessageError ? error.status : 500;
  if (status === 500) logSafeError("[messages]", error);
  sendJson(res, origin, status, {
    success: false,
    error: status === 500 ? "Something went wrong with that message." : error.message,
  });
}

/**
 * Owner<->member messaging (PLAN-notifications-and-owner-messaging.md Part A).
 *
 * Only OPENING a thread is Owner-only. Replying is open to either participant -
 * that is what makes this two-way - and the service checks participation on
 * every read and write, so no route here can widen it.
 */
export async function routeMessages(req, res, url, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");
  if (!pn.startsWith("/api/messages")) return false;

  const viewer = requireAuthContext(req, res, origin);
  if (!viewer) return true;

  if (pn === "/api/messages/threads" && req.method === "GET") {
    try {
      sendJson(res, origin, 200, {
        success: true,
        data: await listThreads(viewer.memberId, { limit: url.searchParams.get("limit") }),
      });
    } catch (e) {
      fail(res, origin, e);
    }
    return true;
  }

  if (pn === "/api/messages/threads" && req.method === "POST") {
    if (!isOwnerRole(getAuthContext(req)?.roleName ?? "")) {
      sendJson(res, origin, 403, { success: false, error: "Only the Owner can start a conversation." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      rejectUnknownFields(body, ["memberIds", "subject", "body"]);
      sendJson(res, origin, 201, { success: true, data: await openThreads(viewer.memberId, body) });
    } catch (e) {
      fail(res, origin, e);
    }
    return true;
  }

  const threadMatch = /^\/api\/messages\/threads\/([^/]+)$/.exec(pn);
  if (threadMatch && req.method === "GET") {
    if (!UUID_RE.test(threadMatch[1])) {
      sendJson(res, origin, 404, { success: false, error: "Conversation not found." });
      return true;
    }
    try {
      sendJson(res, origin, 200, { success: true, data: await getThread(threadMatch[1], viewer.memberId) });
    } catch (e) {
      fail(res, origin, e);
    }
    return true;
  }

  const replyMatch = /^\/api\/messages\/threads\/([^/]+)\/reply$/.exec(pn);
  if (replyMatch && req.method === "POST") {
    if (!UUID_RE.test(replyMatch[1])) {
      sendJson(res, origin, 404, { success: false, error: "Conversation not found." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      rejectUnknownFields(body, ["body"]);
      sendJson(res, origin, 201, { success: true, data: await replyToThread(replyMatch[1], viewer.memberId, body.body) });
    } catch (e) {
      fail(res, origin, e);
    }
    return true;
  }

  const readMatch = /^\/api\/messages\/threads\/([^/]+)\/read$/.exec(pn);
  if (readMatch && req.method === "POST") {
    if (!UUID_RE.test(readMatch[1])) {
      sendJson(res, origin, 404, { success: false, error: "Conversation not found." });
      return true;
    }
    try {
      sendJson(res, origin, 200, { success: true, data: await markThreadRead(readMatch[1], viewer.memberId) });
    } catch (e) {
      fail(res, origin, e);
    }
    return true;
  }

  return false;
}
