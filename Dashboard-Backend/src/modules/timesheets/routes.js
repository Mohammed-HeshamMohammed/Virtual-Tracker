
import { getAuthContext, requireManagementRole } from "../../http/auth-context.js";
import { canManageMember } from "../../http/authorization.js";
import { sendJson } from "../../http/response.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { query } from "../../lib/postgres/client.js";
import { computeTimesheetSummary } from "./timesheet-summary.js";
import { resolvePayPeriodBounds } from "./pay-period-bounds.js";
import { publishChange } from "../realtime/change-bus.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const PAY_PERIODS = new Set(["weekly", "none", "twice-per-month", "bi-weekly", "monthly"]);

function parseDay(value) {
  const day = typeof value === "string" ? value.trim() : "";
  if (!DAY_RE.test(day)) return "";
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? "" : day;
}

async function getMemberPayPeriod(memberId) {
  const rows = await query("SELECT pay_period FROM pay_rates WHERE member_id = $1 LIMIT 1", [memberId]);
  return rows[0]?.pay_period ?? "None";
}

export async function routeTimesheets(req, res, url, db, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");

  if (pn === "/api/timesheets/period-summary" && req.method === "GET") {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
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

    const fromParam = parseDay(url.searchParams.get("from"));
    const toParam = parseDay(url.searchParams.get("to"));
    let from = fromParam;
    let to = toParam;
    if (!from || !to) {
      const payPeriod = await getMemberPayPeriod(targetMemberId);
      const bounds = resolvePayPeriodBounds(payPeriod);
      from = fromParam || bounds.start;
      to = toParam || bounds.end;
    }
    if (from > to) {
      sendJson(res, origin, 400, { success: false, error: "from must not be after to." });
      return true;
    }

    try {
      const summary = await computeTimesheetSummary(targetMemberId, from, to);
      const existing = await query(
        `SELECT id, status, submitted_at, total_hours, billable_hours, amount, currency, project_breakdown
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
          amount: summary.amount,
          currency: summary.currency,
          projects: summary.project_breakdown,
          timesheet: existing[0] ?? null,
        },
      });
    } catch (e) {
      logSafeError("[timesheets/period-summary]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load timesheet period." });
    }
    return true;
  }

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

      const summary = await computeTimesheetSummary(memberId, periodStart, periodEnd);
      if (summary.total_hours <= 0) {
        sendJson(res, origin, 400, {
          success: false,
          error: "There is no tracked time in this period to submit.",
        });
        return true;
      }

      const rows = await query(
        `INSERT INTO timesheets
           (member_id, period_start, period_end, status, total_hours, billable_hours, amount, currency,
            project_breakdown, submitted_at, approved_at, approved_by)
         VALUES ($1, $2, $3, 'submitted', $4, $5, $6, $7, $8, now(), NULL, NULL)
         ON CONFLICT (member_id, period_start, period_end) DO UPDATE SET
           status = 'submitted',
           total_hours = EXCLUDED.total_hours,
           billable_hours = EXCLUDED.billable_hours,
           amount = EXCLUDED.amount,
           currency = EXCLUDED.currency,
           project_breakdown = EXCLUDED.project_breakdown,
           submitted_at = now(),
           approved_at = NULL,
           approved_by = NULL,
           updated_at = now()
         RETURNING id, member_id, period_start, period_end, status, total_hours, billable_hours,
                   amount, currency, project_breakdown, submitted_at`,
        [
          memberId,
          periodStart,
          periodEnd,
          summary.total_hours,
          summary.billable_hours,
          summary.amount,
          summary.currency,
          JSON.stringify(summary.project_breakdown),
        ],
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
      for (const memberId of memberIds) {
        const allowed = await canManageMember(db, viewer.memberId, viewer.roleName, memberId);
        if (!allowed) {
          sendJson(res, origin, 403, { success: false, error: "Not allowed to configure one of the selected members." });
          return true;
        }
      }

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
