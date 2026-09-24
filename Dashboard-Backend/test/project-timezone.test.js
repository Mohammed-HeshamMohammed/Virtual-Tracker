import test from "node:test";
import assert from "node:assert/strict";
import { canSetProjectTimezone, resolveProjectTimezoneInput } from "../src/modules/projects/project-timezone.js";

test("manager and enterprise manager and above may set it", () => {
  for (const role of ["Owner", "Super Admin", "Admin", "Super Manager", "Enterprise Super Manager", "Manager", "Enterprise Manager"]) {
    assert.equal(canSetProjectTimezone(role), true, role);
  }
});

test("team lead and below may not", () => {
  for (const role of ["Team Lead", "Employee", "Intern", "Client", "Viewer", "", null, undefined]) {
    assert.equal(canSetProjectTimezone(role), false, String(role));
  }
});

test("an unrecognised role is refused rather than given the benefit of the doubt", () => {
  // rolePrivilegeRank returns 35 for an unknown role, which is below the bar.
  assert.equal(canSetProjectTimezone("Chief Vibes Officer"), false);
});

test("undefined leaves the stored value alone and never checks the role", () => {
  assert.equal(resolveProjectTimezoneInput(undefined, "Employee"), undefined);
});

test("a permitted role gets a canonical zone back", () => {
  assert.equal(resolveProjectTimezoneInput("America/New_York", "Manager"), "America/New_York");
  assert.equal(resolveProjectTimezoneInput("  Asia/Tokyo  ", "Enterprise Manager"), "Asia/Tokyo");
});

test("null or blank clears it back to the member's own zone", () => {
  assert.equal(resolveProjectTimezoneInput(null, "Manager"), null);
  assert.equal(resolveProjectTimezoneInput("", "Manager"), null);
  assert.equal(resolveProjectTimezoneInput("   ", "Manager"), null);
});

test("a role below the bar is refused before the value is even looked at", () => {
  assert.throws(() => resolveProjectTimezoneInput("Asia/Tokyo", "Team Lead"), { code: "FORBIDDEN" });
  assert.throws(() => resolveProjectTimezoneInput(null, "Employee"), { code: "FORBIDDEN" });
});

test("an unusable zone is rejected rather than silently becoming UTC", () => {
  // canonicalizeTimeZone answers UTC for anything it cannot resolve, and
  // resolveProjectTimeZone then falls back to the member's zone - so accepting
  // it would store a value that reads as the setting having been ignored.
  assert.throws(() => resolveProjectTimezoneInput("Mars/Olympus_Mons", "Manager"), { code: "INVALID_TIMEZONE" });
  assert.throws(() => resolveProjectTimezoneInput("not a zone", "Admin"), { code: "INVALID_TIMEZONE" });
});

test("UTC itself is still accepted", () => {
  assert.equal(resolveProjectTimezoneInput("UTC", "Manager"), "UTC");
  assert.equal(resolveProjectTimezoneInput("utc", "Manager"), "UTC");
});
