import test from "node:test";
import assert from "node:assert/strict";
import { activityDomainKey, activityFor, averageActivity, totalActivityBy } from "../src/modules/activity/activity-average.js";

test("the average of no screenshots is unknown, not zero", () => {
  assert.equal(averageActivity(0, 0), null);
  assert.equal(averageActivity(150, 2), 75);
});

test("levels are totalled per key, and rows without a key are left out", () => {
  const rows = [
    { app_name: "Code", activity_level: 80 },
    { app_name: "Code", activity_level: 61 },
    { app_name: "Slack", activity_level: 20 },
    { app_name: "", activity_level: 99 },
  ];
  const totals = totalActivityBy(rows, (r) => r.app_name);
  assert.equal(activityFor(totals, "Code"), 71);
  assert.equal(activityFor(totals, "Slack"), 20);
  assert.equal(activityFor(totals, "Teams"), null);
  assert.equal(totals.size, 2);
});

test("a site matches with or without www and in any case", () => {
  assert.equal(activityDomainKey("WWW.GitHub.com"), "github.com");
  assert.equal(activityDomainKey(null), "");
});
