// Guards AC-4: the integrity score is a transparent sum of named, visible
// penalties (never a hidden multiplier), and view/contest access is gated to
// the flagged member themselves or management - nobody else, and nothing here
// ever triggers an automated consequence.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let flagsForSession = [];
let flagsForMember = [];
let flagById = null;
let contestCalls = [];

mock.module("../src/lib/postgres/integrity-postgres.service.js", {
  namedExports: {
    listIntegrityFlagsForSessionPg: async () => flagsForSession,
    listIntegrityFlagsForMemberPg: async () => flagsForMember,
    getIntegrityFlagByIdPg: async () => flagById,
    contestIntegrityFlagPg: async (id, note) => {
      contestCalls.push({ id, note });
      return { id, session_id: "s1", flag_type: "screenshot_staleness", detail: "d", detected_at: new Date(), contested: true, contested_at: new Date(), contested_note: note };
    },
  },
});

const {
  computeIntegrityScore,
  getSessionIntegritySummary,
  getMemberIntegrityFlags,
  contestIntegrityFlag,
} = await import("../src/modules/activity/integrity-score.js");

const SELF = { memberId: "member-1", roleName: "Employee" };
const OTHER_EMPLOYEE = { memberId: "member-2", roleName: "Employee" };
const ADMIN = { memberId: "admin-1", roleName: "Admin" };

function reset() {
  flagsForSession = [];
  flagsForMember = [];
  flagById = null;
  contestCalls = [];
}

// --- computeIntegrityScore (pure) ----------------------------------------

test("no flags at all is a perfect score with no factors", () => {
  const { score, factors } = computeIntegrityScore({ flagTypes: [] });
  assert.equal(score, 100);
  assert.deepEqual(factors, []);
});

test("an injected_input flag costs its full named weight", () => {
  const { score, factors } = computeIntegrityScore({ flagTypes: ["injected_input"] });
  assert.equal(score, 60); // 100 - 40
  assert.equal(factors.length, 1);
  assert.equal(factors[0].type, "injected_input");
});

test("each flag type contributes its own named, visible penalty", () => {
  const { score, factors } = computeIntegrityScore({
    flagTypes: ["screenshot_staleness", "category_conflict"],
  });
  assert.equal(score, 50); // 100 - 25 - 25
  assert.equal(factors.length, 2);
  assert(factors.every((f) => typeof f.label === "string" && f.label.length > 0));
});

test("duplicate flag rows of the same type are not double-penalized", () => {
  const { score } = computeIntegrityScore({
    flagTypes: ["screenshot_staleness", "screenshot_staleness"],
  });
  assert.equal(score, 75); // 25 penalty applied once, not twice
});

test("an unknown flag type contributes no penalty rather than crashing", () => {
  const { score, factors } = computeIntegrityScore({ flagTypes: ["something_new"] });
  assert.equal(score, 100);
  assert.deepEqual(factors, []);
});

test("penalties stack across every distinct flag type", () => {
  const { score } = computeIntegrityScore({
    flagTypes: ["injected_input", "screenshot_staleness", "category_conflict"],
  });
  assert.equal(score, 10); // 100 - 40 - 25 - 25
});

test("the score is clamped at 0, never negative", () => {
  const { score } = computeIntegrityScore({
    flagTypes: ["injected_input", "screenshot_staleness", "category_conflict", "screenshot_staleness"],
  });
  assert.equal(score, 10);
});

// --- getSessionIntegritySummary (orchestration) --------------------------

test("session summary derives its score purely from that session's own flags", async () => {
  reset();
  flagsForSession = [
    { id: "f1", flag_type: "category_conflict", detail: "d", detected_at: new Date(), contested: false },
    { id: "f2", flag_type: "injected_input", detail: "d2", detected_at: new Date(), contested: false },
  ];
  const summary = await getSessionIntegritySummary("s1");
  assert.equal(summary.sessionId, "s1");
  assert.equal(summary.score, 100 - 25 - 40);
  assert.equal(summary.flags.length, 2);
});

test("a session with no flags at all scores a clean 100", async () => {
  reset();
  const summary = await getSessionIntegritySummary("s2");
  assert.equal(summary.score, 100);
  assert.deepEqual(summary.flags, []);
});

// --- getMemberIntegrityFlags (self-or-management gate) -------------------

test("a member can view their own flags", async () => {
  reset();
  flagsForMember = [{ id: "f1", session_id: "s1", flag_type: "screenshot_staleness", detail: "d", detected_at: new Date(), contested: false, contested_at: null, contested_note: null }];
  const flags = await getMemberIntegrityFlags(SELF.memberId, SELF);
  assert.equal(flags.length, 1);
});

test("one employee cannot view another employee's flags", async () => {
  reset();
  await assert.rejects(() => getMemberIntegrityFlags(OTHER_EMPLOYEE.memberId, SELF), /FORBIDDEN|not allowed/i);
});

test("management can view any member's flags", async () => {
  reset();
  flagsForMember = [];
  await assert.doesNotReject(() => getMemberIntegrityFlags(OTHER_EMPLOYEE.memberId, ADMIN));
});

// --- contestIntegrityFlag (owner-or-management gate, no side effects) ----

test("the flagged member can contest their own flag", async () => {
  reset();
  flagById = { id: "f1", member_id: SELF.memberId, session_id: "s1" };
  const updated = await contestIntegrityFlag("f1", "it was a legitimate review session", SELF);
  assert.equal(updated.contested, true);
  assert.equal(contestCalls.length, 1);
  assert.equal(contestCalls[0].note, "it was a legitimate review session");
});

test("a different employee cannot contest someone else's flag", async () => {
  reset();
  flagById = { id: "f1", member_id: SELF.memberId, session_id: "s1" };
  await assert.rejects(() => contestIntegrityFlag("f1", "not mine", OTHER_EMPLOYEE), /FORBIDDEN|not allowed/i);
  assert.equal(contestCalls.length, 0);
});

test("management can contest a flag on any member's behalf", async () => {
  reset();
  flagById = { id: "f1", member_id: SELF.memberId, session_id: "s1" };
  await assert.doesNotReject(() => contestIntegrityFlag("f1", "reviewed, false positive", ADMIN));
  assert.equal(contestCalls.length, 1);
});

test("contesting a flag that does not exist is a clean NOT_FOUND, not a crash", async () => {
  reset();
  flagById = null;
  await assert.rejects(() => contestIntegrityFlag("missing", "note", SELF), /NOT_FOUND|not found/i);
});
