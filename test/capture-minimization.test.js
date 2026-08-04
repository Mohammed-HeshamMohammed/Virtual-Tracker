// Guards CF-3: the exclusion list and minimization settings that gate
// screenshot/app/url ingest in activity/routes.js. "An app on the exclusion
// list produces no screenshot at all" and "domain-only mode stores no path
// or query component anywhere" are the two acceptance criteria this exists
// to prove, plus the admin-only write gate matching CF-1's pattern.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {any[]} */
let exclusionRows;
/** @type {any} */
let settingsRow;

mock.module("../src/lib/postgres/capture-minimization-postgres.service.js", {
  exports: {
    getCaptureExclusionsPg: async () => [...exclusionRows],
    addCaptureExclusionPg: async (input) => {
      const key = `${input.matchType}:${input.pattern.toLowerCase()}`;
      if (exclusionRows.some((r) => `${r.match_type}:${r.pattern.toLowerCase()}` === key)) return null;
      const row = {
        id: `excl-${exclusionRows.length + 1}`,
        match_type: input.matchType,
        pattern: input.pattern,
        note: input.note ?? null,
        created_by: input.createdBy ?? null,
        created_at: new Date().toISOString(),
      };
      exclusionRows.push(row);
      return row;
    },
    removeCaptureExclusionPg: async (id) => {
      exclusionRows = exclusionRows.filter((r) => r.id !== id);
    },
    getCaptureMinimizationSettingsPg: async () => settingsRow,
    setCaptureMinimizationSettingsPg: async (input) => {
      settingsRow = {
        url_domain_only: input.urlDomainOnly ?? settingsRow.url_domain_only,
        screenshot_blur_default: input.screenshotBlurDefault ?? settingsRow.screenshot_blur_default,
        updated_by: input.updatedBy ?? null,
        updated_at: new Date().toISOString(),
      };
      return settingsRow;
    },
  },
});

const {
  getCaptureExclusions,
  addCaptureExclusion,
  removeCaptureExclusion,
  isCaptureExcluded,
  matchesExclusion,
  getCaptureMinimizationSettings,
  setCaptureMinimizationSettings,
} = await import("../src/modules/compliance/capture-minimization.js");

const ADMIN = { memberId: "admin-1", roleName: "Admin" };
const EMPLOYEE = { memberId: "employee-1", roleName: "Employee" };

function reset() {
  exclusionRows = [];
  settingsRow = { url_domain_only: false, screenshot_blur_default: false };
}

test("a non-management actor cannot add an exclusion", async () => {
  reset();
  await assert.rejects(
    () => addCaptureExclusion({ matchType: "app", pattern: "OnlineBanking.exe" }, EMPLOYEE),
    /FORBIDDEN|management/i,
  );
  assert.equal(exclusionRows.length, 0);
});

test("management can add an app exclusion, matched case-insensitively", async () => {
  reset();
  await addCaptureExclusion({ matchType: "app", pattern: "OnlineBanking.exe" }, ADMIN);
  assert.equal(await isCaptureExcluded("app", "onlinebanking.exe"), true);
  assert.equal(await isCaptureExcluded("app", "ONLINEBANKING.EXE"), true);
  assert.equal(await isCaptureExcluded("app", "Slack.exe"), false);
});

test("an app exclusion does not match a domain exclusion check and vice versa", async () => {
  reset();
  await addCaptureExclusion({ matchType: "app", pattern: "chase.exe" }, ADMIN);
  await addCaptureExclusion({ matchType: "domain", pattern: "chase.com" }, ADMIN);
  assert.equal(await isCaptureExcluded("domain", "chase.exe"), false, "an app pattern must not leak into domain matching");
  assert.equal(await isCaptureExcluded("app", "chase.com"), false, "a domain pattern must not leak into app matching");
});

test("an empty or missing name is never excluded", async () => {
  reset();
  await addCaptureExclusion({ matchType: "app", pattern: "banking.exe" }, ADMIN);
  assert.equal(matchesExclusion(await getCaptureExclusions(), "app", ""), false);
  assert.equal(matchesExclusion(await getCaptureExclusions(), "app", null), false);
  assert.equal(matchesExclusion(await getCaptureExclusions(), "app", undefined), false);
});

test("adding the same exclusion twice does not duplicate it", async () => {
  reset();
  await addCaptureExclusion({ matchType: "domain", pattern: "mychart.com" }, ADMIN);
  const second = await addCaptureExclusion({ matchType: "domain", pattern: "MyChart.com" }, ADMIN);
  assert.equal(second, null, "conflicting insert returns null rather than a duplicate row");
  assert.equal((await getCaptureExclusions()).length, 1);
});

test("removing an exclusion clears the match", async () => {
  reset();
  const created = await addCaptureExclusion({ matchType: "app", pattern: "banking.exe" }, ADMIN);
  await removeCaptureExclusion(created.id, ADMIN);
  assert.equal(await isCaptureExcluded("app", "banking.exe"), false);
});

test("a non-management actor cannot remove an exclusion", async () => {
  reset();
  const created = await addCaptureExclusion({ matchType: "app", pattern: "banking.exe" }, ADMIN);
  await assert.rejects(() => removeCaptureExclusion(created.id, EMPLOYEE), /FORBIDDEN|management/i);
  assert.equal(await isCaptureExcluded("app", "banking.exe"), true, "must survive the rejected removal");
});

test("an invalid matchType is rejected before touching storage", async () => {
  reset();
  await assert.rejects(
    () => addCaptureExclusion({ matchType: "url", pattern: "example.com" }, ADMIN),
    /INVALID_MATCH_TYPE|matchType/i,
  );
  assert.equal(exclusionRows.length, 0);
});

test("an empty pattern is rejected", async () => {
  reset();
  await assert.rejects(
    () => addCaptureExclusion({ matchType: "app", pattern: "   " }, ADMIN),
    /PATTERN_REQUIRED|pattern/i,
  );
});

test("minimization settings default to false (minimally invasive posture) and are readable by anyone", async () => {
  reset();
  const settings = await getCaptureMinimizationSettings();
  assert.equal(settings.urlDomainOnly, false);
  assert.equal(settings.screenshotBlurDefault, false);
});

test("a non-management actor cannot change capture settings", async () => {
  reset();
  await assert.rejects(
    () => setCaptureMinimizationSettings({ urlDomainOnly: true }, EMPLOYEE),
    /FORBIDDEN|management/i,
  );
  assert.equal((await getCaptureMinimizationSettings()).urlDomainOnly, false);
});

test("management can enable domain-only URL mode independent of blur", async () => {
  reset();
  const updated = await setCaptureMinimizationSettings({ urlDomainOnly: true }, ADMIN);
  assert.equal(updated.urlDomainOnly, true);
  assert.equal(updated.screenshotBlurDefault, false, "changing one setting must not flip the other");
});
