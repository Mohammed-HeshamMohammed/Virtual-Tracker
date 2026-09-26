import test from "node:test";
import assert from "node:assert/strict";
import {
  BREAK_TIME_MAX_SEC,
  BREAK_TIME_MESSAGE,
  DEFAULT_BREAK_TIME_SEC,
  breakSettingsOf,
  toStoredBreakTimeSeconds,
  validateBreakTimeSeconds,
} from "../src/modules/projects/break-time.js";

test("the default break is ten minutes", () => {
  assert.equal(DEFAULT_BREAK_TIME_SEC, 600);
  assert.deepEqual(breakSettingsOf(null), { disableBreakLimit: false, breakTimeSeconds: 600 });
  assert.deepEqual(breakSettingsOf({}), { disableBreakLimit: false, breakTimeSeconds: 600 });
});

test("a project's own break time and switch are passed on", () => {
  assert.deepEqual(breakSettingsOf({ break_time_seconds: 1200, disable_break_limit: true }), {
    disableBreakLimit: true,
    breakTimeSeconds: 1200,
  });
});

test("validation accepts one minute to eight hours, numbers or numeric strings", () => {
  assert.equal(validateBreakTimeSeconds(60), null);
  assert.equal(validateBreakTimeSeconds("900"), null);
  assert.equal(validateBreakTimeSeconds(BREAK_TIME_MAX_SEC), null);
});

test("validation rejects too short, too long, blank and non-numeric", () => {
  for (const bad of [0, 59, -5, BREAK_TIME_MAX_SEC + 1, "", "abc", null, undefined, NaN, {}]) {
    assert.equal(validateBreakTimeSeconds(bad), BREAK_TIME_MESSAGE, `expected ${String(bad)} to be rejected`);
  }
});

test("storing falls back to the default and clamps into range", () => {
  assert.equal(toStoredBreakTimeSeconds(undefined), 600);
  assert.equal(toStoredBreakTimeSeconds(null), 600);
  assert.equal(toStoredBreakTimeSeconds(0), 600);
  assert.equal(toStoredBreakTimeSeconds(10), 60);
  assert.equal(toStoredBreakTimeSeconds(999999), BREAK_TIME_MAX_SEC);
  assert.equal(toStoredBreakTimeSeconds(725.9), 725);
});
