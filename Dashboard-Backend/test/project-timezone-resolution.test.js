// Guards which calendar governs which decision when a member's work spans
// regions - e.g. someone in Cairo working a US client's hours.
//
// Two different answers, on purpose:
//   - personal daily/weekly totals use the MEMBER's zone (a person cannot be
//     having two "todays" at once, so bucketing their personal cap per project
//     would let two projects each grant them a fresh day);
//   - task/project-scoped totals use the PROJECT's zone when it declares one,
//     so work on a client's timeline lines up with that client's days.
//
// A project with no zone declared falls back to the member's, which is every
// project today - so this changes nothing until someone sets one.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let projectRow = null;
let memberZone = "UTC";

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql) => {
      if (/FROM projects/i.test(sql)) return projectRow ? [projectRow] : [];
      return [];
    },
  },
});

mock.module("../src/modules/reports/member-timezones.js", {
  namedExports: {
    getMemberTimezone: async () => memberZone,
    getMemberTimezones: async () => new Map(),
    __clearMemberTimezoneCache: () => {},
  },
});

const { resolveProjectTimeZone } = await import("../src/lib/time/resolve-time-zone.js");

test("a project with no timezone falls back to the member's - today's behaviour, unchanged", async () => {
  memberZone = "Africa/Cairo";
  projectRow = { timezone: null };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "Africa/Cairo");

  projectRow = { timezone: "   " };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "Africa/Cairo");
});

test("a project that declares a timezone governs its own work", async () => {
  // The case this exists for: member sits in Cairo, project runs US hours.
  memberZone = "Africa/Cairo";
  projectRow = { timezone: "America/New_York" };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "America/New_York");
});

test("a task-less session (no project) uses the member's zone", async () => {
  memberZone = "Asia/Tokyo";
  projectRow = { timezone: "America/New_York" };
  assert.equal(await resolveProjectTimeZone(null, "m1"), "Asia/Tokyo");
});

test("an unusable project timezone falls back to the member rather than silently becoming UTC", async () => {
  memberZone = "Africa/Cairo";
  projectRow = { timezone: "Not/AZone" };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "Africa/Cairo");
});

test("a project that genuinely declares UTC is honoured", async () => {
  memberZone = "Africa/Cairo";
  projectRow = { timezone: "UTC" };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "UTC");
});

test("a project row that does not exist falls back to the member", async () => {
  memberZone = "Europe/Berlin";
  projectRow = null;
  assert.equal(await resolveProjectTimeZone("missing", "m1"), "Europe/Berlin");
});

test("the two calendars really can differ - which is the whole point", async () => {
  const { localDayFor } = await import("../src/lib/time/timezone-utils.js");
  memberZone = "Africa/Cairo";
  projectRow = { timezone: "America/New_York" };

  const projectZone = await resolveProjectTimeZone("p1", "m1");
  // 03:00 UTC: already the 6th in Cairo, still the 5th in New York.
  const instant = new Date("2026-09-06T03:00:00.000Z");
  assert.equal(localDayFor(instant, memberZone), "2026-09-06", "member's personal day");
  assert.equal(localDayFor(instant, projectZone), "2026-09-05", "the project's day");
});
