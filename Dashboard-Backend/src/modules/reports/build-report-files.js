import { buildReportPdfBuffer } from "./report-pdf-kit.js";

function formatHms(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatDecimalHoursClock(totalHours) {
  return formatHms(Math.round(totalHours * 3600));
}

function escapeCsvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The report's own resolved currency, not a hardcoded dollar sign. The
 * workspace picks a display currency and report-currency.js resolves it per
 * request (the viewer's own where there is a rate for it, the org's
 * otherwise); this file used to print `$${amount}` regardless, so a
 * workspace running in EGP got its total labelled in dollars while every
 * other figure in the same PDF was converted.
 *
 * Falls back to plain 2dp when a currency code is missing or unknown to
 * Intl, rather than throwing mid-render or guessing a symbol.
 */
function formatReportMoney(amount, currencyCode) {
  const value = Number(amount) || 0;
  const code = String(currencyCode || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return value.toFixed(2);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

export function buildTimeAndActivityCsv(payload) {
  const header = ["Date", "Member", "Active hours", "Idle hours"];
  const rows = payload.days.flatMap((day) =>
    day.members.map((m) => [day.date, m.name, formatHms(m.activeSeconds), formatHms(m.idleSeconds)]),
  );
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

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
      {
        label: "Total spent",
        value: formatReportMoney(totalSpent, opts.currency ?? payload.currency?.displayCurrency),
      },
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
