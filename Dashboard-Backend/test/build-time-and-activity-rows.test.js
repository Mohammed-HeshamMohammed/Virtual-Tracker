// Guards buildTimeAndActivityReportPayload's `entries` output - the flat
// day+member+project fact table the report's "Group by" dropdown aggregates
// from (member/project/client/team/date-per-week), kept separate from `days`
// so the existing date-per-day view and its CSV/PDF export stay untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeAndActivityReportPayload, resolveRateForDay, resolveCurrencyForDay } from "../src/modules/reports/build-time-and-activity-rows.js";

const memberNameMap = new Map([
  ["m1", { name: "Ada Lovelace" }],
  ["m2", { name: "Grace Hopper" }],
]);
const memberTimezones = new Map([
  ["m1", "UTC"],
  ["m2", "UTC"],
]);

function session(overrides) {
  return {
    member_id: "m1",
    project_id: "p1",
    project_name: "Project One",
    client_name: "Acme Co",
    team_name: "Core Team",
    started_at: "2026-08-25T10:00:00.000Z",
    ended_at: "2026-08-25T11:00:00.000Z",
    updated_at: "2026-08-25T11:00:00.000Z",
    active_seconds: 3000,
    idle_seconds: 600,
    ...overrides,
  };
}

test("a single session on one project produces one entry carrying its client/team labels", () => {
  const { entries } = buildTimeAndActivityReportPayload(
    [session()],
    memberNameMap,
    memberTimezones,
    "2026-08-25",
    "2026-08-25",
  );
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    date: "2026-08-25",
    memberId: "m1",
    memberName: "Ada Lovelace",
    projectId: "p1",
    projectName: "Project One",
    clientName: "Acme Co",
    teamName: "Core Team",
    activeSeconds: 3000,
    idleSeconds: 600,
    manualSeconds: 0,
    spentAmount: 0,
    currency: "USD",
  });
});

test("two sessions on different projects the same day stay as two separate entries - `days`/`memberRows` would collapse this into one row with just a Set of names", () => {
  const rows = [
    session({ project_id: "p1", project_name: "Project One", active_seconds: 1800, idle_seconds: 0 }),
    session({ project_id: "p2", project_name: "Project Two", client_name: "Beta Inc", active_seconds: 1200, idle_seconds: 0 }),
  ];
  const { days, entries } = buildTimeAndActivityReportPayload(rows, memberNameMap, memberTimezones, "2026-08-25", "2026-08-25");

  // The existing day/member shape still collapses to one row (unchanged
  // behavior - nothing that reads `days` should see a shape change).
  assert.equal(days.length, 1);
  assert.equal(days[0].members.length, 1);
  assert.equal(days[0].members[0].activeSeconds, 3000);
  assert.deepEqual(days[0].members[0].projectNames.sort(), ["Project One", "Project Two"]);

  // entries keeps them apart, each with its own project/client and its own
  // seconds - this is what real per-project/per-client totals need.
  assert.equal(entries.length, 2);
  const byProject = new Map(entries.map((e) => [e.projectId, e]));
  assert.equal(byProject.get("p1").activeSeconds, 1800);
  assert.equal(byProject.get("p1").clientName, "Acme Co");
  assert.equal(byProject.get("p2").activeSeconds, 1200);
  assert.equal(byProject.get("p2").clientName, "Beta Inc");
});

test("two sessions on the same project the same day merge into one entry, seconds summed", () => {
  const rows = [
    session({ active_seconds: 1000, idle_seconds: 100 }),
    session({ active_seconds: 500, idle_seconds: 50, started_at: "2026-08-25T14:00:00.000Z", ended_at: "2026-08-25T14:30:00.000Z", updated_at: "2026-08-25T14:30:00.000Z" }),
  ];
  const { entries } = buildTimeAndActivityReportPayload(rows, memberNameMap, memberTimezones, "2026-08-25", "2026-08-25");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].activeSeconds, 1500);
  assert.equal(entries[0].idleSeconds, 150);
});

test("a task-less/project-less session gets its own entry with empty project/client/team labels, not dropped", () => {
  const rows = [session({ project_id: null, project_name: "", client_name: "", team_name: "" })];
  const { entries } = buildTimeAndActivityReportPayload(rows, memberNameMap, memberTimezones, "2026-08-25", "2026-08-25");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].projectId, null);
  assert.equal(entries[0].projectName, "");
});

test("spentAmount uses the same per-member rate and rounding as the day/member shape's own spentAmount", () => {
  const rows = [session({ active_seconds: 3600, idle_seconds: 0 })];
  const rates = new Map([["m1", 25]]);
  const { days, entries } = buildTimeAndActivityReportPayload(rows, memberNameMap, memberTimezones, "2026-08-25", "2026-08-25", rates);
  assert.equal(days[0].members[0].spentAmount, 25);
  assert.equal(entries[0].spentAmount, 25);
});

