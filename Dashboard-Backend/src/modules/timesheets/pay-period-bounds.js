
const DAY_MS = 24 * 60 * 60 * 1000;

function toDayStr(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, days) {
  return new Date(d.getTime() + days * DAY_MS);
}

function weekBounds(day) {
  const dow = day.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = addDays(day, diffToMonday);
  return { start: toDayStr(monday), end: toDayStr(addDays(monday, 6)) };
}

function biWeeklyBounds(day) {
  const anchor = new Date("2020-01-06T00:00:00.000Z");
  const daysSinceAnchor = Math.floor((day.getTime() - anchor.getTime()) / DAY_MS);
  const blockIndex = Math.floor(daysSinceAnchor / 14);
  const start = addDays(anchor, blockIndex * 14);
  return { start: toDayStr(start), end: toDayStr(addDays(start, 13)) };
}

function twicePerMonthBounds(day) {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  if (day.getUTCDate() <= 15) {
    return { start: toDayStr(new Date(Date.UTC(y, m, 1))), end: toDayStr(new Date(Date.UTC(y, m, 15))) };
  }
  return { start: toDayStr(new Date(Date.UTC(y, m, 16))), end: toDayStr(new Date(Date.UTC(y, m, lastDay))) };
}

function monthBounds(day) {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { start: toDayStr(new Date(Date.UTC(y, m, 1))), end: toDayStr(new Date(Date.UTC(y, m, lastDay))) };
}

export function resolvePayPeriodBounds(payPeriod, referenceDate = new Date()) {
  const today = new Date(
    `${referenceDate.toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  switch (String(payPeriod || "").toLowerCase()) {
    case "bi-weekly":
      return biWeeklyBounds(today);
    case "twice-per-month":
      return twicePerMonthBounds(today);
    case "monthly":
      return monthBounds(today);
    case "weekly":
    case "none":
    default:
      return weekBounds(today);
  }
}
