// Attendance used to be a two-way split - anything tracked was "worked",
// anything else on a working day was "missed" - so approved leave and an
// agreed makeup day both read as a no-show.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveAttendanceStatus } from "../src/lib/postgres/misc-reports-postgres.service.js";

test("a working day with tracked time is worked", () => {
  assert.equal(
    resolveAttendanceStatus({ scheduled: true, worked: true, onLeave: false, makeupAgreed: false }),
    "worked",
  );
});

test("an empty working day with nothing excusing it is missed", () => {
  assert.equal(
    resolveAttendanceStatus({ scheduled: true, worked: false, onLeave: false, makeupAgreed: false }),
    "missed",
  );
});

test("approved leave is not a no-show", () => {
  assert.equal(
    resolveAttendanceStatus({ scheduled: true, worked: false, onLeave: true, makeupAgreed: false }),
    "time-off",
  );
});

test("a missed day with an agreed makeup is excused", () => {
  assert.equal(
    resolveAttendanceStatus({ scheduled: true, worked: false, onLeave: false, makeupAgreed: true }),
    "excused",
  );
});

// Someone who tracked time while nominally on leave did the work, and the
// report should say so rather than insisting they were away.
test("tracking time on a leave day still counts as worked", () => {
  assert.equal(
    resolveAttendanceStatus({ scheduled: true, worked: true, onLeave: true, makeupAgreed: false }),
    "worked",
  );
});

test("work on a non-working day is unscheduled", () => {
  assert.equal(
    resolveAttendanceStatus({ scheduled: false, worked: true, onLeave: false, makeupAgreed: false }),
    "unscheduled",
  );
});

test("a non-working day with nothing on it is unscheduled, never missed", () => {
  assert.equal(
    resolveAttendanceStatus({ scheduled: false, worked: false, onLeave: false, makeupAgreed: false }),
    "unscheduled",
  );
});

// The makeup day itself is expected work, so failing to turn up for it is a
// genuine miss rather than an unscheduled blank.
test("an empty agreed makeup day is missed, not unscheduled", () => {
  assert.equal(
    resolveAttendanceStatus({ scheduled: true, worked: false, onLeave: false, makeupAgreed: false }),
    "missed",
  );
});

// PLAN-bug-fixes-round-1.md item 13: a scheduled day could previously only be
// "worked" or "missed" - one tracked second counted the same as a full day.
// The member's own configured daily hours (limits.daily) now separate a full
// day from a short one. There are still no shift START/END times anywhere in
// this schema, so this reports length, never lateness.
const HOUR = 3600;

test("a scheduled day worked for less than the member's daily hours is short", () => {
  assert.equal(
    resolveAttendanceStatus({
      scheduled: true,
      worked: true,
      onLeave: false,
      makeupAgreed: false,
      activeSeconds: 3 * HOUR,
      expectedSeconds: 8 * HOUR,
    }),
    "short",
  );
});

test("meeting the daily hours exactly is worked, not short", () => {
  assert.equal(
    resolveAttendanceStatus({
      scheduled: true,
      worked: true,
      onLeave: false,
      makeupAgreed: false,
      activeSeconds: 8 * HOUR,
      expectedSeconds: 8 * HOUR,
    }),
    "worked",
  );
});

test("going over the daily hours is worked, never short", () => {
  assert.equal(
    resolveAttendanceStatus({
      scheduled: true,
      worked: true,
      onLeave: false,
      makeupAgreed: false,
      activeSeconds: 10 * HOUR,
      expectedSeconds: 8 * HOUR,
    }),
    "worked",
  );
});

// The guard that keeps this from manufacturing "short" days across every
// workspace that does not set per-member daily limits.
test("with no daily limit configured a worked day stays plain worked", () => {
  assert.equal(
    resolveAttendanceStatus({
      scheduled: true,
      worked: true,
      onLeave: false,
      makeupAgreed: false,
      activeSeconds: 1 * HOUR,
      expectedSeconds: 0,
    }),
    "worked",
  );
});

test("a short day still beats being counted as missed", () => {
  // The distinction that matters to a manager reading the report: nothing
  // tracked at all is a no-show; two hours of an eight-hour day is not.
  assert.notEqual(
    resolveAttendanceStatus({
      scheduled: true,
      worked: true,
      onLeave: false,
      makeupAgreed: false,
      activeSeconds: 2 * HOUR,
      expectedSeconds: 8 * HOUR,
    }),
    "missed",
  );
});

test("an unscheduled day worked below any daily limit is still unscheduled", () => {
  assert.equal(
    resolveAttendanceStatus({
      scheduled: false,
      worked: true,
      onLeave: false,
      makeupAgreed: false,
      activeSeconds: 1 * HOUR,
      expectedSeconds: 8 * HOUR,
    }),
    "unscheduled",
  );
});