test("entries from different members on the same project/day stay separate", () => {
  const rows = [
    session({ member_id: "m1", active_seconds: 1000, idle_seconds: 0 }),
    session({ member_id: "m2", active_seconds: 2000, idle_seconds: 0 }),
  ];
  const { entries } = buildTimeAndActivityReportPayload(rows, memberNameMap, memberTimezones, "2026-08-25", "2026-08-25");
  assert.equal(entries.length, 2);
  const byMember = new Map(entries.map((e) => [e.memberId, e]));
  assert.equal(byMember.get("m1").activeSeconds, 1000);
  assert.equal(byMember.get("m2").activeSeconds, 2000);
});

// Manual time entries. These used to be written to time_entries and then
// never read back by this report, so its own "Manual hours" column - which
// has existed since the report was written - always displayed 0 for time the
// user had just added through "Add time for someone".
function manual(overrides = {}) {
  return {
    member_id: "m1",
    project_id: "p1",
    day: "2026-08-25",
    project_name: "Project One",
    client_name: "Acme Co",
    team_name: "Core Team",
    manual_seconds: 1800,
    ...overrides,
  };
}

test("a manual entry reaches the entry for its own day, member and project", () => {
  const { entries } = buildTimeAndActivityReportPayload(
    [], memberNameMap, memberTimezones, "2026-08-25", "2026-08-25", new Map(), [manual()],
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].projectId, "p1", "attributed to the project it was filed against");
  assert.equal(entries[0].manualSeconds, 1800);
  assert.equal(entries[0].activeSeconds, 0, "manual time is not tracked time");
});

test("manual time never lands in active/idle, so it cannot inflate the activity ratio", () => {
  const { days } = buildTimeAndActivityReportPayload(
    [session()], memberNameMap, memberTimezones, "2026-08-25", "2026-08-25", new Map(),
    [manual({ manual_seconds: 36000 })],
  );
  const member = days[0].members[0];
  // Ten hours hand-typed against 50 minutes actually observed - if this bled
  // into activeSeconds the member would read as near-100% active.
  assert.equal(member.activeSeconds, 3000, "unchanged by the manual entry");
  assert.equal(member.idleSeconds, 600, "unchanged by the manual entry");
  assert.equal(member.manualSeconds, 36000);
});

test("a manual entry merges into the same bucket as a session on that day/member/project", () => {
  const { entries, days } = buildTimeAndActivityReportPayload(
    [session()], memberNameMap, memberTimezones, "2026-08-25", "2026-08-25", new Map(), [manual()],
  );
  assert.equal(entries.length, 1, "one bucket, not a duplicate row");
  assert.equal(entries[0].activeSeconds, 3000);
  assert.equal(entries[0].manualSeconds, 1800);
  assert.equal(days[0].members.length, 1);
});

test("a manual entry on a day with no session still creates that day", () => {
  const { days, entries } = buildTimeAndActivityReportPayload(
    [], memberNameMap, memberTimezones, "2026-08-25", "2026-08-26",
    new Map(), [manual({ day: "2026-08-26" })],
  );
  assert.equal(days.length, 1);
  assert.equal(days[0].date, "2026-08-26");
  assert.equal(entries[0].manualSeconds, 1800);
});

test("manual entries outside the requested range are dropped", () => {
  const { days } = buildTimeAndActivityReportPayload(
    [], memberNameMap, memberTimezones, "2026-08-25", "2026-08-25",
    new Map(), [manual({ day: "2026-08-24" }), manual({ day: "2026-08-26" })],
  );
  assert.equal(days.length, 0);
});

test("manual hours are paid at the member's rate, same as tracked ones", () => {
  const rates = new Map([["m1", 60]]);
  const { days } = buildTimeAndActivityReportPayload(
    [], memberNameMap, memberTimezones, "2026-08-25", "2026-08-25", rates,
    [manual({ manual_seconds: 3600 })],
  );
  assert.equal(days[0].members[0].spentAmount, 60, "one hand-entered hour at $60/h");
});

// A rate change no longer silently rewrites what past days were worth -
// see resolveRateForDay's own doc comment.
test("resolveRateForDay: a flat number (no history) applies to every day unchanged", () => {
  const rates = new Map([["m1", 40]]);
  assert.equal(resolveRateForDay(rates, "m1", "2026-01-01"), 40);
  assert.equal(resolveRateForDay(rates, "m1", "2026-12-31"), 40);
});

test("resolveRateForDay: an unknown member reads 0, not a crash", () => {
  assert.equal(resolveRateForDay(new Map(), "ghost", "2026-01-01"), 0);
});

test("resolveRateForDay: a day picks the last rate point on or before it, not today's", () => {
  const rates = new Map([
    ["m1", [
      { effectiveDate: "2026-01-01", rate: 20 },
      { effectiveDate: "2026-06-01", rate: 30 },
      { effectiveDate: "2026-09-01", rate: 45 },
    ]],
  ]);
  assert.equal(resolveRateForDay(rates, "m1", "2026-03-15"), 20, "before the first raise");
  assert.equal(resolveRateForDay(rates, "m1", "2026-06-01"), 30, "on the effective date itself");
  assert.equal(resolveRateForDay(rates, "m1", "2026-07-01"), 30, "after the raise, before the next one");
  assert.equal(resolveRateForDay(rates, "m1", "2026-09-01"), 45, "on the most recent change");
  assert.equal(resolveRateForDay(rates, "m1", "2026-12-31"), 45, "stays at the latest rate going forward");
});

