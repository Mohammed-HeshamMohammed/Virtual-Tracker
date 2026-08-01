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
 * The actual aggregation, independent of any HTTP viewer - also used by the
 * schedule runner, which has no request/auth-context to resolve visibility from.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[] | null} memberIds
 * @param {string} from
 * @param {string} to
 */
export async function loadTimeAndActivityReportPayloadForMemberIds(db, memberIds, from, to) {
  const rawRows = await getTimeAndActivityReportRowsPg({ memberIds, fromDay: from, toDay: to });
  const memberIdsInResult = [...new Set(rawRows.map((r) => r.member_id))];
  const [nameMap, tzMap] = await Promise.all([
    buildMemberMetaMap(db, memberIdsInResult),
    getMemberTimezones(db, memberIdsInResult),
  ]);
  return buildTimeAndActivityReportPayload(rawRows, nameMap, tzMap, from, to);
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
  return loadTimeAndActivityReportPayloadForMemberIds(db, memberIds, from, to);
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
  if (!pn.startsWith("/api/reports/time-and-activity")) return false;

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

  return false;
}

export { resolveMemberIdsFilter, parseDateParam, loadTimeAndActivityReportPayload, buildReportAttachment, rangeLabel };
