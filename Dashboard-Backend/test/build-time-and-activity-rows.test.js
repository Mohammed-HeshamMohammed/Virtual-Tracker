// Guards buildTimeAndActivityReportPayload's `entries` output - the flat
// day+member+project fact table the report's "Group by" dropdown aggregates
// from (member/project/client/team/date-per-week), kept separate from `days`
// so the existing date-per-day view and its CSV/PDF export stay untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeAndActivityReportPayload } from "../src/modules/reports/build-time-and-activity-rows.js";

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
    spentAmount: 0,
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
