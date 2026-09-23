// The gate that decides whether an agent is offered an update at all
// (PLAN-notifications-and-owner-messaging.md Part C3).
//
// Getting this wrong is expensive in both directions: too low and agents that
// cannot survive an update are handed one anyway, which is the failure this
// exists to stop; too high and healthy agents silently stop receiving updates.
import test from "node:test";
import assert from "node:assert/strict";
import { canSelfUpdate, compareVersions } from "../src/modules/update/update-routes.js";

test("versions compare numerically, not as text", () => {
  // The bug a string compare would produce: "1.0.9" > "1.0.10".
  assert.ok(compareVersions("1.0.10", "1.0.9") > 0);
  assert.ok(compareVersions("1.0.9", "1.0.10") < 0);
  assert.equal(compareVersions("1.0.27", "1.0.27"), 0);
  assert.ok(compareVersions("2.0.0", "1.9.9") > 0);
  assert.ok(compareVersions("v1.0.27", "1.0.27") === 0, "a leading v is tolerated");
  assert.ok(compareVersions("1.0.27-beta.1", "1.0.27") === 0, "pre-release suffixes are ignored");
});

test("agents that cannot survive an update are not offered one", () => {
  for (const old of ["1.0.0", "1.0.22", "1.0.25", "1.0.26"]) {
    assert.equal(canSelfUpdate(old), false, `${old} must not be served an update`);
  }
});

test("agents from the fixed version onward update normally", () => {
  for (const ok of ["1.0.27", "1.0.28", "1.0.30", "1.1.0", "2.0.0"]) {
    assert.equal(canSelfUpdate(ok), true, `${ok} must be served updates`);
  }
});

test("an unreadable version is treated as too old, not assumed safe", () => {
  for (const bad of ["", "unknown", "abc", null, undefined]) {
    assert.equal(canSelfUpdate(bad), false, `${String(bad)} must not be served an update`);
  }
});
