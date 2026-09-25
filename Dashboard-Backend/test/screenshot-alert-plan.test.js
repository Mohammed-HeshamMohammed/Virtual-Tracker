// With screenshots switched off there are none to be missing, and any that
// arrive are discarded. Alerting on either reports a setting somebody chose, or
// links to screenshots that do not exist.
import test from "node:test";
import assert from "node:assert/strict";
import { planScreenshotAlerts } from "../src/modules/activity/screenshot-alert-plan.js";

const shot = (activityLevel) => ({ type: "screenshot", activityLevel });
const app = () => ({ type: "app" });

test("screenshots off: an app-only batch does not report a missing screenshot", () => {
  assert.deepEqual(planScreenshotAlerts([app(), app()], false), { lowActivityLevels: [], missingScreenshot: false });
});

test("screenshots off: a discarded screenshot does not raise a low-activity alert", () => {
  const plan = planScreenshotAlerts([shot(3), app()], false);
  assert.deepEqual(plan.lowActivityLevels, []);
  assert.equal(plan.missingScreenshot, false);
});

test("screenshots on: an app-only batch can report a missing screenshot", () => {
  assert.equal(planScreenshotAlerts([app()], true).missingScreenshot, true);
});

test("screenshots on: each screenshot's activity level is passed on, in order", () => {
  assert.deepEqual(planScreenshotAlerts([shot(12), app(), shot(80)], true).lowActivityLevels, [12, 80]);
});

test("screenshots on: a batch that has a screenshot never also reports one missing", () => {
  const plan = planScreenshotAlerts([shot(50), app()], true);
  assert.equal(plan.missingScreenshot, false);
});

test("a screenshot with no numeric level is ignored rather than alerting on nothing", () => {
  assert.deepEqual(planScreenshotAlerts([{ type: "screenshot" }, shot("high"), shot(7)], true).lowActivityLevels, [7]);
});

test("a batch of other event types alerts about neither", () => {
  assert.deepEqual(planScreenshotAlerts([{ type: "url" }], true), { lowActivityLevels: [], missingScreenshot: false });
});

test("junk in the batch is skipped rather than throwing", () => {
  assert.deepEqual(planScreenshotAlerts([null, undefined, "x", 5, shot(9)], true).lowActivityLevels, [9]);
  assert.deepEqual(planScreenshotAlerts(null, true), { lowActivityLevels: [], missingScreenshot: false });
  assert.deepEqual(planScreenshotAlerts(undefined, false), { lowActivityLevels: [], missingScreenshot: false });
});

test("an empty batch alerts about nothing either way", () => {
  assert.deepEqual(planScreenshotAlerts([], true), { lowActivityLevels: [], missingScreenshot: false });
  assert.deepEqual(planScreenshotAlerts([], false), { lowActivityLevels: [], missingScreenshot: false });
});
