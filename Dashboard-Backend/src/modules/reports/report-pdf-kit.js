// Server-side twin of Dashboard-Web's
// features/reports/utils/pdf/report-pdf-kit.ts - same library (jsPDF +
// jspdf-autotable, both Node-compatible, no canvas/native deps), same
// drawing primitives, so a report's *emailed* PDF (Send / Schedule) looks
// like the one its own Export -> To PDF button downloads instead of two
// visually unrelated documents built by two different code paths. Ported
// rather than shared as one file because the two runtimes need different
// output calls at the end (doc.save() in the browser vs. a Buffer here) and
// this backend has no bundler step to share a TS module across a browser
// and a plain Node ESM backend without one.
//
// Keep this in sync with report-pdf-kit.ts by eye when either changes - the
// two are deliberately duplicated, not published as a shared package, since
// this is the only backend/frontend visual-parity case in the repo that
// needs it.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const PAGE_MARGIN = 40;
const INK = { r: 30, g: 41, b: 59 }; // slate-800, body text
const MUTED = { r: 100, g: 116, b: 139 }; // slate-500
const RULE = { r: 226, g: 232, b: 240 }; // slate-200
const BRAND = [37, 99, 235]; // blue-600, matches the on-screen report accent

function setInk(doc) {
  doc.setTextColor(INK.r, INK.g, INK.b);
}
function setMuted(doc) {
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
}

function contentWidth(doc) {
  return doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2;
}

function pctColor(pct) {
  if (pct >= 100) return [220, 38, 38]; // red-600
  if (pct >= 80) return [217, 119, 6]; // amber-600
  return [22, 163, 74]; // emerald-600
}

/**
 * @param {import("jspdf").jsPDF} doc
 * @param {{ title: string, subtitle?: string, orgLabel: string, timezoneLabel?: string, rangeLabel?: string, scopeLabel?: string }} spec
 */
function drawLetterhead(doc, spec) {
  const left = PAGE_MARGIN;
  let y = PAGE_MARGIN;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setInk(doc);
  doc.text(spec.title, left, y);
  y += 18;

  if (spec.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    setMuted(doc);
    const wrapped = doc.splitTextToSize(spec.subtitle, contentWidth(doc));
    doc.text(wrapped, left, y);
    y += wrapped.length * 12;
  }

  const metaParts = [spec.orgLabel, spec.timezoneLabel, spec.rangeLabel, spec.scopeLabel ? `Scope: ${spec.scopeLabel}` : undefined].filter(
    (part) => Boolean(part && part.length > 0),
  );
  if (metaParts.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setMuted(doc);
    doc.text(metaParts.join("   •   "), left, y);
    y += 14;
  }

  y += 4;
  doc.setDrawColor(RULE.r, RULE.g, RULE.b);
  doc.setLineWidth(1);
  doc.line(left, y, left + contentWidth(doc), y);
  return y + 20;
}

