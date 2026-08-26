// Expenses CRUD.
//
// Scope rules mirror time_entries (schema/routes.js assertTimeEntryWriteAuthorized):
// a member may create and manage their own expenses; management may act on
// anyone within their access scope. Approving or rejecting is management-only -
// nobody approves their own spending.

import { getAuthContext, requireManagementRole } from "../../http/auth-context.js";
import { canAccessMember, canManageMember } from "../../http/authorization.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { getViewerProjectIds } from "../../http/project-access.js";
import { sendJson } from "../../http/response.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { buildMemberMetaMap } from "../activity/activity-scope.js";
import {
  createExpensePg,
  deleteExpensePg,
  getExpensePg,
  listExpensesPg,
  updateExpensePg,
} from "../../lib/postgres/expenses-postgres.service.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(["pending", "approved", "rejected"]);

/** Categories the expense form offers. Stored as free text, validated here so
 *  the report can group on a known set. */
export const EXPENSE_CATEGORIES = new Set([
  "travel",
  "meals",
  "software",
  "hardware",
  "office",
  "training",
  "other",
]);

function parseDay(value) {
  const day = typeof value === "string" ? value.trim() : "";
  return DAY_RE.test(day) ? day : "";
}

function parseAmount(value) {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeExpenses(req, res, url, db, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");
  if (!pn.startsWith("/api/expenses")) return false;

  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return true;
  }

  // GET /api/expenses?from&to&status&memberId
  if (pn === "/api/expenses" && req.method === "GET") {
    try {
      const requested = (url.searchParams.get("memberId") || "").trim();
      let memberIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);
      if (requested) {
        if (memberIds !== null && !memberIds.includes(requested)) {
          sendJson(res, origin, 403, { success: false, error: "Not allowed to view this member's expenses." });
          return true;
        }
        memberIds = [requested];
      }
      const status = (url.searchParams.get("status") || "").trim();
      const rows = await listExpensesPg({
        memberIds,
        fromDay: parseDay(url.searchParams.get("from")) || null,
        toDay: parseDay(url.searchParams.get("to")) || null,
        status: STATUSES.has(status) ? status : null,
      });
      const nameMap = await buildMemberMetaMap(db, [...new Set(rows.map((r) => String(r.member_id)))]);
      const data = rows.map((r) => ({
        ...r,
        amount: Number(r.amount) || 0,
        member_name: nameMap.get(String(r.member_id))?.name ?? "Unknown",
      }));
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[expenses GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load expenses." });
    }
    return true;
  }

  // POST /api/expenses
  if (pn === "/api/expenses" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, [
        "memberId",
        "member_id",
        "projectId",
        "project_id",
        "clientId",
        "client_id",
        "date",
        "category",
        "description",
        "notes",
        "amount",
        "currency",
        "billable",
        "receiptUrl",
        "receipt_url",
      ]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const memberId = String(body.memberId ?? body.member_id ?? viewer.memberId ?? "").trim();
    if (!memberId) {
      sendJson(res, origin, 400, { success: false, error: "member_id is required." });
      return true;
    }
    if (memberId !== viewer.memberId) {
      if (!requireManagementRole(viewer) || !(await canAccessMember(db, viewer.memberId, viewer.roleName, memberId))) {
        sendJson(res, origin, 403, { success: false, error: "Cannot log expenses for this member." });
        return true;
      }
    }

    const date = parseDay(body.date);
    const amount = parseAmount(body.amount);
    const description = String(body.description ?? "").trim();
    const category = String(body.category ?? "other").trim().toLowerCase();
    if (!date) {
      sendJson(res, origin, 400, { success: false, error: "A valid date (YYYY-MM-DD) is required." });
      return true;
    }
    if (amount === null || amount <= 0) {
      sendJson(res, origin, 400, { success: false, error: "Enter an amount greater than zero." });
      return true;
    }
    if (!description) {
      sendJson(res, origin, 400, { success: false, error: "A description is required." });
      return true;
    }
    if (!EXPENSE_CATEGORIES.has(category)) {
      sendJson(res, origin, 400, { success: false, error: "Unrecognized expense category." });
      return true;
    }

    try {
      const created = await createExpensePg({
        member_id: memberId,
        project_id: body.projectId ?? body.project_id ?? null,
        client_id: body.clientId ?? body.client_id ?? null,
        date,
        category,
        description,
        notes: String(body.notes ?? "").trim(),
        amount,
        currency: String(body.currency ?? "USD").trim().toUpperCase().slice(0, 10),
        billable: body.billable === true,
        receipt_url: body.receiptUrl ?? body.receipt_url ?? null,
        status: "pending",
        created_by: viewer.memberId,
        updated_by: viewer.memberId,
      });
      sendJson(res, origin, 201, { success: true, data: created });
    } catch (e) {
      logSafeError("[expenses POST]", e);
      sendJson(res, origin, 400, { success: false, error: "Failed to save expense." });
    }
    return true;
  }

  const idMatch = /^\/api\/expenses\/([^/]+)$/.exec(pn);
  const reviewMatch = /^\/api\/expenses\/([^/]+)\/review$/.exec(pn);

  // PATCH /api/expenses/:id/review { status }
  if (reviewMatch && req.method === "PATCH") {
    if (!requireManagementRole(viewer)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to review expenses." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["status"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const status = String(body.status ?? "").trim().toLowerCase();
    if (status !== "approved" && status !== "rejected") {
      sendJson(res, origin, 400, { success: false, error: "status must be approved or rejected." });
      return true;
    }
    try {
      const existing = await getExpensePg(reviewMatch[1]);
      if (!existing) {
        sendJson(res, origin, 404, { success: false, error: "Expense not found." });
        return true;
      }
      // Reviewing your own spending is exactly what this gate exists to stop.
      if (String(existing.member_id) === viewer.memberId) {
        sendJson(res, origin, 403, { success: false, error: "You cannot review your own expense." });
        return true;
      }
      if (!(await canManageMember(db, viewer.memberId, viewer.roleName, String(existing.member_id)))) {
        sendJson(res, origin, 403, { success: false, error: "Not allowed to review this member's expenses." });
        return true;
      }
      const updated = await updateExpensePg(reviewMatch[1], {
        status,
        reviewed_by: viewer.memberId,
        reviewed_at: new Date().toISOString(),
        updated_by: viewer.memberId,
      });
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      logSafeError("[expenses review]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to review expense." });
    }
    return true;
  }

  // DELETE /api/expenses/:id
  if (idMatch && req.method === "DELETE") {
    try {
      const existing = await getExpensePg(idMatch[1]);
      if (!existing) {
        sendJson(res, origin, 404, { success: false, error: "Expense not found." });
        return true;
      }
      const owner = String(existing.member_id);
      const isOwner = owner === viewer.memberId;
      if (!isOwner) {
        if (!requireManagementRole(viewer) || !(await canManageMember(db, viewer.memberId, viewer.roleName, owner))) {
          sendJson(res, origin, 403, { success: false, error: "Not allowed to remove this expense." });
          return true;
        }
      } else if (existing.status === "approved") {
        // Once approved it is part of the financial record; a manager can
        // still remove it, the person who claimed it cannot.
        sendJson(res, origin, 409, { success: false, error: "Approved expenses cannot be removed." });
        return true;
      }
      await deleteExpensePg(idMatch[1], viewer.memberId);
      sendJson(res, origin, 200, { success: true, data: { id: idMatch[1] } });
    } catch (e) {
      logSafeError("[expenses DELETE]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to remove expense." });
    }
    return true;
  }

  return false;
}
