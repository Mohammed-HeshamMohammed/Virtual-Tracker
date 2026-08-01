// CSV / PDF file builders for report Send + Schedule. Takes the same raw
// payload shape the GET /api/reports/time-and-activity endpoint returns
// (build-time-and-activity-rows.js), so one aggregation feeds report view,
// email send, and scheduled delivery alike.
import PDFDocument from "pdfkit";

function formatHms(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function escapeCsvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {{ days: Array<{ date: string, members: Array<{ memberId: string, name: string, activeSeconds: number, idleSeconds: number }> }> }} payload
 * @returns {string}
 */
export function buildTimeAndActivityCsv(payload) {
  const header = ["Date", "Member", "Active hours", "Idle hours"];
  const rows = payload.days.flatMap((day) =>
    day.members.map((m) => [day.date, m.name, formatHms(m.activeSeconds), formatHms(m.idleSeconds)]),
  );
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

/**
 * @param {{ days: Array<{ date: string, members: Array<{ memberId: string, name: string, activeSeconds: number, idleSeconds: number }> }> }} payload
 * @param {{ title?: string, rangeLabel?: string }} [opts]
 * @returns {Promise<Buffer>}
 */
export function buildTimeAndActivityPdf(payload, opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    /** @type {Buffer[]} */
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(opts.title ?? "Time & Activity Report", { align: "left" });
    if (opts.rangeLabel) {
      doc.moveDown(0.3).fontSize(10).fillColor("#666666").text(opts.rangeLabel);
    }
    doc.moveDown(1).fillColor("#000000");

    const colWidths = [90, 200, 90, 90];
    const startX = doc.x;

    function row(cells, { bold = false } = {}) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
      let x = startX;
      const y = doc.y;
      cells.forEach((cell, i) => {
        doc.text(String(cell), x, y, { width: colWidths[i], continued: false });
        x += colWidths[i];
      });
      doc.moveDown(0.6);
    }

    row(["Date", "Member", "Active", "Idle"], { bold: true });
    doc.moveTo(startX, doc.y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.3);

    for (const day of payload.days) {
      if (day.members.length === 0) continue;
      for (const member of day.members) {
        if (doc.y > doc.page.height - 80) doc.addPage();
        row([day.date, member.name, formatHms(member.activeSeconds), formatHms(member.idleSeconds)]);
      }
    }

    doc.end();
  });
}