test("resolveRateForDay: a day before the earliest known point uses that earliest point, not 0", () => {
  const rates = new Map([["m1", [{ effectiveDate: "2026-06-01", rate: 50 }]]]);
  assert.equal(resolveRateForDay(rates, "m1", "2020-01-01"), 50);
});

test("a rate change through the report doesn't retroactively rewrite an already-reported day", () => {
  const rates = new Map([
    ["m1", [
      { effectiveDate: "2026-08-01", rate: 20 },
      { effectiveDate: "2026-09-01", rate: 40 },
    ]],
  ]);
  const augustRow = session({ started_at: "2026-08-15T10:00:00.000Z", ended_at: "2026-08-15T11:00:00.000Z", active_seconds: 3600, idle_seconds: 0 });
  const { days: augustDays } = buildTimeAndActivityReportPayload([augustRow], memberNameMap, memberTimezones, "2026-08-15", "2026-08-15", rates);
  assert.equal(augustDays[0].members[0].spentAmount, 20, "August is still paid at the August rate");

  const septemberRow = session({ started_at: "2026-09-15T10:00:00.000Z", ended_at: "2026-09-15T11:00:00.000Z", active_seconds: 3600, idle_seconds: 0 });
  const { days: septemberDays } = buildTimeAndActivityReportPayload([septemberRow], memberNameMap, memberTimezones, "2026-09-15", "2026-09-15", rates);
  assert.equal(septemberDays[0].members[0].spentAmount, 40, "September uses the new rate");
});

// A member's currency now travels with the report, same as their rate does.
test("resolveCurrencyForDay: a flat number (no history) reads USD, the old unconditional default", () => {
  const rates = new Map([["m1", 40]]);
  assert.equal(resolveCurrencyForDay(rates, "m1", "2026-01-01"), "USD");
});

test("resolveCurrencyForDay: an unknown member reads USD, not a crash", () => {
  assert.equal(resolveCurrencyForDay(new Map(), "ghost", "2026-01-01"), "USD");
});

test("resolveCurrencyForDay: a day picks the currency point on or before it, same walk as the rate", () => {
  const rates = new Map([
    ["m1", [
      { effectiveDate: "2026-01-01", rate: 20, currency: "EGP" },
      { effectiveDate: "2026-06-01", rate: 30, currency: "USD" },
    ]],
  ]);
  assert.equal(resolveCurrencyForDay(rates, "m1", "2026-03-15"), "EGP", "before the switch");
  assert.equal(resolveCurrencyForDay(rates, "m1", "2026-07-01"), "USD", "after the switch");
});

test("days/members and entries both carry the currency that was actually in effect that day, not USD by default when the member is paid in EGP", () => {
  const rates = new Map([["m1", [{ effectiveDate: "2026-08-01", rate: 100, currency: "EGP" }]]]);
  const row = session({ started_at: "2026-08-15T10:00:00.000Z", ended_at: "2026-08-15T11:00:00.000Z", active_seconds: 3600, idle_seconds: 0 });
  const { days, entries } = buildTimeAndActivityReportPayload([row], memberNameMap, memberTimezones, "2026-08-15", "2026-08-15", rates);
  assert.equal(days[0].members[0].currency, "EGP");
  assert.equal(entries[0].currency, "EGP");
});

test("two manual entries on different projects stay separate entries", () => {
  const { entries } = buildTimeAndActivityReportPayload(
    [], memberNameMap, memberTimezones, "2026-08-25", "2026-08-25", new Map(),
    [manual(), manual({ project_id: "p2", project_name: "Project Two", manual_seconds: 900 })],
  );
  assert.equal(entries.length, 2);
  const byProject = Object.fromEntries(entries.map((e) => [e.projectId, e.manualSeconds]));
  assert.deepEqual(byProject, { p1: 1800, p2: 900 });
});

// The Time & Activity table's member avatars used to only ever show
// initials - days[].members[].avatarUrl (from buildMemberMetaMap, which
// every report's memberNameMap ultimately comes from) is what lets them
// render a real photo instead.

test("a member with a real avatarUrl in the name map carries it onto their day row", () => {
  const namesWithPhoto = new Map([
    ["m1", { name: "Ada Lovelace", avatarUrl: "https://cdn.example.com/ada.jpg" }],
  ]);
  const { days } = buildTimeAndActivityReportPayload([session()], namesWithPhoto, memberTimezones, "2026-08-25", "2026-08-25");
  assert.equal(days[0].members[0].avatarUrl, "https://cdn.example.com/ada.jpg");
});

test("a member with no avatarUrl on the name map gets null, not undefined - the frontend falls back to initials on either, but null is what a real 'no photo' member gets from memberMetaFromRow", () => {
  const { days } = buildTimeAndActivityReportPayload([session()], memberNameMap, memberTimezones, "2026-08-25", "2026-08-25");
  assert.equal(days[0].members[0].avatarUrl, null);
});
