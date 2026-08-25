// Guards CLS-1: the app/domain classification map - global defaults,
// admin-gated overrides (single authoritative row per pattern, no layered
// org lookup since none exists), role-based reclassification, and the
// unified display-name lookup that's meant to replace window.rs's/
// display-names.ts's independently-drifting hardcoded maps (CQ-4/MAC-3).
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {Map<string, any>} */
let rows;

function key(matchType, pattern) {
  return `${matchType}:${pattern.toLowerCase()}`;
}

/** @type {any[]} */
let unclassifiedApps;
/** @type {any[]} */
let unclassifiedDomains;

mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  namedExports: {
    findUnclassifiedAppsPg: async () => unclassifiedApps,
    findUnclassifiedDomainsPg: async () => unclassifiedDomains,
  },
});

mock.module("../src/lib/postgres/classification-postgres.service.js", {
  namedExports: {
    getAllCategoriesPg: async () => [...rows.values()],
    getCategoryPg: async (matchType, pattern) => rows.get(key(matchType, pattern)) ?? null,
    upsertCategoryPg: async (input) => {
      const k = key(input.matchType, input.pattern);
      const existing = rows.get(k);
      const row = {
        id: existing?.id ?? `row-${rows.size + 1}`,
        match_type: input.matchType,
        pattern: input.pattern,
        category: input.category ?? existing?.category ?? "unclassified",
        display_name: input.displayName ?? existing?.display_name ?? null,
        role_override: input.roleOverride ?? existing?.role_override ?? {},
        is_global_default: false,
        created_by: input.createdBy ?? null,
        created_at: existing?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rows.set(k, row);
      return row;
    },
    deleteCategoryPg: async (id) => {
      for (const [k, row] of rows.entries()) {
        if (row.id === id) rows.delete(k);
      }
    },
  },
});

const {
  getAllCategories,
  setCategory,
  removeCategory,
  categorize,
  getAppDisplayName,
  getUnclassifiedReviewQueue,
  CATEGORIES,
} = await import("../src/modules/classification/activity-categories.js");

const ADMIN = { memberId: "admin-1", roleName: "Admin" };
const EMPLOYEE = { memberId: "employee-1", roleName: "Employee" };
const MANAGER = { memberId: "manager-1", roleName: "Manager" };

function reset() {
  unclassifiedApps = [];
  unclassifiedDomains = [];
  rows = new Map([
    [
      key("domain", "youtube.com"),
      {
        id: "seed-1",
        match_type: "domain",
        pattern: "youtube.com",
        category: "distracting",
        display_name: null,
        role_override: {},
        is_global_default: true,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    [
      key("app", "code.exe"),
      {
        id: "seed-2",
        match_type: "app",
        pattern: "code.exe",
        category: "productive",
        display_name: "VS Code",
        role_override: {},
        is_global_default: true,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  ]);
}

test("an unclassified app/domain with no row at all categorizes as unclassified, not a guess", async () => {
  reset();
  assert.equal(await categorize("app", "some-new-tool.exe"), "unclassified");
  assert.equal(await categorize("domain", "some-new-site.com"), "unclassified");
});

test("categorize reads the seeded default", async () => {
  reset();
  assert.equal(await categorize("domain", "youtube.com"), "distracting");
  assert.equal(await categorize("domain", "YouTube.com"), "distracting", "case-insensitive match");
});

test("a non-management actor cannot change classification", async () => {
  reset();
  await assert.rejects(
    () => setCategory({ matchType: "domain", pattern: "youtube.com", category: "productive" }, EMPLOYEE),
    /Owner, Super Admin, or Admin/i,
  );
  assert.equal(await categorize("domain", "youtube.com"), "distracting", "must survive the rejected write");
});

// Narrower than isManagementRole on purpose: a Manager is management for
// approvals and scheduling, but classification is an org-wide policy call
// that moves everyone's reported focused time.
test("a Manager is management elsewhere but still cannot classify", async () => {
  reset();
  await assert.rejects(
    () => setCategory({ matchType: "domain", pattern: "youtube.com", category: "productive" }, MANAGER),
    /Owner, Super Admin, or Admin/i,
  );
  const target = (await getAllCategories()).find((c) => c.pattern === "code.exe");
  await assert.rejects(() => removeCategory(target.id, MANAGER), /Owner, Super Admin, or Admin/i);
  assert.equal(await categorize("app", "code.exe"), "productive", "the rejected delete changed nothing");
});

test("management can override a seeded default in place - one authoritative row, not a shadow", async () => {
  reset();
  const before = (await getAllCategories()).find((c) => c.pattern === "youtube.com");
  assert.equal(before.isGlobalDefault, true);

  const updated = await setCategory({ matchType: "domain", pattern: "youtube.com", category: "productive" }, ADMIN);
  assert.equal(updated.category, "productive");
  assert.equal(updated.isGlobalDefault, false, "an admin edit marks the row as customized, not still-default");

  const all = await getAllCategories();
  assert.equal(all.filter((c) => c.pattern === "youtube.com").length, 1, "still exactly one row, not a new override row");
});

test("an unknown category value is rejected", async () => {
  reset();
  await assert.rejects(
    () => setCategory({ matchType: "app", pattern: "code.exe", category: "wildly-productive" }, ADMIN),
    /UNKNOWN_CATEGORY|unknown category/i,
  );
});

test("an invalid matchType is rejected before touching storage", async () => {
  reset();
  await assert.rejects(
    () => setCategory({ matchType: "url", pattern: "example.com", category: "neutral" }, ADMIN),
    /INVALID_MATCH_TYPE|matchType/i,
  );
});

test("removeCategory deletes the row and it reverts to unclassified", async () => {
  reset();
  const target = (await getAllCategories()).find((c) => c.pattern === "code.exe");
  await removeCategory(target.id, ADMIN);
  assert.equal(await categorize("app", "code.exe"), "unclassified");
});

test("a role override reclassifies for a matching role, and falls back to the base category otherwise", async () => {
  reset();
  await setCategory(
    { matchType: "domain", pattern: "youtube.com", roleOverride: { "video editor": "productive" } },
    ADMIN,
  );
  assert.equal(await categorize("domain", "youtube.com", "Video Editor"), "productive", "role match, case-insensitive");
  assert.equal(await categorize("domain", "youtube.com", "Employee"), "distracting", "no override for this role, falls back to base category");
  assert.equal(await categorize("domain", "youtube.com"), "distracting", "no role passed at all");
});

test("an invalid value inside role_override is never trusted blindly", async () => {
  reset();
  // Simulate a corrupted/hand-edited row with a bogus override value.
  rows.get(key("domain", "youtube.com")).role_override = { hacker: "not-a-real-category" };
  assert.equal(await categorize("domain", "youtube.com", "hacker"), "distracting", "invalid override value is ignored, falls back to base category");
});

test("getAppDisplayName returns the mapped name, and null (not a guess) when unmapped", async () => {
  reset();
  assert.equal(await getAppDisplayName("code.exe"), "VS Code");
  assert.equal(await getAppDisplayName("some-random-tool.exe"), null);
});

test("every seeded default uses a valid category value", async () => {
  reset();
  const all = await getAllCategories();
  assert.ok(all.every((c) => CATEGORIES.includes(c.category)));
});

test("the review queue passes through app and domain results ranked by the DB query", async () => {
  reset();
  unclassifiedApps = [{ app_name: "newtool.exe", total_seconds: "500", log_count: 12 }];
  unclassifiedDomains = [{ domain: "newsite.com", total_seconds: "300", log_count: 8 }];
  const queue = await getUnclassifiedReviewQueue();
  assert.equal(queue.apps.length, 1);
  assert.equal(queue.apps[0].pattern, "newtool.exe");
  assert.equal(queue.apps[0].totalSeconds, 500);
  assert.equal(queue.domains[0].pattern, "newsite.com");
});

test("an empty review queue returns empty arrays, not an error", async () => {
  reset();
  const queue = await getUnclassifiedReviewQueue();
  assert.deepEqual(queue.apps, []);
  assert.deepEqual(queue.domains, []);
});
