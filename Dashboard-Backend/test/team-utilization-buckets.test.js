// Team Utilization (PLAN-bug-fixes-round-1.md item 20). Members with no
// weekly limit configured used to be `continue`d over entirely: they counted
// toward nothing and appeared in no bucket, so a workspace that does not set
// an explicit weekly cap per person - a supported, common setup - saw 0%
// with zero members everywhere and reasonably read the widget as broken.
import test from "node:test";
import assert from "node:assert/strict";
import { buildUtilization } from "../src/modules/dashboard/command-center-service.js";

const HOUR = 3600;
const meta = new Map([
  ["m-none", { name: "No Limit", initials: "NL" }],
  ["m-under", { name: "Under", initials: "UN" }],
  ["m-ontrack", { name: "On Track", initials: "OT" }],
  ["m-over", { name: "Over", initials: "OV" }],
]);

test("a member with no weekly limit is surfaced in its own bucket, not dropped", () => {
  const seconds = new Map([["m-none", 20 * HOUR]]);
  const capacity = new Map(); // nothing configured

  const result = buildUtilization(seconds, capacity, meta);

  assert.equal(result.utilizationMembers.noLimit, 1);
  assert.equal(result.utilizationBreakdown.length, 1, "they must still appear in the breakdown");
  assert.equal(result.utilizationBreakdown[0].load, "no_limit");
  assert.equal(result.utilizationBreakdown[0].percent, null, "no capacity means no honest percentage");
  assert.equal(result.utilizationBreakdown[0].hours, 20, "their tracked hours are still reported");
});

test("the percentage is computed only from members who have a limit", () => {
  const seconds = new Map([
    ["m-none", 99 * HOUR], // must not drag the average anywhere
    ["m-ontrack", 20 * HOUR],
  ]);
  const capacity = new Map([["m-ontrack", 40 * HOUR]]);

  const result = buildUtilization(seconds, capacity, meta);

  assert.equal(result.utilizationPercent, 50, "20h of a 40h capacity");
  assert.equal(result.utilizationCounted, 1, "only the member with a capacity counts");
  assert.equal(result.utilizationMembers.noLimit, 1);
});

test("utilizationCounted is 0 when nobody has a limit, so the UI can say so instead of '0%'", () => {
  const seconds = new Map([["m-none", 10 * HOUR]]);
  const result = buildUtilization(seconds, new Map(), meta);

  assert.equal(result.utilizationCounted, 0);
  assert.equal(result.utilizationPercent, 0);
  // The distinction the widget needs: 0% "utilized" and "no limits are set"
  // are different states and must not render identically.
  assert.equal(result.utilizationMembers.noLimit, 1);
});

test("the three real buckets still classify at the 60% and 100% thresholds", () => {
  const seconds = new Map([
    ["m-under", 10 * HOUR], // 25%
    ["m-ontrack", 30 * HOUR], // 75%
    ["m-over", 50 * HOUR], // 125%
  ]);
  const capacity = new Map([
    ["m-under", 40 * HOUR],
    ["m-ontrack", 40 * HOUR],
    ["m-over", 40 * HOUR],
  ]);

  const result = buildUtilization(seconds, capacity, meta);

  assert.equal(result.utilizationMembers.under, 1);
  assert.equal(result.utilizationMembers.onTrack, 1);
  assert.equal(result.utilizationMembers.over, 1);
  assert.equal(result.utilizationMembers.noLimit, 0);
  assert.equal(result.utilizationCounted, 3);
});

test("`optimal` stays as an alias of onTrack so an older client does not render undefined", () => {
  const seconds = new Map([["m-ontrack", 30 * HOUR]]);
  const capacity = new Map([["m-ontrack", 40 * HOUR]]);

  const result = buildUtilization(seconds, capacity, meta);

  assert.equal(result.utilizationMembers.onTrack, 1);
  assert.equal(result.utilizationMembers.optimal, result.utilizationMembers.onTrack);
});

test("members with no limit sort last rather than as if they were at 0%", () => {
  const seconds = new Map([
    ["m-none", 80 * HOUR],
    ["m-under", 4 * HOUR], // 10%
  ]);
  const capacity = new Map([["m-under", 40 * HOUR]]);

  const result = buildUtilization(seconds, capacity, meta);

  assert.equal(result.utilizationBreakdown[0].id, "m-under", "ranked members come first");
  assert.equal(result.utilizationBreakdown[1].id, "m-none");
});
