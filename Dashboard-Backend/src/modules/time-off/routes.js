// Time off: policies (management), requests (self-service + review), and
// manual ledger adjustments (management).
//
// Balance is never written directly - every change is a transaction row, so
// the number a report shows can always be explained by the ledger behind it.

import { getAuthContext, requireManagementRole } from "../../http/auth-context.js";
import { canManageMember } from "../../http/authorization.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { normalizeRoleKey } from "../../http/role-key.js";
import { sendJson } from "../../http/response.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { buildMemberMetaMap } from "../activity/activity-scope.js";
import {
  createTimeOffPolicyPg,
  createTimeOffRequestPg,
  createTimeOffTransactionPg,
  getTimeOffPolicyPg,
  getTimeOffRequestPg,
  listTimeOffPoliciesPg,
  listTimeOffRequestsPg,
  reviewTimeOffRequestPg,
  updateTimeOffPolicyPg,
} from "../../lib/postgres/time-off-postgres.service.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_STATUSES = new Set(["pending", "approved", "rejected", "cancelled"]);

function parseDay(value) {
  const day = typeof value === "string" ? value.trim() : "";
  return DAY_RE.test(day) ? day : "";
}

/** Whole days between two dates, inclusive. Weekend/holiday handling is a
 *  policy question this deployment has no calendar for, so a day is a day. */
