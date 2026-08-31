// CSV / PDF file builders for report Send + Schedule. Takes the same raw
// payload shape the GET /api/reports/time-and-activity endpoint returns
// (build-time-and-activity-rows.js), so one aggregation feeds report view,
// email send, and scheduled delivery alike.
import { buildReportPdfBuffer } from "./report-pdf-kit.js";

function formatHms(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Decimal hours (e.g. 5.25) -> "05:15:00" - same clock format formatHms
 *  produces from raw seconds, for chart value labels computed from a sum of
 *  hours rather than a single seconds count. Matches the frontend's
 *  formatDecimalHoursClock so a hover-free bar/line label never reads as a
 *  bare decimal ("0.37h") in either the download or this emailed copy. */
function formatDecimalHoursClock(totalHours) {
  return formatHms(Math.round(totalHours * 3600));
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
 * The same "report paper" document (letterhead, KPI summary, vector charts,
 * styled paginated table) the frontend's own Export -> To PDF button
 * generates for this report - built with report-pdf-kit.js, the server-side
 * twin of that browser module. Send and Schedule used to attach a plain
 * pdfkit table with none of that (no letterhead beyond a bare title, no
 * charts, no styling), so the copy that landed in someone's inbox looked
 * like a different, lesser report than the one they could download
 * themselves from the same page.
 * @param {{ days: Array<{ date: string, members: Array<{ memberId: string, name: string, activeSeconds: number, idleSeconds: number, spentAmount?: number }> }> }} payload
 * @param {{ title?: string, rangeLabel?: string }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function buildTimeAndActivityPdf(payload, opts = {}) {
  const byMemberSeconds = new Map();
  let totalActiveSeconds = 0;
  let totalIdleSeconds = 0;
  let totalSpent = 0;
  const dailyActiveHours = [];

  for (const day of payload.days) {
    let dayActiveSeconds = 0;
    for (const member of day.members) {
      totalActiveSeconds += member.activeSeconds;
      totalIdleSeconds += member.idleSeconds;
      totalSpent += member.spentAmount ?? 0;
      dayActiveSeconds += member.activeSeconds;
      byMemberSeconds.set(member.name, (byMemberSeconds.get(member.name) ?? 0) + member.activeSeconds);
    }
    dailyActiveHours.push({ label: day.date, value: Math.round((dayActiveSeconds / 3600) * 100) / 100 });
  }

  const trackedSeconds = totalActiveSeconds + totalIdleSeconds;
  const activityPct = trackedSeconds > 0 ? Math.round((totalActiveSeconds / trackedSeconds) * 100) : 0;
  const byMemberHours = [...byMemberSeconds.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([label, seconds]) => ({ label, value: Math.round((seconds / 3600) * 100) / 100 }));

  const buffer = buildReportPdfBuffer({
    title: opts.title ?? "Time & Activity Report",
    subtitle: "Time worked, activity levels, and amounts earned per project or to-do.",
    orgLabel: "TVC",
    rangeLabel: opts.rangeLabel,
    summary: [
      { label: "Total active", value: formatHms(totalActiveSeconds) },
      { label: "Average activity", value: `${activityPct}%` },
      { label: "Total spent", value: `$${totalSpent.toFixed(2)}` },
    ],
    charts: [
      ...(dailyActiveHours.length > 0
        ? [
            {
              type: "line",
              title: "Active hours by day",
              points: dailyActiveHours,
              valueFormatter: formatDecimalHoursClock,
            },
          ]
        : []),
      ...(byMemberHours.length > 0
        ? [
            {
              type: "bar",
              title: "Active hours by member",
              data: byMemberHours,
              valueFormatter: formatDecimalHoursClock,
            },
          ]
        : []),
    ],
    table: {
      columns: [
        { header: "Date", key: "date" },
        { header: "Member", key: "member" },
        { header: "Active", key: "active", align: "right" },
        { header: "Idle", key: "idle", align: "right" },
      ],
      rows: payload.days.flatMap((day) =>
        day.members.map((member) => ({
          date: day.date,
          member: member.name,
          active: formatHms(member.activeSeconds),
          idle: formatHms(member.idleSeconds),
        })),
      ),
      emptyMessage: "No data for this range.",
    },
    filename: "time-and-activity",
  });

  return buffer;
}
