// Guards the policy for the timezone the desktop agent reports.
//
// Why a policy at all: `members.timezone` was only ever written by an explicit
// save on the web profile page, so anyone who only used the agent had none and
// silently fell back to UTC - booking their hours to the wrong calendar day.
// The agent knows the machine's zone, so it now reports it.
//
// But which day a session lands on decides whether a daily cap is reached, so
// a client that could redefine its own day boundary at will could roll over to
// a "new day" and collect a fresh allowance. Hence: fill a blank, never
// overwrite an existing value.
import test from "node:test";
import assert from "node:assert/strict";
import { decideTimezoneAdoption } from "../src/modules/activity/adopt-reported-timezone.js";

test("a member with no timezone adopts what the agent reported", () => {
  assert.deepEqual(decideTimezoneAdoption(null, "Africa/Cairo"), {
    action: "adopt",
    timeZone: "Africa/Cairo",
  });
  assert.deepEqual(decideTimezoneAdoption("", "America/New_York"), {
    action: "adopt",
    timeZone: "America/New_York",
  });
  assert.deepEqual(decideTimezoneAdoption("   ", "Asia/Tokyo"), {
    action: "adopt",
    timeZone: "Asia/Tokyo",
  });
});

test("an existing timezone is never overwritten by the agent - that is the cap-evasion guard", () => {
  const decision = decideTimezoneAdoption("Africa/Cairo", "Pacific/Kiritimati");
  assert.equal(decision.action, "diverged", "reported, but not applied");
  assert.equal(decision.stored, "Africa/Cairo");
  assert.equal(decision.reported, "Pacific/Kiritimati");
});

test("a matching timezone is a no-op rather than a pointless write", () => {
  assert.deepEqual(decideTimezoneAdoption("Africa/Cairo", "Africa/Cairo"), { action: "none" });
});

test("an alias matching the stored canonical zone is not treated as divergence", () => {
  // The agent could report either spelling depending on the OS; they are the
  // same zone and must not look like the member moved.
  assert.deepEqual(decideTimezoneAdoption("Asia/Kolkata", "Asia/Calcutta"), { action: "none" });
});

test("a member with no timezone adopting a legacy alias keeps that zone's real rules", () => {
  const decision = decideTimezoneAdoption(null, "Asia/Calcutta");
  assert.equal(decision.action, "adopt");
  // Must not be silently downgraded to UTC, which would move their whole day.
  assert.notEqual(decision.timeZone, "UTC");
});

test("garbage from the agent is ignored rather than written as a confident UTC", () => {
  // canonicalizeTimeZone falls back to UTC for anything unusable, so without
  // this guard an unparseable value would fill an empty field with a
  // wrong-but-plausible UTC and look deliberate forever after.
  assert.deepEqual(decideTimezoneAdoption(null, "Not/AZone"), { action: "none" });
  assert.deepEqual(decideTimezoneAdoption(null, "garbage"), { action: "none" });
});

test("an agent genuinely reporting UTC is still honoured", () => {
  assert.deepEqual(decideTimezoneAdoption(null, "UTC"), { action: "adopt", timeZone: "UTC" });
  assert.deepEqual(decideTimezoneAdoption(null, "Etc/UTC"), { action: "adopt", timeZone: "UTC" });
});

test("no report at all changes nothing", () => {
  assert.deepEqual(decideTimezoneAdoption(null, null), { action: "none" });
  assert.deepEqual(decideTimezoneAdoption("Africa/Cairo", null), { action: "none" });
  assert.deepEqual(decideTimezoneAdoption("Africa/Cairo", ""), { action: "none" });
});