function inclusiveDays(startDay, endDay) {
  const start = new Date(`${startDay}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDay}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeTimeOff(req, res, url, db, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");
  if (!pn.startsWith("/api/time-off")) return false;

  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return true;
  }

  // ─── Policies ────────────────────────────────────────────────────────────
  if (pn === "/api/time-off/policies" && req.method === "GET") {
    try {
      const includeInactive = url.searchParams.get("includeInactive") === "true" && requireManagementRole(viewer);
      sendJson(res, origin, 200, { success: true, data: await listTimeOffPoliciesPg({ includeInactive }) });
    } catch (e) {
      logSafeError("[time-off/policies GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load time off policies." });
    }
    return true;
  }

  if (pn === "/api/time-off/policies" && req.method === "POST") {
    if (!requireManagementRole(viewer)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to manage time off policies." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["name", "description", "daysPerYear", "paid", "requiresApproval"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const name = String(body.name ?? "").trim();
    if (!name) {
      sendJson(res, origin, 400, { success: false, error: "A policy name is required." });
      return true;
    }
    const daysPerYear = Number(body.daysPerYear);
    if (!Number.isFinite(daysPerYear) || daysPerYear < 0) {
      sendJson(res, origin, 400, { success: false, error: "Days per year must be zero or more." });
      return true;
    }
    try {
      const created = await createTimeOffPolicyPg({
        name,
        description: body.description,
        days_per_year: daysPerYear,
        paid: body.paid,
        requires_approval: body.requiresApproval,
        created_by: viewer.memberId,
      });
      sendJson(res, origin, 201, { success: true, data: created });
    } catch (e) {
      logSafeError("[time-off/policies POST]", e);
      sendJson(res, origin, 400, {
        success: false,
        error: String(e?.code) === "23505" ? "A policy with that name already exists." : "Failed to save policy.",
      });
    }
    return true;
  }

  const policyIdMatch = /^\/api\/time-off\/policies\/([^/]+)$/.exec(pn);
  if (policyIdMatch && (req.method === "PATCH" || req.method === "PUT")) {
    if (!requireManagementRole(viewer)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to manage time off policies." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["name", "description", "daysPerYear", "paid", "requiresApproval", "active"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const patch = { updated_by: viewer.memberId };
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.description !== undefined) patch.description = String(body.description).trim();
      if (body.daysPerYear !== undefined) patch.days_per_year = Number(body.daysPerYear) || 0;
      if (body.paid !== undefined) patch.paid = body.paid === true;
      if (body.requiresApproval !== undefined) patch.requires_approval = body.requiresApproval === true;
      if (body.active !== undefined) patch.active = body.active === true;
      const updated = await updateTimeOffPolicyPg(policyIdMatch[1], patch);
      if (!updated) {
        sendJson(res, origin, 404, { success: false, error: "Policy not found." });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      logSafeError("[time-off/policies PATCH]", e);
      sendJson(res, origin, 400, { success: false, error: "Failed to update policy." });
    }
    return true;
  }

  // ─── Requests ────────────────────────────────────────────────────────────
  if (pn === "/api/time-off/requests" && req.method === "GET") {
    try {
      const requested = (url.searchParams.get("memberId") || "").trim();
      let memberIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);
      if (requested) {
        if (memberIds !== null && !memberIds.includes(requested)) {
          sendJson(res, origin, 403, { success: false, error: "Not allowed to view this member's time off." });
          return true;
        }
        memberIds = [requested];
      }
      const status = (url.searchParams.get("status") || "").trim();
      const rows = await listTimeOffRequestsPg({
        memberIds,
        status: REQUEST_STATUSES.has(status) ? status : null,
        fromDay: parseDay(url.searchParams.get("from")) || null,
        toDay: parseDay(url.searchParams.get("to")) || null,
      });
      const nameMap = await buildMemberMetaMap(db, [...new Set(rows.map((r) => String(r.member_id)))]);
      sendJson(res, origin, 200, {
        success: true,
        data: rows.map((r) => ({
          ...r,
          days: Number(r.days) || 0,
          member_name: nameMap.get(String(r.member_id))?.name ?? "Unknown",
        })),
      });
    } catch (e) {
      logSafeError("[time-off/requests GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load time off requests." });
    }
    return true;
  }

  if (pn === "/api/time-off/requests" && req.method === "POST") {
    // Time off is staff leave. A client has no policy, no balance and nobody
    // to approve them, so a request from one only ever produces a row nobody
    // can action. The UI hides the page from them; this refuses it outright.
    if (normalizeRoleKey(viewer.roleName) === "client") {
      sendJson(res, origin, 403, { success: false, error: "Clients do not request time off." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["policyId", "startDate", "endDate", "note", "memberId"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const memberId = String(body.memberId ?? viewer.memberId ?? "").trim();
    if (memberId !== viewer.memberId) {
      if (!requireManagementRole(viewer) || !(await canManageMember(db, viewer.memberId, viewer.roleName, memberId))) {
        sendJson(res, origin, 403, { success: false, error: "Cannot request time off for this member." });
        return true;
      }
    }
    const startDate = parseDay(body.startDate);
    const endDate = parseDay(body.endDate);
    if (!startDate || !endDate || endDate < startDate) {
      sendJson(res, origin, 400, { success: false, error: "Valid startDate/endDate (YYYY-MM-DD) are required." });
      return true;
    }
    const policyId = String(body.policyId ?? "").trim();
    const policy = policyId ? await getTimeOffPolicyPg(policyId) : null;
    if (!policy || policy.active !== true) {
      sendJson(res, origin, 400, { success: false, error: "Pick an active time off policy." });
      return true;
    }

    try {
      const days = inclusiveDays(startDate, endDate);
      const created = await createTimeOffRequestPg({
        member_id: memberId,
        policy_id: policyId,
        start_date: startDate,
        end_date: endDate,
        days,
        note: body.note,
      });
      // A policy that needs no approval is granted on submission, so the
      // ledger reflects it immediately rather than waiting for a review that
      // is never going to happen.
      if (policy.requires_approval === false && created) {
        await reviewTimeOffRequestPg(String(created.id), {
          status: "approved",
          reviewerId: viewer.memberId,
          reviewNote: "Auto-approved: policy does not require approval",
        });
      }
      sendJson(res, origin, 201, { success: true, data: created });
    } catch (e) {
      logSafeError("[time-off/requests POST]", e);
      sendJson(res, origin, 400, { success: false, error: "Failed to submit time off request." });
    }
    return true;
  }

  const reviewMatch = /^\/api\/time-off\/requests\/([^/]+)\/review$/.exec(pn);
  if (reviewMatch && req.method === "PATCH") {
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["status", "reviewNote"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const status = String(body.status ?? "").trim().toLowerCase();
    if (!["approved", "rejected", "cancelled"].includes(status)) {
      sendJson(res, origin, 400, { success: false, error: "status must be approved, rejected or cancelled." });
      return true;
    }

    try {
      const existing = await getTimeOffRequestPg(reviewMatch[1]);
      if (!existing) {
        sendJson(res, origin, 404, { success: false, error: "Request not found." });
        return true;
      }
      const owner = String(existing.member_id);
      // Cancelling your own pending request is self-service; approving or
      // rejecting is always someone else's call.
      const isSelfCancel = status === "cancelled" && owner === viewer.memberId;
      if (!isSelfCancel) {
        if (owner === viewer.memberId) {
          sendJson(res, origin, 403, { success: false, error: "You cannot review your own time off request." });
          return true;
        }
        if (!requireManagementRole(viewer) || !(await canManageMember(db, viewer.memberId, viewer.roleName, owner))) {
          sendJson(res, origin, 403, { success: false, error: "Not allowed to review this request." });
          return true;
        }
      }
      const updated = await reviewTimeOffRequestPg(reviewMatch[1], {
        status,
        reviewerId: viewer.memberId,
        reviewNote: body.reviewNote,
      });
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      logSafeError("[time-off/requests review]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to update request." });
    }
    return true;
  }

  // ─── Manual ledger adjustment (accrual / correction) ─────────────────────
  if (pn === "/api/time-off/transactions" && req.method === "POST") {
    if (!requireManagementRole(viewer)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to adjust time off balances." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["memberId", "policyId", "kind", "days", "effectiveOn", "note"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const memberId = String(body.memberId ?? "").trim();
    const policyId = String(body.policyId ?? "").trim();
    const kind = String(body.kind ?? "adjustment").trim();
    const days = Number(body.days);
    const effectiveOn = parseDay(body.effectiveOn) || new Date().toISOString().slice(0, 10);

    if (!memberId || !policyId) {
      sendJson(res, origin, 400, { success: false, error: "memberId and policyId are required." });
      return true;
    }
    if (kind !== "accrual" && kind !== "adjustment") {
      sendJson(res, origin, 400, { success: false, error: "kind must be accrual or adjustment." });
      return true;
    }
    if (!Number.isFinite(days) || days === 0) {
      sendJson(res, origin, 400, { success: false, error: "days must be a non-zero number." });
      return true;
    }
    if (!(await canManageMember(db, viewer.memberId, viewer.roleName, memberId))) {
      sendJson(res, origin, 403, { success: false, error: "Not allowed to adjust this member's balance." });
      return true;
    }

    try {
      const created = await createTimeOffTransactionPg({
        member_id: memberId,
        policy_id: policyId,
        kind,
        days,
        effective_on: effectiveOn,
        note: body.note,
        created_by: viewer.memberId,
      });
      sendJson(res, origin, 201, { success: true, data: created });
    } catch (e) {
      logSafeError("[time-off/transactions POST]", e);
      sendJson(res, origin, 400, { success: false, error: "Failed to record adjustment." });
    }
    return true;
  }

  return false;
}
