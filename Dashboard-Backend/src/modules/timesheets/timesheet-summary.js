// Real hours + dollar amount + per-project breakdown for one member's pay
// period - the actual computation backing the Timesheets page (submit
// summary, and what gets frozen onto a submitted/approved timesheets row).
// Replaces the old hours-only computeTimesheetHours (schema/services/
// postgres-crud.service.js), which summed tracked time but never touched
// pay rate, currency, or project at all.
import { getTimesheetPeriodAmountRowsPg } from "../../lib/postgres/misc-reports-postgres.service.js";

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {string} memberId
 * @param {string} periodStart 'YYYY-MM-DD'
 * @param {string} periodEnd 'YYYY-MM-DD'
 * @returns {Promise<{
 *   total_hours: number, billable_hours: number, amount: number, currency: string,
 *   project_breakdown: Array<{ projectId: string | null, projectName: string, hours: number, amount: number }>,
 * }>}
 */
export async function computeTimesheetSummary(memberId, periodStart, periodEnd) {
  const rows = await getTimesheetPeriodAmountRowsPg({ memberId, fromDay: periodStart, toDay: periodEnd });

  let totalSeconds = 0;
  let billableSeconds = 0;
  let amount = 0;
  // A member's currency can in principle change mid-period (same as a rate
  // change), but a timesheet shows one total, not a per-currency split the
  // way a multi-member report does - the most recent day actually worked
  // wins, which matches what "your current rate" means to the person
  // reading their own submitted total.
  let currency = "USD";
  let latestDayWithHours = "";

  /** @type {Map<string, { projectId: string | null, projectName: string, seconds: number, amount: number }>} */
  const byProject = new Map();

  for (const row of rows) {
    if (row.seconds <= 0) continue;
    totalSeconds += row.seconds;
    billableSeconds += row.billableSeconds;
    const rowAmount = (row.seconds / 3600) * row.rate;
    amount += rowAmount;

    if (row.day >= latestDayWithHours) {
      latestDayWithHours = row.day;
      currency = row.currency;
    }

    const key = row.projectId ?? "none";
    const entry = byProject.get(key) ?? {
      projectId: row.projectId,
      projectName: row.projectName || "No project",
      seconds: 0,
      amount: 0,
    };
    entry.seconds += row.seconds;
    entry.amount += rowAmount;
    byProject.set(key, entry);
  }

  const projectBreakdown = [...byProject.values()]
    .map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      hours: round2(p.seconds / 3600),
      amount: round2(p.amount),
    }))
    .sort((a, b) => b.hours - a.hours);

  return {
    total_hours: round2(totalSeconds / 3600),
    billable_hours: round2(billableSeconds / 3600),
    amount: round2(amount),
    currency,
    project_breakdown: projectBreakdown,
  };
}
