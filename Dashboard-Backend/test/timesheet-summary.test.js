// computeTimesheetSummary folds per-day-per-project rows (each day's real
// historical rate already resolved by the SQL layer) into the totals the
// Timesheets page actually needs: hours, a dollar amount, a currency, and a
// per-project breakdown - what the old hours-only computeTimesheetHours
// never touched at all.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {Array<{ day: string, projectId: string | null, projectName: string, seconds: number, billableSeconds: number, rate: number, currency: string }>} */
let stubRows = [];

mock.module("../src/lib/postgres/misc-reports-postgres.service.js", {
  namedExports: {
    getTimesheetPeriodAmountRowsPg: async () => stubRows,
  },
});

const { computeTimesheetSummary } = await import("../src/modules/timesheets/timesheet-summary.js");

test("total hours, billable hours, and amount = hours x rate, summed across days", async () => {
  stubRows = [
    { day: "2026-09-01", projectId: "p1", projectName: "Project One", seconds: 3600, billableSeconds: 3600, rate: 20, currency: "USD" },
    { day: "2026-09-02", projectId: "p1", projectName: "Project One", seconds: 1800, billableSeconds: 0, rate: 20, currency: "USD" },
  ];
  const summary = await computeTimesheetSummary("m1", "2026-09-01", "2026-09-07");
  assert.equal(summary.total_hours, 1.5);
  assert.equal(summary.billable_hours, 1);
  assert.equal(summary.amount, 30); // 1.5h * $20
  assert.equal(summary.currency, "USD");
});

test("project breakdown groups by project, sorted by hours descending", async () => {
  stubRows = [
    { day: "2026-09-01", projectId: "p1", projectName: "Alpha", seconds: 3600, billableSeconds: 3600, rate: 10, currency: "USD" },
    { day: "2026-09-01", projectId: "p2", projectName: "Beta", seconds: 10800, billableSeconds: 10800, rate: 10, currency: "USD" },
    { day: "2026-09-02", projectId: "p2", projectName: "Beta", seconds: 3600, billableSeconds: 3600, rate: 10, currency: "USD" },
  ];
  const summary = await computeTimesheetSummary("m1", "2026-09-01", "2026-09-07");
  assert.deepEqual(summary.project_breakdown, [
    { projectId: "p2", projectName: "Beta", hours: 4, amount: 40 },
    { projectId: "p1", projectName: "Alpha", hours: 1, amount: 10 },
  ]);
});

test("a row with no project (project_id null) is grouped as 'No project'", async () => {
  stubRows = [
    { day: "2026-09-01", projectId: null, projectName: "", seconds: 3600, billableSeconds: 0, rate: 15, currency: "USD" },
  ];
  const summary = await computeTimesheetSummary("m1", "2026-09-01", "2026-09-07");
  assert.equal(summary.project_breakdown.length, 1);
  assert.equal(summary.project_breakdown[0].projectId, null);
  assert.equal(summary.project_breakdown[0].projectName, "No project");
});

test("currency follows the most recent day actually worked, not the first", async () => {
  stubRows = [
    { day: "2026-09-01", projectId: "p1", projectName: "P", seconds: 3600, billableSeconds: 3600, rate: 10, currency: "USD" },
    { day: "2026-09-05", projectId: "p1", projectName: "P", seconds: 3600, billableSeconds: 3600, rate: 10, currency: "EGP" },
  ];
  const summary = await computeTimesheetSummary("m1", "2026-09-01", "2026-09-07");
  assert.equal(summary.currency, "EGP");
});

test("no tracked time at all returns an empty, zeroed summary - not an error", async () => {
  stubRows = [];
  const summary = await computeTimesheetSummary("m1", "2026-09-01", "2026-09-07");
  assert.equal(summary.total_hours, 0);
  assert.equal(summary.amount, 0);
  assert.equal(summary.currency, "USD");
  assert.deepEqual(summary.project_breakdown, []);
});

test("a zero-rate day still counts the hours, just contributes $0", async () => {
  stubRows = [
    { day: "2026-09-01", projectId: "p1", projectName: "P", seconds: 3600, billableSeconds: 3600, rate: 0, currency: "USD" },
  ];
  const summary = await computeTimesheetSummary("m1", "2026-09-01", "2026-09-07");
  assert.equal(summary.total_hours, 1);
  assert.equal(summary.amount, 0);
});
