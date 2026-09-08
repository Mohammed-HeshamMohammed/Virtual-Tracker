import { test } from "node:test";
import assert from "node:assert/strict";
import { runContaining, splitIntoRuns } from "../src/modules/activity/screenshot-run.js";

// Editing a screenshot's activity level applies to its "capture run" - the
// unbroken stretch of tracked work it belongs to. The agent does not capture
// while idle, so a gap longer than the scheduled maximum is an idle/pause
// boundary. This is the logic most likely to be got wrong and the cheapest to
// pin, so every case from the plan's table lives here.

const MAX_DELAY_SEC = 210; // threshold = 210 * 1.5 = 315s
const BASE = Date.parse("2026-09-04T09:00:00.000Z");

/** shot("a", 0) = id "a" captured at BASE; minutes are offsets. */
const shot = (id, offsetSeconds) => ({
  id,
  captured_at: new Date(BASE + offsetSeconds * 1000).toISOString(),
});

const ids = (run) => run.map((s) => s.id);

test("no idle in the session - the run is the whole session", () => {
  const shots = [shot("a", 0), shot("b", 180), shot("c", 360), shot("d", 540)];
  const runs = splitIntoRuns(shots, MAX_DELAY_SEC);
  assert.equal(runs.length, 1);
  assert.deepEqual(ids(runs[0]), ["a", "b", "c", "d"]);
});

test("idle before - the run starts after the gap, earlier captures untouched", () => {
  //                       gap of 1800s here
  const shots = [shot("a", 0), shot("b", 1800), shot("c", 1980)];
  assert.deepEqual(ids(runContaining(shots, "b", MAX_DELAY_SEC)), ["b", "c"]);
  assert.deepEqual(ids(runContaining(shots, "a", MAX_DELAY_SEC)), ["a"]);
});

test("idle after - the run ends at the gap, later captures untouched", () => {
  const shots = [shot("a", 0), shot("b", 180), shot("c", 1980)];
  assert.deepEqual(ids(runContaining(shots, "a", MAX_DELAY_SEC)), ["a", "b"]);
});

test("idle on both sides - only the captures between the gaps", () => {
  const shots = [shot("a", 0), shot("b", 1800), shot("c", 1980), shot("d", 4000)];
  assert.deepEqual(ids(runContaining(shots, "b", MAX_DELAY_SEC)), ["b", "c"]);
});

test("a capture alone between two gaps affects only itself", () => {
  const shots = [shot("a", 0), shot("b", 1800), shot("c", 4000)];
  assert.deepEqual(ids(runContaining(shots, "b", MAX_DELAY_SEC)), ["b"]);
});

test("ordinary schedule jitter does not split a run", () => {
  // Capture delay is randomised 90-210s; 210s is legal, 315s is the boundary.
  const shots = [shot("a", 0), shot("b", 90), shot("c", 300), shot("d", 510)];
  assert.equal(splitIntoRuns(shots, MAX_DELAY_SEC).length, 1);
});

test("exactly at the threshold does not split; just beyond does", () => {
  assert.equal(splitIntoRuns([shot("a", 0), shot("b", 315)], MAX_DELAY_SEC).length, 1);
  assert.equal(splitIntoRuns([shot("a", 0), shot("b", 316)], MAX_DELAY_SEC).length, 2);
});

test("the threshold follows the server setting, not a hardcoded 210", () => {
  const shots = [shot("a", 0), shot("b", 600)];
  // At max-delay 210 (=315s threshold) 600s is a gap...
  assert.equal(splitIntoRuns(shots, 210).length, 2);
  // ...but an org that raised max-delay to 600 (=900s) is still one run.
  assert.equal(splitIntoRuns(shots, 600).length, 1);
});

test("an agent restart mid-session reads as separate runs, correctly", () => {
  // They genuinely were not one continuous stretch of tracked work.
  const shots = [shot("a", 0), shot("b", 180), shot("c", 7200), shot("d", 7380)];
  assert.deepEqual(ids(runContaining(shots, "a", MAX_DELAY_SEC)), ["a", "b"]);
  assert.deepEqual(ids(runContaining(shots, "c", MAX_DELAY_SEC)), ["c", "d"]);
});

test("input order does not matter - rows are sorted first", () => {
  const shots = [shot("c", 360), shot("a", 0), shot("d", 540), shot("b", 180)];
  assert.deepEqual(ids(splitIntoRuns(shots, MAX_DELAY_SEC)[0]), ["a", "b", "c", "d"]);
});

test("an unknown id yields an empty run, never a wrong one", () => {
  const shots = [shot("a", 0), shot("b", 180)];
  assert.deepEqual(runContaining(shots, "does-not-exist", MAX_DELAY_SEC), []);
});

test("empty and junk input never throw", () => {
  assert.deepEqual(splitIntoRuns([], MAX_DELAY_SEC), []);
  assert.deepEqual(splitIntoRuns(null, MAX_DELAY_SEC), []);
  assert.deepEqual(splitIntoRuns([null, { id: "x", captured_at: "nonsense" }], MAX_DELAY_SEC), []);
  assert.deepEqual(runContaining([], "a", MAX_DELAY_SEC), []);
});

test("a zero or missing max delay still produces a usable threshold", () => {
  // Guards against a divide-by-nothing turning every capture into its own run
  // if the setting is ever unset.
  const shots = [shot("a", 0), shot("b", 1)];
  assert.equal(splitIntoRuns(shots, 0).length, 1, "1s apart must stay one run");
  assert.equal(splitIntoRuns(shots, undefined).length, 1);
});

test("a single screenshot is a run of one", () => {
  assert.deepEqual(ids(runContaining([shot("a", 0)], "a", MAX_DELAY_SEC)), ["a"]);
});
