// Guards the AC-1/AC-2 sweep job's wiring: grouping rows by session,
// resolving category once per distinct app/domain name, and only inserting a
// flag when the underlying detectors (integrity-checks.js) actually trip.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let screenshots = [];
let activityRows = [];
let appRows = [];
let urlRows = [];
let insertedFlags = [];
let categoryMap = {};

mock.module("../src/lib/postgres/integrity-postgres.service.js", {
  namedExports: {
    fetchRecentScreenshotsPg: async () => screenshots,
    fetchRecentActivityLevelsBySessionPg: async () => activityRows,
    fetchRecentAppLogNamesPg: async () => appRows,
    fetchRecentUrlLogDomainsPg: async () => urlRows,
    insertIntegrityFlagPg: async (row) => {
      insertedFlags.push(row);
    },
  },
});
mock.module("../src/modules/classification/activity-categories.js", {
  namedExports: {
    categorize: async (_matchType, name) => categoryMap[name] ?? "unclassified",
  },
});

const { runIntegrityChecks } = await import("../src/modules/activity/integrity-sweep.service.js");
const {
  STALENESS_MIN_RUN,
  HIGH_ACTIVITY_THRESHOLD,
  CATEGORY_CONFLICT_MIN_SECONDS,
  INJECTED_INPUT_MIN_CAPTURES,
} = await import("../src/modules/activity/integrity-checks.js");

function reset() {
  screenshots = [];
  activityRows = [];
  appRows = [];
  urlRows = [];
  insertedFlags = [];
  categoryMap = {};
}

test("a sustained static-screen-high-activity session gets a staleness flag", async () => {
  reset();
  for (let i = 0; i < STALENESS_MIN_RUN + 1; i++) {
    screenshots.push({
      member_id: "m1",
      session_id: "s1",
      perceptual_hash: "0000000000000000",
      activity_level: HIGH_ACTIVITY_THRESHOLD,
    });
  }
  await runIntegrityChecks();
  assert.equal(insertedFlags.length, 1);
  assert.equal(insertedFlags[0].flagType, "screenshot_staleness");
  assert.equal(insertedFlags[0].sessionId, "s1");
  assert.equal(insertedFlags[0].memberId, "m1");
});

test("a session with genuinely changing screenshots gets no staleness flag", async () => {
  reset();
  screenshots.push(
    { member_id: "m1", session_id: "s1", perceptual_hash: "1000000000000000", activity_level: HIGH_ACTIVITY_THRESHOLD },
    { member_id: "m1", session_id: "s1", perceptual_hash: "ffffffffffffffff", activity_level: HIGH_ACTIVITY_THRESHOLD },
  );
  await runIntegrityChecks();
  assert.equal(insertedFlags.length, 0);
});

test("sustained distracting foreground with high average activity gets a category-conflict flag", async () => {
  reset();
  categoryMap["YouTube"] = "distracting";
  appRows.push({ session_id: "s2", member_id: "m2", app_name: "YouTube", duration_seconds: CATEGORY_CONFLICT_MIN_SECONDS + 60 });
  activityRows.push({ session_id: "s2", member_id: "m2", avg_activity: HIGH_ACTIVITY_THRESHOLD });
  await runIntegrityChecks();
  assert.equal(insertedFlags.length, 1);
  assert.equal(insertedFlags[0].flagType, "category_conflict");
  assert.equal(insertedFlags[0].sessionId, "s2");
});

test("distracting foreground time is ignored for an app not categorized distracting", async () => {
  reset();
  categoryMap["Figma"] = "productive";
  appRows.push({ session_id: "s3", member_id: "m3", app_name: "Figma", duration_seconds: CATEGORY_CONFLICT_MIN_SECONDS + 60 });
  activityRows.push({ session_id: "s3", member_id: "m3", avg_activity: HIGH_ACTIVITY_THRESHOLD });
  await runIntegrityChecks();
  assert.equal(insertedFlags.length, 0);
});

test("distracting domain time accumulates alongside distracting app time in the same session", async () => {
  reset();
  categoryMap["youtube.com"] = "distracting";
  categoryMap["reddit.com"] = "distracting";
  urlRows.push(
    { session_id: "s4", member_id: "m4", domain: "youtube.com", duration_seconds: CATEGORY_CONFLICT_MIN_SECONDS / 2 },
    { session_id: "s4", member_id: "m4", domain: "reddit.com", duration_seconds: CATEGORY_CONFLICT_MIN_SECONDS / 2 + 60 },
  );
  activityRows.push({ session_id: "s4", member_id: "m4", avg_activity: HIGH_ACTIVITY_THRESHOLD });
  await runIntegrityChecks();
  assert.equal(insertedFlags.length, 1);
});

test("a legitimate low-activity distracting-tab session (e.g. music playing quietly) is not flagged", async () => {
  reset();
  categoryMap["Spotify"] = "distracting";
  appRows.push({ session_id: "s5", member_id: "m5", app_name: "Spotify", duration_seconds: CATEGORY_CONFLICT_MIN_SECONDS * 3 });
  activityRows.push({ session_id: "s5", member_id: "m5", avg_activity: 5 });
  await runIntegrityChecks();
  assert.equal(insertedFlags.length, 0);
});

test("a session where most signal-bearing captures show injected input gets an injected_input flag", async () => {
  reset();
  for (let i = 0; i < INJECTED_INPUT_MIN_CAPTURES; i++) {
    screenshots.push({ member_id: "m6", session_id: "s6", keystroke_count: 5, injected_event_count: 3 });
  }
  await runIntegrityChecks();
  assert.equal(insertedFlags.length, 1);
  assert.equal(insertedFlags[0].flagType, "injected_input");
  assert.equal(insertedFlags[0].sessionId, "s6");
  assert.equal(insertedFlags[0].memberId, "m6");
});

test("a session with only one stray injected capture out of many real ones is not flagged", async () => {
  reset();
  for (let i = 0; i < 20; i++) {
    screenshots.push({ member_id: "m7", session_id: "s7", keystroke_count: 10, injected_event_count: 0 });
  }
  screenshots.push({ member_id: "m7", session_id: "s7", keystroke_count: 0, injected_event_count: 1 });
  await runIntegrityChecks();
  assert.equal(insertedFlags.filter((f) => f.flagType === "injected_input").length, 0);
});

test("captures with no signal at all (no keystrokes, nothing injected) are ignored, not counted as clean", async () => {
  reset();
  for (let i = 0; i < 20; i++) {
    screenshots.push({ member_id: "m8", session_id: "s8", keystroke_count: 0, injected_event_count: 0 });
  }
  await runIntegrityChecks();
  assert.equal(insertedFlags.filter((f) => f.flagType === "injected_input").length, 0);
});

test("staleness and injected-input checks run independently over the same fetched rows", async () => {
  reset();
  const captureCount = Math.max(STALENESS_MIN_RUN + 1, INJECTED_INPUT_MIN_CAPTURES);
  for (let i = 0; i < captureCount; i++) {
    screenshots.push({
      member_id: "m9",
      session_id: "s9",
      perceptual_hash: "0000000000000000",
      activity_level: HIGH_ACTIVITY_THRESHOLD,
      keystroke_count: 5,
      injected_event_count: 5,
    });
  }
  await runIntegrityChecks();
  const flagTypes = insertedFlags.filter((f) => f.sessionId === "s9").map((f) => f.flagType).sort();
  assert.deepEqual(flagTypes, ["injected_input", "screenshot_staleness"]);
});
