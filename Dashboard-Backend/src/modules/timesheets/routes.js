// The submit half of the timesheet flow.
//
// Approve/reject already existed (generic schema CRUD, management-gated) and
// the Approvals page's pending queue reads timesheets with status 'submitted' -
// but nothing anywhere ever created a timesheets row, so that queue could never
// show anything. This is the missing writer: a member submits their own pay
// period, hours are computed server-side from the time they actually worked,
// and the row lands as 'submitted' for a manager to action.
//
// Hours are never taken from the client. computeTimesheetHours reads
// time_entries + activity_sessions directly, so a member cannot submit a
// timesheet claiming hours they did not track.

import { getAuthContext, requireManagementRole } from "../../http/auth-context.js";
import { canManageMember } from "../../http/authorization.js";
import { sendJson } from "../../http/response.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { query } from "../../lib/postgres/client.js";
import { computeTimesheetHours } from "../schema/services/postgres-crud.service.js";
import { publishChange } from "../realtime/change-bus.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Mirrors PAY_PERIOD_OPTIONS on the Approvals setup modal.
const PAY_PERIODS = new Set(["weekly", "none", "twice-per-month", "bi-weekly", "monthly"]);

/** @param {unknown} value */
function parseDay(value) {
  const day = typeof value === "string" ? value.trim() : "";
  if (!DAY_RE.test(day)) return "";
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? "" : day;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeTimesheets(req, res, url, db, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");

  // GET /api/timesheets/period-summary?from&to[&memberId]
  // What the member is about to submit, computed from real tracked time, so
  // the UI can show the hours before they commit to them.
  if (pn === "/api/timesheets/period-summary" && req.method === "GET") {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }
    const from = parseDay(url.searchParams.get("from"));
    const to = parseDay(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }
    const requestedMemberId = (url.searchParams.get("memberId") || "").trim();
    const targetMemberId = requestedMemberId || viewer.memberId;
    if (targetMemberId !== viewer.memberId) {
      const allowed = await canManageMember(db, viewer.memberId, viewer.roleName, targetMemberId);
      if (!allowed) {
        sendJson(res, origin, 403, { success: false, error: "Not allowed to view this member's timesheet." });
        return true;
      }
    }

    try {
      const summary = await computeTimesheetHours(targetMemberId, from, to);
      const existing = await query(
        `SELECT id, status, submitted_at, total_hours, billable_hours
         FROM timesheets
         WHERE member_id = $1 AND period_start = $2 AND period_end = $3
         LIMIT 1`,
        [targetMemberId, from, to],
      );
      sendJson(res, origin, 200, {
        success: true,
        data: {
          memberId: targetMemberId,
          periodStart: from,
          periodEnd: to,
          totalHours: summary.total_hours,
          billableHours: summary.billable_hours,
          timesheet: existing[0] ?? null,
        },
      });
    } catch (e) {
      logSafeError("[timesheets/period-summary]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load timesheet period." });
    }
    return true;
  }

  // POST /api/timesheets/submit { periodStart, periodEnd }
  if (pn === "/api/timesheets/submit" && req.method === "POST") {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }

    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["periodStart", "periodEnd", "period_start", "period_end"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const periodStart = parseDay(body.periodStart ?? body.period_start);
    const periodEnd = parseDay(body.periodEnd ?? body.period_end);
    if (!periodStart || !periodEnd || periodStart > periodEnd) {
      sendJson(res, origin, 400, {
        success: false,
        error: "Valid periodStart/periodEnd (YYYY-MM-DD) are required.",
      });
      return true;
    }

    // A member submits their own timesheet - deliberately not on anyone
    // else's behalf, since submitting is an attestation about your own hours.
    const memberId = viewer.memberId;
    if (!memberId) {
      sendJson(res, origin, 400, { success: false, error: "No member profile for this account." });
      return true;
    }

    try {
      const existing = await query(
        "SELECT id, status FROM timesheets WHERE member_id = $1 AND period_start = $2 AND period_end = $3 LIMIT 1",
        [memberId, periodStart, periodEnd],
      );
      const current = existing[0] ?? null;
      if (current && (current.status === "submitted" || current.status === "approved")) {
        sendJson(res, origin, 409, {
          success: false,
          error:
            current.status === "approved"
              ? "This period has already been approved."
              : "This period is already submitted and awaiting approval.",
        });
        return true;
      }

      const summary = await computeTimesheetHours(memberId, periodStart, periodEnd);
      if (summary.total_hours <= 0) {
        sendJson(res, origin, 400, {
          success: false,
          error: "There is no tracked time in this period to submit.",
        });
        return true;
      }

      // uq_timesheet_member_period makes this a real upsert, so a re-submit
      // after a rejection updates that row rather than colliding with it.
      const rows = await query(
        `INSERT INTO timesheets
           (member_id, period_start, period_end, status, total_hours, billable_hours, submitted_at,
            approved_at, approved_by)
         VALUES ($1, $2, $3, 'submitted', $4, $5, now(), NULL, NULL)
         ON CONFLICT (member_id, period_start, period_end) DO UPDATE SET
           status = 'submitted',
           total_hours = EXCLUDED.total_hours,
           billable_hours = EXCLUDED.billable_hours,
           submitted_at = now(),
           approved_at = NULL,
           approved_by = NULL,
           updated_at = now()
         RETURNING id, member_id, period_start, period_end, status, total_hours, billable_hours, submitted_at`,
        [memberId, periodStart, periodEnd, summary.total_hours, summary.billable_hours],
      );

      const saved = rows[0] ?? null;
      if (saved) void publishChange("timesheets", String(saved.id), "updated", memberId);
      sendJson(res, origin, 200, { success: true, data: saved });
    } catch (e) {
      logSafeError("[timesheets/submit]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to submit timesheet." });
    }
    return true;
  }

  // POST /api/timesheets/approval-setup { memberIds, payPeriod, autoSetup }
  // The Approvals page's "Set it up" modal. It used to console.log its result
  // and drop it, so enabling approvals for a member never persisted anything.
  // Both settings already have real columns on pay_rates.
  if (pn === "/api/timesheets/approval-setup" && req.method === "POST") {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }
    if (!requireManagementRole(viewer)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to configure timesheet approvals." });
      return true;
    }

    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["memberIds", "payPeriod", "autoSetup"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const memberIds = Array.isArray(body.memberIds)
      ? body.memberIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
      : [];
    if (memberIds.length === 0) {
      sendJson(res, origin, 400, { success: false, error: "Select at least one member." });
      return true;
    }
    const payPeriod = typeof body.payPeriod === "string" ? body.payPeriod.trim() : "";
    if (!PAY_PERIODS.has(payPeriod)) {
      sendJson(res, origin, 400, { success: false, error: "Unrecognized pay period." });
      return true;
    }
    const requireApproval = body.autoSetup !== false;

    try {
      // Every target is scope-checked - a manager can only configure members
      // they may already manage.
      for (const memberId of memberIds) {
        const allowed = await canManageMember(db, viewer.memberId, viewer.roleName, memberId);
        if (!allowed) {
          sendJson(res, origin, 403, { success: false, error: "Not allowed to configure one of the selected members." });
          return true;
        }
      }

      // pay_rates.member_id is UNIQUE, so this upserts the settings onto an
      // existing rate row rather than creating a competing one.
      const updated = [];
      for (const memberId of memberIds) {
        const rows = await query(
          `INSERT INTO pay_rates (member_id, pay_period, require_timesheet_approval, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (member_id) DO UPDATE SET
             pay_period = EXCLUDED.pay_period,
             require_timesheet_approval = EXCLUDED.require_timesheet_approval,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
           RETURNING member_id`,
          [memberId, payPeriod, requireApproval, viewer.memberId],
        );
        if (rows[0]) updated.push(String(rows[0].member_id));
      }

      sendJson(res, origin, 200, {
        success: true,
        data: { updated, payPeriod, requireTimesheetApproval: requireApproval },
      });
    } catch (e) {
      logSafeError("[timesheets/approval-setup]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to save timesheet approval settings." });
    }
    return true;
  }

  return false;
}
