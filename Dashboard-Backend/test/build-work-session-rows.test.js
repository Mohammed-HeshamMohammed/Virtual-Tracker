import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkSessionRows } from "../src/modules/reports/build-work-session-rows.js";

// The bug this guards: a work session was dated by slicing its ISO timestamp
// (the UTC date) while its clock time was rendered in the *reader's* zone. One
// evening shift therefore appeared on a different day here than in Time &
// Activity, and at a different time depending on who opened the report.

const names = new Map([
  ["m-us", { name: "Dana (Chicago)", avatarUrl: null }],
  ["m-eg", { name: "Omar (Cairo)", avatarUrl: null }],
]);
const zones = new Map([
  ["m-us", "America/Chicago"],
  ["m-eg", "Africa/Cairo"],
]);

const session = (memberId, startedAt) => ({ id: startedAt, memberId, startedAt, endedAt: null });

test("an evening shift is dated by the member's day, not the UTC date", () => {
  // 9pm on the 9th in Chicago is already the 10th in UTC.
  const rows = buildWorkSessionRows(
    [session("m-us", "2026-09-10T02:00:00.000Z")],
    names,
    zones,
    "2026-09-09",
    "2026-09-09",
  );
  assert.equal(rows.length, 1, "the shift must not be filtered out of its own day");
  assert.equal(rows[0].localDay, "2026-09-09");
  assert.notEqual(rows[0].localDay, "2026-09-10", "the raw ISO slice would say this");
  assert.equal(rows[0].memberTimezone, "America/Chicago");
});

test("the member's zone travels with the row so the clock can match", () => {
  const rows = buildWorkSessionRows(
    [session("m-eg", "2026-09-09T11:00:00.000Z"), session("m-us", "2026-09-09T11:00:00.000Z")],
    names,
    zones,
    "2026-09-09",
    "2026-09-09",
  );
  // Same instant, two members - each must carry its own clock.
  assert.deepEqual(
    rows.map((r) => r.memberTimezone),
    ["Africa/Cairo", "America/Chicago"],
  );
  const onOwnClock = (row) =>
    new Date(row.startedAt).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: row.memberTimezone,
    });
  assert.equal(onOwnClock(rows[0]), "2:00 PM", "Cairo member sees their own afternoon");
  assert.equal(onOwnClock(rows[1]), "6:00 AM", "Chicago member sees their own morning");
});

test("the over-fetched day either side is trimmed back off", () => {
  // The query widens the window by a day on each side; anything whose member
  // -local day falls outside the requested range must not survive.
  const rows = buildWorkSessionRows(
    [
      session("m-us", "2026-09-09T02:00:00.000Z"), // 8th, 9pm Chicago - before range
      session("m-us", "2026-09-10T02:00:00.000Z"), // 9th, 9pm Chicago - in range
      session("m-us", "2026-09-11T02:00:00.000Z"), // 10th, 9pm Chicago - after range
    ],
    names,
    zones,
    "2026-09-09",
    "2026-09-09",
  );
  assert.deepEqual(rows.map((r) => r.localDay), ["2026-09-09"]);
});

test("a member with no timezone on file falls back to UTC rather than dropping", () => {
  const rows = buildWorkSessionRows(
    [session("m-unknown", "2026-09-09T12:00:00.000Z")],
    new Map(),
    new Map(),
    "2026-09-09",
    "2026-09-09",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].memberTimezone, "UTC");
  assert.equal(rows[0].localDay, "2026-09-09");
  assert.equal(rows[0].memberName, "Unknown");
});
