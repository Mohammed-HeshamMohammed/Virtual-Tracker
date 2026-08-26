import { requireAuthContext, isManagementRole } from "../../http/auth-context.js";
import { sendJson } from "../../http/response.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { getDb } from "../../config/firebase.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { buildMemberMetaMap } from "../activity/activity-scope.js";
import { getTimeAndActivityReportRowsPg } from "../../lib/postgres/time-and-activity-report-postgres.service.js";
import { buildTimeAndActivityReportPayload } from "./build-time-and-activity-rows.js";
import { getMemberTimezones } from "./member-timezones.js";
import { buildTimeAndActivityCsv, buildTimeAndActivityPdf } from "./build-report-files.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";
import { insertReportSchedulePg } from "../../lib/postgres/report-schedules-postgres.service.js";
import { parseDeliveryTimeLabel } from "./date-range-kind.js";
import {
  getMemberDailyAmountRowsPg,
  getWorkSessionRowsPg,
  getAuditLogRowsPg,
  getLimitsUsageRowsPg,
  getTimesheetApprovalRowsPg,
  getAppUsageRowsPg,
  getUrlUsageRowsPg,
  getManualTimeEditRowsPg,
  getWorkBreakRowsPg,
  getShiftAttendanceRowsPg,
} from "../../lib/postgres/misc-reports-postgres.service.js";
import {
  listProjectsPg,
  getAllProjectBudgetsPg,
  getProjectTrackedSecondsPg,
  computeProjectSpentCostPg,
} from "../../lib/postgres/projects-postgres.service.js";
import { listClientsPg, getAllClientBudgetsPg } from "../../lib/postgres/clients-postgres.service.js";
import { canViewCompensation } from "../../http/field-policy.js";
import { getViewerProjectIds } from "../../http/project-access.js";
import { listExpensesPg } from "../../lib/postgres/expenses-postgres.service.js";
import {
  getTimeOffBalanceRowsPg,
  getTimeOffTransactionRowsPg,
} from "../../lib/postgres/time-off-postgres.service.js";
import {
  listInvoiceAgingPg,
  listInvoicePaymentsPg,
  listInvoicesWithBalancePg,
} from "../../lib/postgres/invoices-postgres.service.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { normalizeBudget, getBudgetPeriodWindow, evaluateBudgetUsage } from "../clients/services/budget-logic.js";
import { resolveClientBudgetUsage } from "../clients/services/client-budget-usage.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_FREQUENCIES = new Set(["Daily", "Weekly", "Bi-weekly", "Monthly"]);

/** @param {string | null} value */
function parseDateParam(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  return Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()) ? null : value;
}

/**
 * Resolves which member ids the viewer is allowed to pull this report for.
 * Returns `null` (no filter, i.e. every visible member) or an array of ids.
 * Throws with a `status` field on the error when the request should be rejected.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string }} viewer
 * @param {string | null} requestedMemberId
 */
async function resolveMemberIdsFilter(db, viewer, requestedMemberId) {
  const visibleIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);

  if (!requestedMemberId) {
    // No specific member requested - scope to everyone the viewer can already see.
    // getVisibleMemberIds returns [viewer.memberId] for non-management roles, so
    // there's no separate "else self-only" branch needed here.
    return visibleIds;
  }

  const allowed = visibleIds === null || visibleIds.includes(requestedMemberId);
  if (!allowed) {
    const err = new Error("Not allowed to view this member's report.");
    err.status = 403;
    throw err;
  }
  return [requestedMemberId];
}

/**
 * Multi-select variant for report filter panels. Every requested id is checked
 * against the viewer's visible set, so a client cannot widen its own scope by
 * naming members it isn't allowed to see.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string }} viewer
 * @param {string[]} requestedMemberIds
 */
async function resolveMemberIdsMultiFilter(db, viewer, requestedMemberIds) {
  const visibleIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);
  if (!requestedMemberIds || requestedMemberIds.length === 0) return visibleIds;

  if (visibleIds !== null) {
    const visibleSet = new Set(visibleIds);
    const denied = requestedMemberIds.find((id) => !visibleSet.has(id));
    if (denied) {
      const err = new Error("Not allowed to view this member's report.");
      err.status = 403;
      throw err;
    }
  }
  return requestedMemberIds;
}

