import { localDayFor } from "./timezone-utils.js";
import { convertAmount } from "../../lib/currency/convert.js";

/**
 * A session's hours belong to the day it started - all of them.
 *
 * This used to prorate a session across every local midnight it crossed,
 * which disagreed with how limit enforcement books the same session (all of
 * it against `started_at`). One shift therefore appeared as one day's work to
 * the limit checker and as two partial days on a report.
 *
 * Start-day attribution is the agreed model, and it is what a shift actually
 * is to the person working it: an 8pm -> 5am shift is one night's work, not
 * two fractions of two days. It also keeps a shift that runs into a rest day
 * booked against the working day it started on, leaving the weekend/holiday
 * showing zero rather than a stray few hours.
 */
function attributeSessionToStartDay(session, timeZone) {
  const start = new Date(session.started_at);
  return [
    {
      // The query already resolved the day by the session's own calendar - its project's zone,
      // else the member's (session-day-sql.js). `timeZone` (the member's) is only a fallback for
      // rows built without it.
      day: session.session_day ?? localDayFor(start, timeZone),
      activeSeconds: session.active_seconds,
      idleSeconds: session.idle_seconds,
      activitySum: session.activity_sum ?? 0,
      activityCount: session.activity_count ?? 0,
    },
  ];
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function resolveRateForDay(memberRates, memberId, day) {
  const entry = memberRates.get(memberId);
  if (entry == null) return 0;
  if (typeof entry === "number") return entry;
  if (!Array.isArray(entry) || entry.length === 0) return 0;
  let rate = entry[0].rate;
  for (const point of entry) {
    if (point.effectiveDate <= day) rate = point.rate;
    else break;
  }
  return rate;
}

export function resolveCurrencyForDay(memberRates, memberId, day) {
  const entry = memberRates.get(memberId);
  if (entry == null) return "USD";
  if (typeof entry === "number") return "USD";
  if (!Array.isArray(entry) || entry.length === 0) return "USD";
  let currency = entry[0].currency || "USD";
  for (const point of entry) {
    if (point.effectiveDate <= day) currency = point.currency || "USD";
    else break;
  }
  return currency;
}

export function buildTimeAndActivityReportPayload(
  rawRows,
  memberNameMap,
  memberTimezones,
  fromDay,
  toDay,
  memberRates = new Map(),
  manualRows = [],
  currency = null,
  options = {},
) {
  // What the client is charged is a separate permission from what a member is
  // paid: only the caller knows whether this viewer may see it.
  const includeBilling = options.includeBilling === true;
  /**
   * Money is earned in the member's own currency and reported in one. The
   * conversion happens here, at the row, rather than in the client: the day a
   * row belongs to is what picks the rate, and the client no longer knows that
   * once the rows are grouped. It also keeps the on-screen figure, the CSV and
   * the emailed PDF reading from one implementation.
   *
   * `originalAmount`/`originalCurrency` ride along on every row - a converted
   * figure is derived, and derived money is what people query.
   */
  const spend = (amount, earnedIn, day) => {
    if (!currency?.rateBook) {
      return { spentAmount: amount, currency: earnedIn, originalAmount: amount, originalCurrency: earnedIn };
    }
    const converted = convertAmount(currency.rateBook, {
      amount,
      currency: earnedIn,
      day,
      to: currency.displayCurrency,
    });
    return {
      spentAmount: converted.amount,
      currency: converted.currency,
      originalAmount: converted.originalAmount,
      originalCurrency: converted.originalCurrency,
      rateAsOf: converted.rateAsOf,
    };
  };
  const byDay = new Map();
  const byDayMemberProject = new Map();

  for (const row of rawRows) {
    const timeZone = memberTimezones.get(row.member_id) ?? "UTC";
    const segments = attributeSessionToStartDay(row, timeZone);

    for (const segment of segments) {
      if (segment.day < fromDay || segment.day > toDay) continue;

      if (!byDay.has(segment.day)) byDay.set(segment.day, new Map());
      const byMember = byDay.get(segment.day);
      if (!byMember.has(row.member_id)) {
        byMember.set(row.member_id, {
          activeSeconds: 0,
          idleSeconds: 0,
          manualSeconds: 0,
          activitySum: 0,
          activityCount: 0,
          projectNames: new Set(),
        });
      }
      const entry = byMember.get(row.member_id);
      entry.activeSeconds += segment.activeSeconds;
      entry.idleSeconds += segment.idleSeconds;
      entry.activitySum += segment.activitySum;
      entry.activityCount += segment.activityCount;
      if (row.project_name) entry.projectNames.add(row.project_name);

      const entryKey = `${segment.day}::${row.member_id}::${row.project_id ?? "none"}`;
      if (!byDayMemberProject.has(entryKey)) {
        byDayMemberProject.set(entryKey, {
          date: segment.day,
          memberId: row.member_id,
          projectId: row.project_id,
          projectName: row.project_name || "",
          clientName: row.client_name || "",
          teamName: row.team_name || "",
          clientHourlyRate: row.client_hourly_rate,
          clientRateCurrency: row.client_rate_currency,
          clientNetTermsDays: row.client_net_terms_days,
          clientTaxRate: row.client_tax_rate,
          clientBillingNotes: row.client_billing_notes,
          activeSeconds: 0,
          idleSeconds: 0,
          manualSeconds: 0,
          activitySum: 0,
          activityCount: 0,
        });
      }
      const fine = byDayMemberProject.get(entryKey);
      fine.activeSeconds += segment.activeSeconds;
      fine.idleSeconds += segment.idleSeconds;
      fine.activitySum += segment.activitySum;
      fine.activityCount += segment.activityCount;
    }
  }

  for (const row of manualRows) {
    if (row.day < fromDay || row.day > toDay) continue;

    if (!byDay.has(row.day)) byDay.set(row.day, new Map());
    const byMember = byDay.get(row.day);
    if (!byMember.has(row.member_id)) {
      byMember.set(row.member_id, {
        activeSeconds: 0,
        idleSeconds: 0,
        manualSeconds: 0,
        activitySum: 0,
        activityCount: 0,
        projectNames: new Set(),
      });
    }
    const entry = byMember.get(row.member_id);
    entry.manualSeconds = (entry.manualSeconds ?? 0) + row.manual_seconds;
    if (row.project_name) entry.projectNames.add(row.project_name);

    const entryKey = `${row.day}::${row.member_id}::${row.project_id ?? "none"}`;
    if (!byDayMemberProject.has(entryKey)) {
      byDayMemberProject.set(entryKey, {
        date: row.day,
        memberId: row.member_id,
        projectId: row.project_id,
        projectName: row.project_name || "",
        clientName: row.client_name || "",
        teamName: row.team_name || "",
        clientHourlyRate: row.client_hourly_rate,
        clientRateCurrency: row.client_rate_currency,
        clientNetTermsDays: row.client_net_terms_days,
        clientTaxRate: row.client_tax_rate,
        clientBillingNotes: row.client_billing_notes,
        activeSeconds: 0,
        idleSeconds: 0,
        manualSeconds: 0,
        activitySum: 0,
        activityCount: 0,
      });
    }
    const fine = byDayMemberProject.get(entryKey);
    fine.manualSeconds = (fine.manualSeconds ?? 0) + row.manual_seconds;
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, byMember]) => ({
      date,
      members: [...byMember.entries()].map(([memberId, entry]) => ({
        memberId,
        name: memberNameMap.get(memberId)?.name ?? "Unknown",
        avatarUrl: memberNameMap.get(memberId)?.avatarUrl ?? null,
        activeSeconds: entry.activeSeconds,
        idleSeconds: entry.idleSeconds,
        manualSeconds: entry.manualSeconds ?? 0,
        activitySum: entry.activitySum,
        activityCount: entry.activityCount,
        ...spend(
          round2(
            ((entry.activeSeconds + (entry.manualSeconds ?? 0)) / 3600) * resolveRateForDay(memberRates, memberId, date),
          ),
          resolveCurrencyForDay(memberRates, memberId, date),
          date,
        ),
        projectNames: [...entry.projectNames],
      })),
    }));

  /**
   * What the project's client is charged for this row: the same hours, priced
   * at the project's own hourly rate instead of the member's pay rate, and
   * converted on the row's day exactly as pay is. Left off entirely for a
   * project with no rate, so "nothing set" never reads as "free".
   */
  const billing = (entry, hours) => {
    if (!includeBilling) return {};
    const rate = Number(entry.clientHourlyRate);
    if (!Number.isFinite(rate) || rate <= 0) return {};
    const billedIn = String(entry.clientRateCurrency || currency?.orgCurrency || "USD").toUpperCase();
    const converted = spend(round2(hours * rate), billedIn, entry.date);
    // The client's own invoice terms, present only when it has set custom ones.
    const taxRate = Number(entry.clientTaxRate);
    const netTerms = Number(entry.clientNetTermsDays);
    const notes = String(entry.clientBillingNotes ?? "").trim();
    return {
      billRate: rate,
      billRateCurrency: billedIn,
      billAmount: converted.spentAmount,
      billCurrency: converted.currency,
      ...(Number.isFinite(taxRate) && taxRate > 0 ? { billTaxRate: taxRate } : {}),
      ...(entry.clientNetTermsDays != null && Number.isFinite(netTerms)
        ? { billNetTermsDays: Math.max(0, Math.floor(netTerms)) }
        : {}),
      ...(notes ? { billNotes: notes } : {}),
    };
  };

  const entries = [...byDayMemberProject.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => {
      const hours = (entry.activeSeconds + (entry.manualSeconds ?? 0)) / 3600;
      const payRate = resolveRateForDay(memberRates, entry.memberId, entry.date);
      const payRateCurrency = resolveCurrencyForDay(memberRates, entry.memberId, entry.date);
      return {
        date: entry.date,
        memberId: entry.memberId,
        memberName: memberNameMap.get(entry.memberId)?.name ?? "Unknown",
        projectId: entry.projectId,
        projectName: entry.projectName,
        clientName: entry.clientName,
        teamName: entry.teamName,
        activeSeconds: entry.activeSeconds,
        idleSeconds: entry.idleSeconds,
        manualSeconds: entry.manualSeconds ?? 0,
        activitySum: entry.activitySum,
        activityCount: entry.activityCount,
        // The rate the amount below was worked out from, in the currency it
        // is paid in - a pay slip states it; the converted amount cannot.
        payRate,
        payRateCurrency,
        ...spend(round2(hours * payRate), payRateCurrency, entry.date),
        ...billing(entry, hours),
      };
    });

  return { days, entries };
}
