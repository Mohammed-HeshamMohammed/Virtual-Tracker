import { isManagementRole } from "../../http/auth-context.js";
import { isClientRole } from "../../http/role-hierarchy.js";
import { canViewCompensation } from "../../http/field-policy.js";
import { appearanceOf, DEFAULT_PDF_OPTIONS, normalizePdfOptions } from "../../lib/pdf-core/options.js";
import { buildTimeAndActivityCsv } from "./build-report-files.js";
import { resolveReportCurrency } from "./report-currency.js";
import {
  assertCanBuildDocument,
  buildReportDocument,
  buildTeamInputDocument,
  ReportDocumentError,
} from "./report-documents.js";

/**
 * Everything the server does to turn a request into a report PDF, in one
 * place: which options the viewer may use, what currency the amounts are in,
 * how the file is named, and how a request from the page is built.
 *
 * The page asks for a document and the server computes it - the data, the
 * prices, the tax and the due dates all come from the database and the
 * viewer's own permissions, never from figures the browser holds. Emailed and
 * scheduled reports go through the same functions, so a downloaded PDF and an
 * emailed one cannot differ.
 */

export function rangeLabel(from, to) {
  return from === to ? from : `${from} - ${to}`;
}

/**
 * The PDF options a request asked for, checked against what this viewer may
 * have, and the currency they are to be built in. Throws a ReportDocumentError
 * the route answers with its own status.
 *
 * A pay slip is for one member, so that member is who the report is loaded
 * for; the currency is resolved whenever the document prices anything.
 */
export async function resolvePdfRequest(viewer, rawOptions, { from, to, withCurrency = true } = {}) {
  const options = normalizePdfOptions(rawOptions);
  assertCanBuildDocument(options, viewer, {
    isManagement: (v) => isManagementRole(v.roleName),
    canViewCompensation,
  });
  const wantsCurrency = withCurrency && (options.currency || options.document !== "report");
  const currency = wantsCurrency
    ? await resolveReportCurrency(
        { searchParams: new URLSearchParams(options.currency ? { displayCurrency: options.currency } : {}) },
        { fromDay: from, toDay: to },
      )
    : null;
  return { options, currency };
}

/** The file as it is attached to an email: base64, with its name and type. */
export async function buildReportAttachment(payload, fileType, rangeLbl, pdfOptions = null) {
  const day = new Date().toISOString().slice(0, 10);
  if (fileType === "csv") {
    const csv = buildTimeAndActivityCsv(payload);
    return {
      filename: `time-and-activity-${day}.csv`,
      contentBase64: Buffer.from(csv, "utf8").toString("base64"),
      contentType: "text/csv",
    };
  }
  // The same document the page's Export dialog previews: template, language,
  // formats and what is switched on come from `pdfOptions`.
  const { buffer, filename } = buildReportDocument(payload, { rangeLabel: rangeLbl, pdfOptions });
  return {
    filename: `${filename}-${day}.pdf`,
    contentBase64: buffer.toString("base64"),
    contentType: "application/pdf",
  };
}

// ── the team report as the page shows it ───────────────────────────────────

const GROUP_KEYS = new Set(["date", "week", "member", "project", "client", "team"]);
const ROW_KINDS = new Set(["group", "detail", "total"]);
const ALIGNS = new Set(["left", "right", "center"]);
const KEY_RE = /^[\w.-]{1,40}$/;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COLUMNS = 24;
const MAX_ROWS = 3000;
const MAX_POINTS = 400;
const MAX_MEMBERS = 200;

const text = (value, max = 300) => (typeof value === "string" ? value.slice(0, max) : typeof value === "number" && Number.isFinite(value) ? String(value) : "");
const figure = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);

function bad(message) {
  return new ReportDocumentError(message, 400);
}

/**
 * The on-screen table of the team report, as the page sends it, made safe.
 *
 * The team report is the one document that reflects choices only the page
 * knows (grouping, sort, filters, which columns are showing), so the page
 * describes the table and the server draws it. That description is only ever
 * text and numbers to print: every field is checked, sized and bounded, and a
 * viewer who may not see money (a Client login) can never get any into it.
 */