/** Comma-separated uuid list from a query param; [] when absent/empty. */
function parseUuidListParam(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => UUID_PARAM_RE.test(part));
}

const UUID_PARAM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One member-scope resolver for every report route, so they all accept the
 * same params and enforce the same rule: `memberIds` (CSV, from a filter
 * panel's multi-select) or `memberId` (single), each validated against the
 * viewer's visible set; absent means "everyone this viewer can see".
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string }} viewer
 * @param {URL} url
 * @returns {Promise<string[] | null>} null = unrestricted
 */
async function resolveReportMemberScope(db, viewer, url) {
  const many = parseUuidListParam(url.searchParams.get("memberIds"));
  if (many.length > 0) return resolveMemberIdsMultiFilter(db, viewer, many);
  return resolveMemberIdsFilter(db, viewer, url.searchParams.get("memberId") || null);
}

/**
 * Narrow a requested project filter to the ones the viewer may actually see,
 * so the filter can never be used to surface time on an out-of-scope project.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string }} viewer
 * @param {string[]} requestedProjectIds
 * @returns {Promise<string[] | null>} null = no project filter
 */
async function filterProjectIdsForViewer(db, viewer, requestedProjectIds) {
  if (!requestedProjectIds || requestedProjectIds.length === 0) return null;
  const allowed = await getViewerProjectIds(db, viewer.memberId, viewer.roleName);
  if (allowed === null) return requestedProjectIds;
  const allowedSet = new Set(allowed);
  const permitted = requestedProjectIds.filter((id) => allowedSet.has(id));
  // Every requested project was out of scope - return an impossible filter
  // rather than silently falling back to "no filter" (which would widen the
  // result to everything).
  return permitted.length > 0 ? permitted : ["00000000-0000-0000-0000-000000000000"];
}

/**
 * The actual aggregation, independent of any HTTP viewer - also used by the
 * schedule runner, which has no request/auth-context to resolve visibility from.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[] | null} memberIds
 * @param {string} from
 * @param {string} to
 */
export async function loadTimeAndActivityReportPayloadForMemberIds(db, memberIds, from, to, viewer = null) {
  const rawRows = await getTimeAndActivityReportRowsPg({ memberIds, fromDay: from, toDay: to });
  const memberIdsInResult = [...new Set(rawRows.map((r) => r.member_id))];
  const [nameMap, tzMap] = await Promise.all([
    buildMemberMetaMap(db, memberIdsInResult),
    getMemberTimezones(db, memberIdsInResult),
  ]);
  // Money columns are compensation data - only populate them for a viewer
  // allowed to see each member's rate, same gate the rest of the app uses.
  // Without a viewer (internal callers) rates stay empty and cost reports 0.
  const rateMap = new Map();
  if (viewer && memberIdsInResult.length > 0) {
    const visibleRateMemberIds = memberIdsInResult.filter((id) => canViewCompensation(viewer, id));
    if (visibleRateMemberIds.length > 0) {
      const rateRows = await pgQuery(
        "SELECT member_id, rate FROM pay_rates WHERE member_id = ANY($1::uuid[])",
        [visibleRateMemberIds],
      );
      for (const row of rateRows) {
        rateMap.set(String(row.member_id), Math.max(0, Number(row.rate) || 0));
      }
    }
  }
  return buildTimeAndActivityReportPayload(rawRows, nameMap, tzMap, from, to, rateMap);
}

/**
 * Shared by the GET report endpoint and Send - resolves visibility from an
 * authenticated viewer first, then aggregates.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string }} viewer
 * @param {{ requestedMemberId: string | null, from: string, to: string }} params
 */
async function loadTimeAndActivityReportPayload(db, viewer, { requestedMemberId, from, to }) {
  const memberIds = await resolveMemberIdsFilter(db, viewer, requestedMemberId);
  return loadTimeAndActivityReportPayloadForMemberIds(db, memberIds, from, to, viewer);
}

