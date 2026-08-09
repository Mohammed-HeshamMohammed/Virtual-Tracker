// Guards AC-2's two flag conditions (both require sustained high activity
// alongside the fraud signal, which is what keeps a genuine low-activity
// reading session unflagged) and AC-1's sustained-injection condition (a
// handful of captures, or a low ratio, is not enough to flag).
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectScreenshotStaleness,
  detectCategoryConflict,
  detectSustainedInjection,
  STALENESS_HAMMING_THRESHOLD,
  STALENESS_MIN_RUN,
  HIGH_ACTIVITY_THRESHOLD,
  CATEGORY_CONFLICT_MIN_SECONDS,
  INJECTED_INPUT_MIN_CAPTURES,
  INJECTED_INPUT_RATE_THRESHOLD,
} from "../src/modules/activity/integrity-checks.js";

const SAME_HASH = "0000000000000000";
const DIFFERENT_HASH = "ffffffffffffffff";

function shot(hash, activityLevel) {
  return { perceptualHash: hash, activityLevel };
}

test("a sustained run of near-identical screenshots with high activity is flagged", () => {
  const shots = [];
  for (let i = 0; i < STALENESS_MIN_RUN + 1; i++) shots.push(shot(SAME_HASH, HIGH_ACTIVITY_THRESHOLD));
  assert.equal(detectScreenshotStaleness(shots), true);
});

test("a static screen with LOW activity is not flagged (legitimate quiet reading)", () => {
  const shots = [];
  for (let i = 0; i < STALENESS_MIN_RUN + 3; i++) shots.push(shot(SAME_HASH, 10));
  assert.equal(detectScreenshotStaleness(shots), false);
});

test("high activity with a genuinely changing screen is not flagged", () => {
  const shots = [
    shot("1000000000000000", HIGH_ACTIVITY_THRESHOLD),
    shot("2000000000000000", HIGH_ACTIVITY_THRESHOLD),
    shot("4000000000000000", HIGH_ACTIVITY_THRESHOLD),
    shot(DIFFERENT_HASH, HIGH_ACTIVITY_THRESHOLD),
  ];
  assert.equal(detectScreenshotStaleness(shots), false);
});

test("a run shorter than STALENESS_MIN_RUN does not flag", () => {
  const shots = [];
  for (let i = 0; i < STALENESS_MIN_RUN - 1; i++) shots.push(shot(SAME_HASH, HIGH_ACTIVITY_THRESHOLD));
  assert.equal(detectScreenshotStaleness(shots), false);
});

test("a broken run (one real change in the middle) resets and does not flag", () => {
  const shots = [
    shot(SAME_HASH, HIGH_ACTIVITY_THRESHOLD),
    shot(SAME_HASH, HIGH_ACTIVITY_THRESHOLD),
    shot(DIFFERENT_HASH, HIGH_ACTIVITY_THRESHOLD), // breaks the run
    shot(DIFFERENT_HASH, HIGH_ACTIVITY_THRESHOLD),
  ];
  assert.equal(detectScreenshotStaleness(shots), false);
});

test("hashes just within the staleness threshold still count as near-identical", () => {
  // "0" vs "1" differ in exactly 1 bit - comfortably inside STALENESS_HAMMING_THRESHOLD.
  assert(STALENESS_HAMMING_THRESHOLD >= 1);
  const shots = [];
  for (let i = 0; i < STALENESS_MIN_RUN + 1; i++) {
    shots.push(shot(i % 2 === 0 ? "0000000000000000" : "0000000000000001", HIGH_ACTIVITY_THRESHOLD));
  }
  assert.equal(detectScreenshotStaleness(shots), true);
});

test("a sustained distracting span with high activity is a category conflict", () => {
  assert.equal(detectCategoryConflict(CATEGORY_CONFLICT_MIN_SECONDS, HIGH_ACTIVITY_THRESHOLD), true);
  assert.equal(detectCategoryConflict(CATEGORY_CONFLICT_MIN_SECONDS + 1, 100), true);
});

test("a short distracting span is not flagged even at high activity", () => {
  assert.equal(detectCategoryConflict(CATEGORY_CONFLICT_MIN_SECONDS - 1, 100), false);
});

test("a long distracting span with low activity is not flagged", () => {
  assert.equal(detectCategoryConflict(CATEGORY_CONFLICT_MIN_SECONDS * 2, HIGH_ACTIVITY_THRESHOLD - 1), false);
});

test("a large majority of captures showing injected input, with enough of them, is flagged", () => {
  assert.equal(detectSustainedInjection(INJECTED_INPUT_MIN_CAPTURES, INJECTED_INPUT_MIN_CAPTURES), true);
});

test("exactly at the rate threshold is flagged (boundary inclusive)", () => {
  assert.equal(detectSustainedInjection(10, 10 * INJECTED_INPUT_RATE_THRESHOLD), true);
});

test("too few signal-bearing captures is never flagged, even at 100% injected", () => {
  assert.equal(detectSustainedInjection(INJECTED_INPUT_MIN_CAPTURES - 1, INJECTED_INPUT_MIN_CAPTURES - 1), false);
});

test("enough captures but a low injected ratio is not flagged (one stray injected click is normal)", () => {
  assert.equal(detectSustainedInjection(20, 1), false);
});

test("zero signal-bearing captures is never flagged, not a division-by-zero crash", () => {
  assert.equal(detectSustainedInjection(0, 0), false);
});
