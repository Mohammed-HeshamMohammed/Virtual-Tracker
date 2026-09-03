import { getTimesheetPeriodAmountRowsPg } from "../../lib/postgres/misc-reports-postgres.service.js";

function round2(value) {
  return Math.round(value * 100) / 100;
}

export async function computeTimesheetSummary(memberId, periodStart, periodEnd) {
  const rows = await getTimesheetPeriodAmountRowsPg({ memberId, fromDay: periodStart, toDay: periodEnd });

  let totalSeconds = 0;
  let billableSeconds = 0;
  let amount = 0;
  let currency = "USD";
  let latestDayWithHours = "";

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