function rangeLabel(from, to) {
  return from === to ? from : `${from} - ${to}`;
}

/**
 * Builds the attachment (base64 content + filename + mime type) for a report send/schedule.
 * @param {{ days: unknown[] }} payload
 * @param {"csv" | "pdf"} fileType
 * @param {string} rangeLbl
 */
async function buildReportAttachment(payload, fileType, rangeLbl) {
  const baseName = `time-and-activity-${new Date().toISOString().slice(0, 10)}`;
  if (fileType === "csv") {
    const csv = buildTimeAndActivityCsv(payload);
    return {
      filename: `${baseName}.csv`,
      contentBase64: Buffer.from(csv, "utf8").toString("base64"),
      contentType: "text/csv",
    };
  }
  const pdf = await buildTimeAndActivityPdf(payload, { title: "Time & Activity Report", rangeLabel: rangeLbl });
  return {
    filename: `${baseName}.pdf`,
    contentBase64: pdf.toString("base64"),
    contentType: "application/pdf",
  };
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string | undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeReports(req, res, url, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");
  if (!pn.startsWith("/api/reports/")) return false;

  // Options for the report filter panels. Scoped to what the viewer may see,
  // so the panel can only ever offer members/projects they're allowed to
  // filter by. Replaces the hardcoded name lists the panels used to render.
  if (pn === "/api/reports/filter-options" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      const [visibleMemberIds, allowedProjectIds] = await Promise.all([
        getVisibleMemberIds(getDb(), viewer.memberId, viewer.roleName),
        getViewerProjectIds(getDb(), viewer.memberId, viewer.roleName),
      ]);

      const memberMeta = await buildMemberMetaMap(getDb(), visibleMemberIds);
      const members = [...memberMeta.entries()]
        .map(([id, meta]) => ({ id, name: meta.name, initials: meta.initials }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const projectRows = await listProjectsPg({ limit: 500 });
      const allowedProjectSet = allowedProjectIds === null ? null : new Set(allowedProjectIds);
      const projects = projectRows
        .filter((row) => allowedProjectSet === null || allowedProjectSet.has(String(row.id)))
        .map((row) => ({ id: String(row.id), name: String(row.name ?? "Untitled project") }))
        .sort((a, b) => a.name.localeCompare(b.name));

      sendJson(res, origin, 200, { success: true, data: { members, projects } });
    } catch (e) {
      logSafeError("[reports/filter-options]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load filter options." });
    }
    return true;
  }

  if (pn === "/api/reports/time-and-activity" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to) {
      sendJson(res, origin, 400, { success: false, error: "from and to (YYYY-MM-DD) are required." });
      return true;
    }
    if (from > to) {
      sendJson(res, origin, 400, { success: false, error: "from must not be after to." });
      return true;
    }

    try {
      const db = getDb();
      const requestedMemberId = url.searchParams.get("memberId") || null;
      const payload = await loadTimeAndActivityReportPayload(db, viewer, { requestedMemberId, from, to });
      sendJson(res, origin, 200, { success: true, data: payload });
    } catch (e) {
      if (e?.status) {
        sendJson(res, origin, e.status, { success: false, error: e.message });
        return true;
      }
      logSafeError("[reports/time-and-activity]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  if (pn === "/api/reports/time-and-activity/send" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const from = parseDateParam(body.from);
    const to = parseDateParam(body.to);
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    const emails = Array.isArray(body.emails)
      ? [...new Set(body.emails.map((e) => (typeof e === "string" ? e.trim().toLowerCase() : "")).filter(Boolean))]
      : [];
    if (emails.length === 0 || emails.some((e) => !EMAIL_RE.test(e))) {
      sendJson(res, origin, 400, { success: false, error: "At least one valid email address is required." });
      return true;
    }

    const fileType = body.fileType === "csv" ? "csv" : "pdf";
    const requestedMemberId = typeof body.memberId === "string" ? body.memberId : null;

    try {
      const db = getDb();
      const payload = await loadTimeAndActivityReportPayload(db, viewer, { requestedMemberId, from, to });
      const attachment = await buildReportAttachment(payload, fileType, rangeLabel(from, to));

      const subject = typeof body.subject === "string" && body.subject.trim() ? body.subject.trim() : "Time & Activity Report";
      const message = typeof body.message === "string" ? body.message.trim() : "";

      const results = await Promise.all(
        emails.map((email) =>
          sendEmailViaNotify("report-delivery", {
            email,
            subject,
            message,
            reportName: "Time & Activity Report",
            attachment,
          }),
        ),
      );

      const sentCount = results.filter((r) => r.sent).length;
      sendJson(res, origin, 200, { success: true, data: { sent: sentCount, total: emails.length } });
    } catch (e) {
      logSafeError("[reports/time-and-activity/send]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to send report." });
    }
    return true;
  }

  if (pn === "/api/reports/time-and-activity/schedule" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const emails = Array.isArray(body.emails)
      ? [...new Set(body.emails.map((e) => (typeof e === "string" ? e.trim().toLowerCase() : "")).filter(Boolean))]
      : [];
    if (emails.length === 0 || emails.some((e) => !EMAIL_RE.test(e))) {
      sendJson(res, origin, 400, { success: false, error: "At least one valid email address is required." });
      return true;
    }

    const scheduleName = typeof body.scheduleName === "string" ? body.scheduleName.trim() : "";
    if (!scheduleName) {
      sendJson(res, origin, 400, { success: false, error: "Schedule name is required." });
      return true;
    }

    const dateRangeKind = typeof body.dateRangeKind === "string" && body.dateRangeKind.trim() ? body.dateRangeKind.trim() : null;
    if (!dateRangeKind) {
      sendJson(res, origin, 400, { success: false, error: "Date range is required." });
      return true;
    }

    const frequency = typeof body.frequency === "string" ? body.frequency.trim() : "";
    if (!VALID_FREQUENCIES.has(frequency)) {
      sendJson(res, origin, 400, { success: false, error: "Delivery frequency is required." });
      return true;
    }

    const deliveryTime = parseDeliveryTimeLabel(body.deliveryTime);
    if (!deliveryTime) {
      sendJson(res, origin, 400, { success: false, error: "Valid delivery time is required." });
      return true;
    }

    const fileType = body.fileType === "csv" ? "csv" : "pdf";
    const requestedMemberId = typeof body.memberId === "string" ? body.memberId : null;

    try {
      const db = getDb();
      if (requestedMemberId) {
        // Reuses the same visibility check as GET/Send - fails closed with a 403 if not allowed.
        await resolveMemberIdsFilter(db, viewer, requestedMemberId);
      }

      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";

      const id = await insertReportSchedulePg({
        reportType: "time-and-activity",
        name: scheduleName,
        memberId: requestedMemberId,
        emails,
        subject: subject || null,
        message: message || null,
        fileType,
        dateRangeKind,
        frequency,
        deliveryTime,
        createdBy: viewer.memberId,
      });

      sendJson(res, origin, 200, { success: true, data: { id } });
    } catch (e) {
      if (e?.status) {
        sendJson(res, origin, e.status, { success: false, error: e.message });
        return true;
      }
      logSafeError("[reports/time-and-activity/schedule]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to save schedule." });
    }
    return true;
  }

  // ─── Amounts Owed / Daily Totals / Payments (same "hours x rate" shape) ──
  if (
    pn === "/api/reports/amounts-owed" &&
    req.method === "GET"
  ) {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const projectIds = await filterProjectIdsForViewer(
        getDb(),
        viewer,
        parseUuidListParam(url.searchParams.get("projectIds")),
      );
      const rows = await getMemberDailyAmountRowsPg({ memberIds, fromDay: from, toDay: to, projectIds });
      const nameMap = await buildMemberMetaMap(getDb(), [...new Set(rows.map((r) => r.memberId))]);

      const byDay = new Map();
      for (const row of rows) {
        if (!byDay.has(row.day)) byDay.set(row.day, []);
        const hours = row.activeSeconds / 3600;
        byDay.get(row.day).push({
          memberId: row.memberId,
          name: nameMap.get(row.memberId)?.name ?? "Unknown",
          activeSeconds: row.activeSeconds,
          rate: row.rate,
          rateType: row.rateType,
          currency: row.currency,
          amount: Math.round(hours * row.rate * 100) / 100,
        });
      }
      const days = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, members]) => ({ date, members }));

      sendJson(res, origin, 200, { success: true, data: { days } });
    } catch (e) {
      logSafeError("[reports/amounts-owed]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Work Sessions ────────────────────────────────────────────────────────
  if (pn === "/api/reports/work-sessions" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const projectIds = await filterProjectIdsForViewer(
        getDb(),
        viewer,
        parseUuidListParam(url.searchParams.get("projectIds")),
      );
      const sessions = await getWorkSessionRowsPg({ memberIds, fromDay: from, toDay: to, projectIds });
      const nameMap = await buildMemberMetaMap(getDb(), [...new Set(sessions.map((s) => s.memberId))]);

      const rows = sessions.map((s) => ({
        ...s,
        memberName: nameMap.get(s.memberId)?.name ?? "Unknown",
      }));
      sendJson(res, origin, 200, { success: true, data: { sessions: rows } });
    } catch (e) {
      logSafeError("[reports/work-sessions]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Audit Log ────────────────────────────────────────────────────────────
  if (pn === "/api/reports/audit-log" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Management role required." });
      return true;
    }

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    try {
      const rows = await getAuditLogRowsPg({ fromDay: from, toDay: to });
      sendJson(res, origin, 200, { success: true, data: { rows } });
    } catch (e) {
      logSafeError("[reports/audit-log]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Manual Time Edits ────────────────────────────────────────────────────
  if (pn === "/api/reports/manual-time-edits" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const projectIds = await filterProjectIdsForViewer(
        getDb(),
        viewer,
        parseUuidListParam(url.searchParams.get("projectIds")),
      );
      const entries = await getManualTimeEditRowsPg({ memberIds, fromDay: from, toDay: to, projectIds });

      // created_by/updated_by hold a member id for in-app writes; resolve both
      // those and the entry owner in one lookup.
      const ids = new Set();
      for (const e of entries) {
        if (e.memberId) ids.add(String(e.memberId));
        if (UUID_PARAM_RE.test(e.updatedBy)) ids.add(e.updatedBy);
        if (UUID_PARAM_RE.test(e.createdBy)) ids.add(e.createdBy);
      }
      const nameMap = await buildMemberMetaMap(getDb(), [...ids]);
      const nameOf = (value) => (UUID_PARAM_RE.test(value) ? nameMap.get(value)?.name ?? "Unknown" : value || "");

      const rows = entries.map((e) => ({
        ...e,
        memberName: nameMap.get(String(e.memberId))?.name ?? "Unknown",
        editedByName: nameOf(e.updatedBy) || nameOf(e.createdBy),
        hours: Math.round((e.durationSeconds / 3600) * 100) / 100,
      }));
      sendJson(res, origin, 200, { success: true, data: { rows } });
    } catch (e) {
      logSafeError("[reports/manual-time-edits]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Work Breaks ──────────────────────────────────────────────────────────
  if (pn === "/api/reports/work-breaks" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }
    // How long a gap has to be before it counts as a break rather than a
    // stop/start while switching task.
    const rawMinGap = Number.parseInt(url.searchParams.get("minGapMinutes") ?? "", 10);
    const minGapMinutes = Number.isFinite(rawMinGap) ? Math.min(Math.max(rawMinGap, 1), 240) : 5;

    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const breaks = await getWorkBreakRowsPg({ memberIds, fromDay: from, toDay: to, minGapMinutes });
      const nameMap = await buildMemberMetaMap(getDb(), [...new Set(breaks.map((b) => String(b.memberId)))]);
      const rows = breaks.map((b) => ({
        ...b,
        memberName: nameMap.get(String(b.memberId))?.name ?? "Unknown",
      }));
      sendJson(res, origin, 200, { success: true, data: { rows, minGapMinutes } });
    } catch (e) {
      logSafeError("[reports/work-breaks]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Expenses ─────────────────────────────────────────────────────────────
  if (pn === "/api/reports/expenses" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const projectIds = await filterProjectIdsForViewer(
        getDb(),
        viewer,
        parseUuidListParam(url.searchParams.get("projectIds")),
      );
      const expenses = await listExpensesPg({ memberIds, projectIds, fromDay: from, toDay: to, limit: 2000 });
      const nameMap = await buildMemberMetaMap(getDb(), [...new Set(expenses.map((e) => String(e.member_id)))]);
      const rows = expenses.map((e) => ({
        id: String(e.id),
        day: e.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e.date).slice(0, 10),
        memberId: String(e.member_id),
        memberName: nameMap.get(String(e.member_id))?.name ?? "Unknown",
        projectName: e.project_name || "",
        clientName: e.client_name || "",
        category: e.category || "other",
        description: e.description || "",
        amount: Number(e.amount) || 0,
        currency: e.currency || "USD",
        billable: e.billable === true,
        status: e.status || "pending",
      }));
      sendJson(res, origin, 200, { success: true, data: { rows } });
    } catch (e) {
      logSafeError("[reports/expenses]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Time off balances ────────────────────────────────────────────────────
  // Balance is as of the end of the selected range, not "now" - an accrual
  // dated later in the year must not count towards a period that ended before it.
  if (pn === "/api/reports/time-off-balances" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const to = parseDateParam(url.searchParams.get("to")) || new Date().toISOString().slice(0, 10);
    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const balances = await getTimeOffBalanceRowsPg({ memberIds, asOf: to });
      const nameMap = await buildMemberMetaMap(getDb(), [...new Set(balances.map((b) => b.memberId))]);
      const rows = balances.map((b) => ({
        ...b,
        memberName: nameMap.get(b.memberId)?.name ?? "Unknown",
      }));
      sendJson(res, origin, 200, { success: true, data: { rows, asOf: to } });
    } catch (e) {
      logSafeError("[reports/time-off-balances]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Time off transactions ────────────────────────────────────────────────
  if (pn === "/api/reports/time-off-transactions" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }
    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const transactions = await getTimeOffTransactionRowsPg({ memberIds, fromDay: from, toDay: to });
      const nameMap = await buildMemberMetaMap(getDb(), [...new Set(transactions.map((t) => t.memberId))]);
      const rows = transactions.map((t) => ({
        ...t,
        memberName: nameMap.get(t.memberId)?.name ?? "Unknown",
      }));
      sendJson(res, origin, 200, { success: true, data: { rows } });
    } catch (e) {
      logSafeError("[reports/time-off-transactions]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Invoices (client / team) and their aging ─────────────────────────────
  // One handler per pair: the only difference is which side of the ledger the
  // invoice sits on, so splitting them into four near-identical handlers would
  // only guarantee they drift.
  {
    const invoiceMatch = /^\/api\/reports\/(client|team)-invoices(-aging)?$/.exec(pn);
    if (invoiceMatch && req.method === "GET") {
      const viewer = requireAuthContext(req, res, origin);
      if (!viewer) return true;
      const kind = invoiceMatch[1] === "client" ? "client" : "team";
      const aging = Boolean(invoiceMatch[2]);

      // Client invoices are org financials; team invoices are scoped to the
      // members the viewer can see.
      if (kind === "client" && !isManagementRole(viewer.roleName)) {
        sendJson(res, origin, 403, { success: false, error: "Management role required." });
        return true;
      }

      const from = parseDateParam(url.searchParams.get("from"));
      const to = parseDateParam(url.searchParams.get("to")) || new Date().toISOString().slice(0, 10);
      if (!aging && (!from || !to || from > to)) {
        sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
        return true;
      }

      try {
        const memberIds = kind === "team" ? await resolveReportMemberScope(getDb(), viewer, url) : null;
        const rows = aging
          ? await listInvoiceAgingPg({ kind, memberIds, asOf: to })
          : await listInvoicesWithBalancePg({ kind, memberIds, fromDay: from, toDay: to });
        const nameMap = await buildMemberMetaMap(
          getDb(),
          [...new Set(rows.map((r) => r.memberId).filter(Boolean))],
        );
        sendJson(res, origin, 200, {
          success: true,
          data: {
            rows: rows.map((r) => ({
              ...r,
              memberName: r.memberId ? (nameMap.get(r.memberId)?.name ?? "Unknown") : "",
            })),
            asOf: to,
          },
        });
      } catch (e) {
        logSafeError("[reports/invoices]", e);
        sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
      }
      return true;
    }
  }

  // ─── Payments ─────────────────────────────────────────────────────────────
  // Money actually recorded against an invoice, as opposed to amounts-owed's
  // estimate of what is still due. These used to share one handler, so this
  // report showed outstanding estimates under a title promising a record of
  // what was paid.
  if (pn === "/api/reports/payments" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const payments = await listInvoicePaymentsPg({ memberIds, fromDay: from, toDay: to });
      const nameMap = await buildMemberMetaMap(
        getDb(),
        [...new Set(payments.map((p) => p.memberId).filter(Boolean))],
      );
      const rows = payments.map((p) => ({
        ...p,
        memberName: p.memberId ? (nameMap.get(p.memberId)?.name ?? "Unknown") : "",
      }));
      sendJson(res, origin, 200, { success: true, data: { rows } });
    } catch (e) {
      logSafeError("[reports/payments]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Shift attendance ─────────────────────────────────────────────────────
  if (pn === "/api/reports/shift-attendance" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const attendance = await getShiftAttendanceRowsPg({ memberIds, fromDay: from, toDay: to });
      const nameMap = await buildMemberMetaMap(getDb(), [...new Set(attendance.map((a) => a.memberId))]);
      const rows = attendance.map((a) => ({
        ...a,
        memberName: nameMap.get(a.memberId)?.name ?? "Unknown",
      }));
      sendJson(res, origin, 200, { success: true, data: { rows } });
    } catch (e) {
      logSafeError("[reports/shift-attendance]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Project Budgets ──────────────────────────────────────────────────────
  if (pn === "/api/reports/project-budgets" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Management role required." });
      return true;
    }

    try {
      const [projects, budgets] = await Promise.all([listProjectsPg({ limit: 500 }), getAllProjectBudgetsPg()]);
      const budgetByProject = new Map(budgets.map((b) => [b.project_id, b]));

      const rows = await Promise.all(
        projects.map(async (project) => {
          const budget = budgetByProject.get(project.id);
          const cost = budget ? Number(budget.cost) || 0 : 0;
          const spentSeconds = await getProjectTrackedSecondsPg(project.id, {});
          const spentAmount = budget && cost > 0
            ? await computeProjectSpentCostPg(getDb(), project.id, { basedOn: budget.based_on })
            : 0;
          return {
            projectId: project.id,
            projectName: project.name,
            hasBudget: Boolean(budget),
            budgetType: budget?.type ?? null,
            cost,
            spentSeconds,
            spentAmount,
            remaining: Math.max(0, cost - spentAmount),
            pctUsed: cost > 0 ? Math.min(100, Math.round((spentAmount / cost) * 100)) : 0,
          };
        }),
      );
      sendJson(res, origin, 200, { success: true, data: { rows } });
    } catch (e) {
      logSafeError("[reports/project-budgets]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Client Budgets ───────────────────────────────────────────────────────
  if (pn === "/api/reports/client-budgets" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Management role required." });
      return true;
    }

    try {
      const [clients, budgets] = await Promise.all([listClientsPg({ limit: 500 }), getAllClientBudgetsPg()]);
      const budgetByClient = new Map(budgets.map((b) => [b.client_id, b]));

      const rows = await Promise.all(
        clients.map(async (client) => {
          const rawBudget = budgetByClient.get(client.id);
          const budget = normalizeBudget(rawBudget);
          if (!budget) {
            return {
              clientId: client.id,
              clientName: client.name,
              hasBudget: false,
              budgetType: null,
              cap: 0,
              spentAmount: 0,
              billableHours: 0,
              pctUsed: 0,
            };
          }
          const usage = await resolveClientBudgetUsage(getDb(), client.id, budget, {});
          const evaluation = evaluateBudgetUsage(budget, {
            spentAmount: usage.spentAmount,
            projectCount: usage.projectCount,
          });
          return {
            clientId: client.id,
            clientName: client.name,
            hasBudget: true,
            budgetType: budget.type,
            cap: evaluation.cap,
            spentAmount: usage.spentAmount,
            billableHours: usage.billableHours,
            pctUsed: evaluation.usagePct,
          };
        }),
      );
      sendJson(res, origin, 200, { success: true, data: { rows } });
    } catch (e) {
      logSafeError("[reports/client-budgets]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Weekly Limits / Daily Limits (same table, different threshold column) ─
  if (
    (pn === "/api/reports/weekly-limits" || pn === "/api/reports/daily-limits") &&
    req.method === "GET"
  ) {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const rows = await getLimitsUsageRowsPg({ memberIds, fromDay: from, toDay: to });
      const nameMap = await buildMemberMetaMap(getDb(), [...new Set(rows.map((r) => r.memberId))]);

      const isWeekly = pn === "/api/reports/weekly-limits";
      const shaped = rows.map((r) => {
        const limitHours = isWeekly ? r.weeklyLimitHours : r.dailyLimitHours;
        const periodHours = r.periodSeconds / 3600;
        return {
          memberId: r.memberId,
          name: nameMap.get(r.memberId)?.name ?? "Unknown",
          limitHours,
          trackedHours: Math.round(periodHours * 100) / 100,
          pctUsed: limitHours > 0 ? Math.min(100, Math.round((periodHours / limitHours) * 100)) : 0,
        };
      });
      sendJson(res, origin, 200, { success: true, data: { rows: shaped } });
    } catch (e) {
      logSafeError("[reports/limits]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Timesheet Approvals ──────────────────────────────────────────────────
  if (pn === "/api/reports/timesheet-approvals" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const rows = await getTimesheetApprovalRowsPg({ memberIds, fromDay: from, toDay: to });
      const ids = new Set(rows.map((r) => r.memberId));
      for (const r of rows) if (r.approvedBy) ids.add(r.approvedBy);
      const nameMap = await buildMemberMetaMap(getDb(), [...ids]);

      const shaped = rows.map((r) => ({
        ...r,
        memberName: nameMap.get(r.memberId)?.name ?? "Unknown",
        approvedByName: r.approvedBy ? (nameMap.get(r.approvedBy)?.name ?? "Unknown") : null,
      }));
      sendJson(res, origin, 200, { success: true, data: { rows: shaped } });
    } catch (e) {
      logSafeError("[reports/timesheet-approvals]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  // ─── Apps & URLs ──────────────────────────────────────────────────────────
  if (pn === "/api/reports/apps-urls" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;

    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    if (!from || !to || from > to) {
      sendJson(res, origin, 400, { success: false, error: "Valid from/to (YYYY-MM-DD) are required." });
      return true;
    }

    try {
      const memberIds = await resolveReportMemberScope(getDb(), viewer, url);
      const [apps, urls] = await Promise.all([
        getAppUsageRowsPg({ memberIds, fromDay: from, toDay: to }),
        getUrlUsageRowsPg({ memberIds, fromDay: from, toDay: to }),
      ]);
      const ids = new Set([...apps.map((a) => a.memberId), ...urls.map((u) => u.memberId)]);
      const nameMap = await buildMemberMetaMap(getDb(), [...ids]);

      const shapedApps = apps.map((a) => ({ ...a, memberName: nameMap.get(a.memberId)?.name ?? "Unknown" }));
      const shapedUrls = urls.map((u) => ({ ...u, memberName: nameMap.get(u.memberId)?.name ?? "Unknown" }));
      sendJson(res, origin, 200, { success: true, data: { apps: shapedApps, urls: shapedUrls } });
    } catch (e) {
      logSafeError("[reports/apps-urls]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load report." });
    }
    return true;
  }

  return false;
}

export { resolveMemberIdsFilter, parseDateParam, loadTimeAndActivityReportPayload, buildReportAttachment, rangeLabel };
