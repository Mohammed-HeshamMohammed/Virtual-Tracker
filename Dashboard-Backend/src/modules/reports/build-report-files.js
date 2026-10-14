import { buildReportDocument } from "./report-documents.js";

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

export function buildTimeAndActivityCsv(payload) {
  const header = ["Date", "Member", "Active hours", "Idle hours"];
  const rows = payload.days.flatMap((day) =>
    day.members.map((m) => [day.date, m.name, formatHms(m.activeSeconds), formatHms(m.idleSeconds)]),
  );
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

/**
 * The emailed PDF for a report payload. `opts.pdfOptions` says what it looks
 * like and which document it is (the team report, a client statement or a pay
 * slip); without it, it is the default team report.
 */
export async function buildTimeAndActivityPdf(payload, opts = {}) {
  return buildReportDocument(payload, { rangeLabel: opts.rangeLabel, pdfOptions: opts.pdfOptions }).buffer;
}