export function sanitizeTeamReportInput(raw, { moneyHidden = false } = {}) {
  if (!raw || typeof raw !== "object") throw bad("The report's table is missing.");
  const groupKey = GROUP_KEYS.has(raw.groupKey) ? raw.groupKey : null;
  if (!groupKey) throw bad("Unknown grouping.");

  const seen = new Set();
  const columns = list(raw.table?.columns, MAX_COLUMNS)
    .filter((col) => col && typeof col.key === "string" && KEY_RE.test(col.key) && !seen.has(col.key) && seen.add(col.key))
    .filter((col) => !(moneyHidden && /spent|amount|rate/i.test(col.key)))
    .map((col) => ({ key: col.key, header: text(col.header, 80), align: ALIGNS.has(col.align) ? col.align : "left" }));
  if (columns.length === 0) throw bad("The report's table has no columns.");

  const sourceRows = list(raw.table?.rows, MAX_ROWS + 1);
  if (sourceRows.length > MAX_ROWS) throw bad(`The table has more than ${MAX_ROWS} rows - narrow the date range or the filters.`);
  const rows = sourceRows.map((row) => Object.fromEntries(columns.map((col) => [col.key, text(row?.[col.key])])));
  const rowKinds = rows.map((_, i) => (ROW_KINDS.has(raw.table?.rowKinds?.[i]) ? raw.table.rowKinds[i] : "detail"));
  const rowIso = Array.isArray(raw.table?.rowIso) ? rows.map((_, i) => (ISO_DAY_RE.test(raw.table.rowIso[i] ?? "") ? raw.table.rowIso[i] : undefined)) : undefined;

  const filters = raw.filters ?? {};
  return {
    groupKey,
    detailKind: raw.detailKind === "project" ? "project" : "member",
    orgLabel: "TVC",
    timezoneLabel: text(raw.timezoneLabel, 80) || undefined,
    rangeLabel: text(raw.rangeLabel, 80),
    filters: {
      members: list(filters.members, MAX_MEMBERS).map((n) => text(n, 120)).filter(Boolean),
      projects: list(filters.projects, MAX_MEMBERS).map((n) => text(n, 120)).filter(Boolean),
      trackedTime: text(filters.trackedTime, 80),
      manualTime: text(filters.manualTime, 80),
      activityLevel: text(filters.activityLevel, 80),
      currency: text(filters.currency, 3).toUpperCase(),
    },
    totals: {
      time: text(raw.totals?.time, 20),
      activity: Math.min(100, Math.max(0, Math.round(figure(raw.totals?.activity)))),
      spent: moneyHidden ? "" : text(raw.totals?.spent, 120),
    },
    hoursByGroup: list(raw.hoursByGroup, MAX_POINTS).map((p) => ({
      label: text(p?.label, 40),
      iso: ISO_DAY_RE.test(p?.iso ?? "") ? p.iso : undefined,
      value: Math.max(0, figure(p?.value)),
    })),
    hoursByMember: list(raw.hoursByMember, MAX_MEMBERS).map((p) => ({ label: text(p?.label, 60), value: Math.max(0, figure(p?.value)) })),
    table: { columns, rows, rowKinds, rowIso },
    withoutMoney: moneyHidden ? true : raw.withoutMoney === true,
    filename: text(raw.filename, 100).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "time-and-activity",
  };
}

// ── a short memory for previews ────────────────────────────────────────────

/**
 * Loaded report data, kept for a few seconds. The Export dialog redraws its
 * preview on every change of design, language or format - none of which
 * changes the data - so those redraws reuse what was just loaded instead of
 * querying again. Downloads and emails never use it.
 */
export function createPayloadCache({ ttlMs = 15_000, max = 40 } = {}) {
  const entries = new Map();
  return {
    async get(key, load) {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && now - hit.at < ttlMs) return hit.value;
      const value = await load();
      entries.set(key, { at: now, value });
      if (entries.size > max) {
        for (const [k, v] of entries) if (now - v.at >= ttlMs || entries.size > max) entries.delete(k);
      }
      return value;
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * Builds the PDF a request from the page asks for. The data is loaded for
 * this viewer by `loadPayload` (their scope, their permissions); the page
 * sends choices, never figures - except the team report's table, which is
 * what the page is showing and is sanitised first.
 */
export async function buildRequestedPdf({ viewer, from, to, rangeLabel: label, pdfOptions, team, preview = false, loadPayload, cache = null }) {
  const { options, currency } = await resolvePdfRequest(viewer, pdfOptions, { from, to });
  const range = label || rangeLabel(from, to);
  const day = new Date().toISOString().slice(0, 10);

  // The team report as the page shows it: nothing to load.
  if (options.document === "report" && team) {
    const input = sanitizeTeamReportInput(team, { moneyHidden: isClientRole(viewer.roleName) });
    const { buffer, filename } = buildTeamInputDocument({ ...input, rangeLabel: input.rangeLabel || range }, options);
    return { buffer, filename: `${filename}-${day}.pdf`, options };
  }

  const requestedMemberId = options.document === "payslip" ? options.memberId : null;
  const load = () => loadPayload({ requestedMemberId, from, to, currency });
  const key = [viewer.memberId, viewer.roleName, from, to, requestedMemberId ?? "", currency?.displayCurrency ?? ""].join("|");
  const payload = preview && cache ? await cache.get(key, load) : await load();
  const { buffer, filename } = buildReportDocument(payload, { rangeLabel: range, pdfOptions: options });
  return { buffer, filename: `${filename}-${day}.pdf`, options };
}

/**
 * The PDF look a member keeps between visits. Only how documents look is
 * stored - never whose pay slip, which projects or which currency - and
 * whatever arrives is run through the same normalisation as an export, so a
 * stored value is always one the renderer accepts.
 */
export function pdfSettingsToStore(raw) {
  return appearanceOf(normalizePdfOptions({ ...DEFAULT_PDF_OPTIONS, ...(raw && typeof raw === "object" ? raw : {}) }));
}
