// The narrow case project-timezone-resolution.test.js doesn't cover: one
// member working genuinely different regions across different projects in
// the same week. A per-project timezone alone can't express that (it would
// have to pick one calendar for everyone on the project); this is a
// per-membership override that wins over the project's own zone for that one
// person only.
import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

let membershipRow = null;
let projectRow = null;
let memberZone = "UTC";

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql) => {
      if (/FROM project_members/i.test(sql)) return membershipRow ? [membershipRow] : [];
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

test("a membership override wins over the project's own declared zone", async () => {
  memberZone = "Africa/Cairo";
  projectRow = { timezone: "America/New_York" };
  membershipRow = { timezone: "Asia/Tokyo" };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "Asia/Tokyo");
});

test("no membership override falls through to the project's zone, unchanged from before", async () => {
  memberZone = "Africa/Cairo";
  projectRow = { timezone: "America/New_York" };
  membershipRow = null;
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "America/New_York");

  membershipRow = { timezone: null };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "America/New_York");

  membershipRow = { timezone: "   " };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "America/New_York");
});

test("an unusable membership timezone falls through to the project's zone, not UTC", async () => {
  memberZone = "Africa/Cairo";
  projectRow = { timezone: "America/New_York" };
  membershipRow = { timezone: "Not/AZone" };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "America/New_York");
});

test("a membership override still wins even when the project declares nothing", async () => {
  memberZone = "Africa/Cairo";
  projectRow = { timezone: null };
  membershipRow = { timezone: "Europe/London" };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "Europe/London");
});

test("a membership override that genuinely declares UTC is honoured", async () => {
  memberZone = "Africa/Cairo";
  projectRow = { timezone: "America/New_York" };
  membershipRow = { timezone: "UTC" };
  assert.equal(await resolveProjectTimeZone("p1", "m1"), "UTC");
});

test("no memberId (task-less/member-less lookup) skips the membership check without erroring", async () => {
  memberZone = "Asia/Tokyo";
  projectRow = { timezone: "America/New_York" };
  membershipRow = { timezone: "Europe/London" };
  // Only reachable if a caller somehow has a project but no member - the
  // membership check needs both ids, so it should be skipped cleanly rather
  // than querying with an undefined member_id.
  assert.equal(await resolveProjectTimeZone("p1", ""), "America/New_York");
});

test("two members on the same project can genuinely differ from each other", async () => {
  memberZone = "Africa/Cairo";
  projectRow = { timezone: "America/New_York" };

  membershipRow = { timezone: "Asia/Tokyo" };
  const memberOneZone = await resolveProjectTimeZone("p1", "m1");

  membershipRow = null;
  const memberTwoZone = await resolveProjectTimeZone("p1", "m2");

  assert.equal(memberOneZone, "Asia/Tokyo", "member with an override uses it");
  assert.equal(memberTwoZone, "America/New_York", "member without one still uses the project's zone");
});