function drawSummary(doc, items, y) {
  const left = PAGE_MARGIN;
  const w = contentWidth(doc);
  const h = 44;
  const cellW = w / items.length;

  doc.setDrawColor(RULE.r, RULE.g, RULE.b);
  doc.setLineWidth(1);
  doc.roundedRect(left, y, w, h, 4, 4);

  items.forEach((item, i) => {
    const cx = left + i * cellW;
    if (i > 0) doc.line(cx, y + 8, cx, y + h - 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setMuted(doc);
    doc.text(item.label.toUpperCase(), cx + 12, y + 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    setInk(doc);
    doc.text(item.value, cx + 12, y + 33);
  });

  return y + h + 24;
}

const CHART_HEIGHT = 140;

function drawBarChart(doc, chart, y) {
  const left = PAGE_MARGIN;
  const w = contentWidth(doc);
  const leftPad = 4;
  const plotLeft = left + leftPad;
  const plotW = w - leftPad;
  const plotTop = y + 20;
  const plotH = CHART_HEIGHT;
  const axisY = plotTop + plotH;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  setInk(doc);
  doc.text(chart.title, left, y + 6);

  const data = chart.data.slice(0, 12);
  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = chart.valueFormatter ?? ((v) => String(Math.round(v)));
  const [r, g, b] = chart.color ?? BRAND;

  doc.setDrawColor(241, 245, 249);
  doc.setLineWidth(0.5);
  for (let i = 0; i <= 4; i++) {
    const gy = plotTop + (plotH * i) / 4;
    doc.line(plotLeft, gy, plotLeft + plotW, gy);
  }
  doc.setDrawColor(RULE.r, RULE.g, RULE.b);
  doc.line(plotLeft, axisY, plotLeft + plotW, axisY);

  const n = data.length;
  const slot = plotW / Math.max(1, n);
  const barW = Math.min(34, slot * 0.55);
  doc.setFillColor(r, g, b);
  data.forEach((d, i) => {
    const cx = plotLeft + slot * i + slot / 2;
    const barH = (d.value / max) * plotH;
    doc.roundedRect(cx - barW / 2, axisY - barH, barW, Math.max(1, barH), 1.5, 1.5, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setMuted(doc);
    doc.text(fmt(d.value), cx, axisY - barH - 4, { align: "center" });

    const label = d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label;
    doc.text(label, cx, axisY + 12, { align: "center", maxWidth: slot });
  });

  return axisY + 26;
}

function drawLineChart(doc, chart, y) {
  const left = PAGE_MARGIN;
  const w = contentWidth(doc);
  const plotTop = y + 20;
  const plotH = CHART_HEIGHT;
  const axisY = plotTop + plotH;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  setInk(doc);
  doc.text(chart.title, left, y + 6);

  const points = chart.points;
  const max = Math.max(1, ...points.map((p) => p.value));
  const fmt = chart.valueFormatter ?? ((v) => String(Math.round(v)));
  const [r, g, b] = chart.color ?? BRAND;
  const n = points.length;
  const xAt = (i) => left + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const yAt = (v) => plotTop + plotH - (v / max) * plotH;

  doc.setDrawColor(241, 245, 249);
  doc.setLineWidth(0.5);
  for (let i = 0; i <= 4; i++) {
    const gy = plotTop + (plotH * i) / 4;
    doc.line(left, gy, left + w, gy);
  }
  doc.setDrawColor(RULE.r, RULE.g, RULE.b);
  doc.line(left, axisY, left + w, axisY);

  doc.setDrawColor(r, g, b);
  doc.setLineWidth(1.5);
  for (let i = 0; i < n - 1; i++) {
    doc.line(xAt(i), yAt(points[i].value), xAt(i + 1), yAt(points[i + 1].value));
  }
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(r, g, b);
  points.forEach((p, i) => {
    doc.circle(xAt(i), yAt(p.value), 2.2, "FD");
  });

  const labelStep = n <= 10 ? 1 : Math.ceil(n / 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  setMuted(doc);
  points.forEach((p, i) => {
    if (i % labelStep !== 0 && i !== n - 1) return;
    doc.text(p.label, xAt(i), axisY + 12, { align: "center" });
  });
  if (n > 0) {
    setInk(doc);
    doc.text(fmt(points[n - 1].value), xAt(n - 1), yAt(points[n - 1].value) - 6, { align: "center" });
  }

  return axisY + 26;
}

function drawProgressRows(doc, chart, y) {
  const left = PAGE_MARGIN;
  const w = contentWidth(doc);
  const labelW = w * 0.34;
  const trackX = left + labelW;
  const trackW = w - labelW - 40;
  const rowH = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  setInk(doc);
  doc.text(chart.title, left, y + 6);

  let cy = y + 20;
  const rows = chart.rows.slice(0, 14);
  for (const row of rows) {
    const pct = Math.max(0, Math.min(100, row.pct));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setInk(doc);
    const label = row.label.length > 28 ? `${row.label.slice(0, 27)}…` : row.label;
    doc.text(label, left, cy + 10);

    doc.setFillColor(241, 245, 249);
    doc.roundedRect(trackX, cy + 3, trackW, 9, 2, 2, "F");
    const [r, g, b] = pctColor(pct);
    doc.setFillColor(r, g, b);
    doc.roundedRect(trackX, cy + 3, Math.max(2, (trackW * pct) / 100), 9, 2, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`${Math.round(pct)}%`, trackX + trackW + 8, cy + 10);
    if (row.sublabel) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      setMuted(doc);
      doc.text(row.sublabel, left, cy + 19);
      cy += rowH + 6;
    } else {
      cy += rowH;
    }
  }
  return cy + 8;
}

function drawChart(doc, chart, y) {
  if (chart.type === "bar") return drawBarChart(doc, chart, y);
  if (chart.type === "line") return drawLineChart(doc, chart, y);
  return drawProgressRows(doc, chart, y);
}

function chartHeightEstimate(chart) {
  if (chart.type === "progress") return 26 + Math.min(14, chart.rows.length) * 26 + 20;
  return CHART_HEIGHT + 46;
}

/**
 * Builds the same "report paper" document report-pdf-kit.ts's
 * downloadReportPdf draws in the browser, and returns it as a Buffer instead
 * of triggering a save - for the email attachment path (Send / Schedule).
 * @param {{
 *   title: string, subtitle?: string, orgLabel: string, timezoneLabel?: string,
 *   rangeLabel?: string, scopeLabel?: string,
 *   summary?: { label: string, value: string }[],
 *   charts?: Array<
 *     | { type: "bar", title: string, data: { label: string, value: number }[], valueFormatter?: (v: number) => string, color?: [number, number, number] }
 *     | { type: "line", title: string, points: { label: string, value: number }[], valueFormatter?: (v: number) => string, color?: [number, number, number] }
 *     | { type: "progress", title: string, rows: { label: string, pct: number, sublabel?: string }[] }
 *   >,
 *   table: { columns: { header: string, key: string, align?: "left"|"right"|"center", width?: number }[], rows: Record<string, string|number>[], emptyMessage?: string },
 * }} spec
 * @returns {Buffer}
 */
export function buildReportPdfBuffer(spec) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageH = doc.internal.pageSize.getHeight();
  const bottomLimit = pageH - PAGE_MARGIN - 16;

  let y = drawLetterhead(doc, spec);

  if (spec.summary && spec.summary.length > 0) {
    y = drawSummary(doc, spec.summary, y);
  }

  for (const chart of spec.charts ?? []) {
    if (y + chartHeightEstimate(chart) > bottomLimit) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    y = drawChart(doc, chart, y);
  }

  if (y + 60 > bottomLimit) {
    doc.addPage();
    y = PAGE_MARGIN;
  }

  const { columns, rows, emptyMessage } = spec.table;
  if (rows.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setMuted(doc);
    doc.text(emptyMessage ?? "Nothing to report for this range.", PAGE_MARGIN, y + 14);
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      head: [columns.map((c) => c.header)],
      body: rows.map((row) => columns.map((c) => String(row[c.key] ?? ""))),
      columnStyles: Object.fromEntries(
        columns.map((c, i) => [i, { halign: c.align ?? "left", ...(c.width ? { cellWidth: c.width } : {}) }]),
      ),
      styles: { fontSize: 8, cellPadding: 5, textColor: [INK.r, INK.g, INK.b], lineColor: [RULE.r, RULE.g, RULE.b] },
      headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
  }

  const pageCount = doc.getNumberOfPages();
  const generatedOn = new Date().toLocaleString();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setMuted(doc);
    doc.text(`Generated ${generatedOn}`, PAGE_MARGIN, pageH - 20);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() - PAGE_MARGIN, pageH - 20, { align: "right" });
  }

  return Buffer.from(doc.output("arraybuffer"));
}
