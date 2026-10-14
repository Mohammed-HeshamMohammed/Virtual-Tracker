import { renderPdf } from "../../lib/pdf-core/kit.js";
import { normalizePdfOptions } from "../../lib/pdf-core/options.js";
import {
  buildClientStatementSpec,
  buildPaySlipSpec,
  buildTeamReportSpec,
  normalizeEntry,
  teamReportInputFromPayload,
} from "../../lib/pdf-core/documents.js";

const ORG_LABEL = "TVC";

/** A refusal the route can turn into an HTTP status and a message the reader can act on. */
export class ReportDocumentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ReportDocumentError";
    this.status = status;
  }
}

/**
 * Checks that the viewer may have the document the options ask for, before any
 * data is loaded for it. A client statement shows what clients are charged and a
 * pay slip shows what someone is paid, so each needs the right to see that.
 */
export function assertCanBuildDocument(options, viewer, { isManagement, canViewCompensation }) {
  if (options.document === "client" && !isManagement(viewer)) {
    throw new ReportDocumentError("Client statements are for managers and above.", 403);
  }
  if (options.document === "payslip") {
    if (!options.memberId) throw new ReportDocumentError("Choose whose pay slip to make.", 400);
    if (!canViewCompensation(viewer, options.memberId)) {
      throw new ReportDocumentError("You are not allowed to see this member's pay.", 403);
    }
  }
}

/** What the email says it is attaching. */
export function documentName(options) {
  if (options.document === "client") return "Client statement";
  if (options.document === "payslip") return "Pay slip";
  return "Time & Activity Report";
}

/**
 * The team report as the page describes it (see sanitizeTeamReportInput), drawn
 * with the options chosen. Nothing is loaded: the page already has the table.
 */
export function buildTeamInputDocument(input, pdfOptions) {
  const options = normalizePdfOptions(pdfOptions);
  const spec = buildTeamReportSpec(input, options);
  const doc = renderPdf(spec, options);
  return { buffer: Buffer.from(doc.output("arraybuffer")), filename: spec.filename, options };
}

/**
 * The PDF for a loaded report payload, drawn by the same code the page's
 * Export dialog uses, so an emailed or scheduled PDF is the one previewed.
 *
 * Returns the spec's file name too (a pay slip is named for whose it is).
 */
export function buildReportDocument(payload, { rangeLabel, pdfOptions } = {}) {
  const options = normalizePdfOptions(pdfOptions);
  const range = rangeLabel ?? "";

  let spec;
  if (options.document === "report") {
    spec = buildTeamReportSpec(teamReportInputFromPayload(payload, { orgLabel: ORG_LABEL, rangeLabel: range }, options), options);
  } else {
    if (options.document === "client" && payload.billingIncluded !== true) {
      throw new ReportDocumentError("Client statements are for managers and above.", 403);
    }
    const entries = (payload.entries ?? []).map((entry) => normalizeEntry(entry));
    const base = {
      entries,
      rangeLabel: range,
      orgLabel: ORG_LABEL,
      currency: payload.currency?.displayCurrency || options.currency || "USD",
    };
    spec =
      options.document === "client"
        ? buildClientStatementSpec({ ...base, projectNames: options.projectNames }, options)
        : buildPaySlipSpec({ ...base, memberId: options.memberId }, options);
  }

  const doc = renderPdf(spec, options);
  return { buffer: Buffer.from(doc.output("arraybuffer")), filename: spec.filename, options };
}
