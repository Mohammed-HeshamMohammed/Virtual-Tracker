import { renderPdf } from "../../lib/pdf-core/kit.js";
import { normalizePdfOptions } from "../../lib/pdf-core/options.js";

/**
 * Draws a report spec as a PDF. The drawing itself lives in lib/pdf-core, the
 * same code (generated from Dashboard-Web/shared/pdf-core) that the page's
 * Export dialog runs, so an emailed PDF cannot differ from a downloaded one.
 */
export function buildReportPdfBuffer(spec, pdfOptions) {
  return Buffer.from(renderPdf(spec, normalizePdfOptions(pdfOptions)).output("arraybuffer"));
}
