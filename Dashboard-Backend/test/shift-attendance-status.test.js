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
