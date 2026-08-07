// Guards CLS-2: activity minutes bucketed into productive/neutral/
// distracting/unclassified using CLS-1's classification map, with role
// override resolved for the *tracked* member (not the viewer).
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let appRows;
let domainRows;
let categoryRows;
let memberRole;

mock.module("../src/config/firebase.js", {
  namedExports: { getDb: () => ({}) },
});
mock.module("../src/modules/activity/activity-scope.js", {
  namedExports: { resolveMemberRoleName: async () => memberRole },
});
mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  namedExports: {
    sumAppLogSecondsByAppNamePg: async () => appRows,
    sumUrlLogSecondsByDomainPg: async () => domainRows,
    // Unused by focused-time.js itself, but activity-categories.js (imported
    // transitively) needs the full export surface satisfied against this
    // same mocked module.
    findUnclassifiedAppsPg: async () => [],
    findUnclassifiedDomainsPg: async () => [],
  },
});
mock.module("../src/lib/postgres/classification-postgres.service.js", {
  namedExports: {
    getAllCategoriesPg: async () => categoryRows,
    getCategoryPg: async () => null,
    upsertCategoryPg: async () => null,
    deleteCategoryPg: async () => {},
  },
});

const { getFocusedTimeSummary } = await import("../src/modules/classification/focused-time.js");

function categoryRow(matchType, pattern, category, roleOverride = {}) {
  return {
    id: `${matchType}-${pattern}`,
    match_type: matchType,
    pattern,
    category,
    display_name: null,
    role_override: roleOverride,
    is_global_default: true,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function reset() {
  memberRole = "Employee";
  categoryRows = [
    categoryRow("app", "code.exe", "productive"),
    categoryRow("domain", "youtube.com", "distracting"),
    categoryRow("domain", "slack.com", "neutral"),
  ];
  appRows = [];
  domainRows = [];
}

test("buckets known app and domain seconds into the right categories", async () => {
  reset();
  appRows = [{ app_name: "code.exe", total_seconds: "3600" }];
  domainRows = [
    { domain: "youtube.com", total_seconds: "600" },
    { domain: "slack.com", total_seconds: "300" },
  ];
  const summary = await getFocusedTimeSummary("member-1", { fromDay: "2026-01-01", toDay: "2026-01-01" });
  assert.equal(summary.productiveSeconds, 3600);
  assert.equal(summary.distractingSeconds, 600);
  assert.equal(summary.neutralSeconds, 300);
  assert.equal(summary.unclassifiedSeconds, 0);
  assert.equal(summary.totalSeconds, 4500);
});

test("an app/domain with no classification row buckets as unclassified, not dropped", async () => {
  reset();
  appRows = [{ app_name: "some-new-tool.exe", total_seconds: "120" }];
  const summary = await getFocusedTimeSummary("member-1", { fromDay: "2026-01-01", toDay: "2026-01-01" });
  assert.equal(summary.unclassifiedSeconds, 120);
  assert.equal(summary.totalSeconds, 120);
});

test("app/domain lookup is case-insensitive", async () => {
  reset();
  appRows = [{ app_name: "CODE.EXE", total_seconds: "60" }];
  const summary = await getFocusedTimeSummary("member-1", { fromDay: "2026-01-01", toDay: "2026-01-01" });
  assert.equal(summary.productiveSeconds, 60);
});

test("a role override reclassifies for the tracked member's own role", async () => {
  reset();
  categoryRows = [categoryRow("domain", "youtube.com", "distracting", { "video editor": "productive" })];
  memberRole = "Video Editor";
  domainRows = [{ domain: "youtube.com", total_seconds: "600" }];
  const summary = await getFocusedTimeSummary("member-1", { fromDay: "2026-01-01", toDay: "2026-01-01" });
  assert.equal(summary.productiveSeconds, 600);
  assert.equal(summary.distractingSeconds, 0);
});

test("no role override for this member's role falls back to the base category", async () => {
  reset();
  categoryRows = [categoryRow("domain", "youtube.com", "distracting", { "video editor": "productive" })];
  memberRole = "Employee";
  domainRows = [{ domain: "youtube.com", total_seconds: "600" }];
  const summary = await getFocusedTimeSummary("member-1", { fromDay: "2026-01-01", toDay: "2026-01-01" });
  assert.equal(summary.distractingSeconds, 600);
});

test("the breakdown is sorted by seconds descending", async () => {
  reset();
  appRows = [{ app_name: "code.exe", total_seconds: "60" }];
  domainRows = [{ domain: "youtube.com", total_seconds: "600" }];
  const summary = await getFocusedTimeSummary("member-1", { fromDay: "2026-01-01", toDay: "2026-01-01" });
  assert.equal(summary.breakdown[0].pattern, "youtube.com");
  assert.equal(summary.breakdown[1].pattern, "code.exe");
});

test("zero activity in the range returns all-zero totals, not an error", async () => {
  reset();
  const summary = await getFocusedTimeSummary("member-1", { fromDay: "2026-01-01", toDay: "2026-01-01" });
  assert.equal(summary.totalSeconds, 0);
  assert.deepEqual(summary.breakdown, []);
});
