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
  namedExports: {
    // Mirrors the real query: org-wide rows plus the asking member's own.
    getCaptureExclusionsPg: async (memberId = null) =>
      exclusionRows.filter((r) => !r.member_id || r.member_id === memberId),
    getOwnCaptureExclusionsPg: async (memberId) => exclusionRows.filter((r) => r.member_id === memberId),
    countOwnCaptureExclusionsPg: async (memberId) => exclusionRows.filter((r) => r.member_id === memberId).length,
    addCaptureExclusionPg: async (input) => {
      const scope = input.memberId ?? "org";
      const key = `${scope}:${input.matchType}:${input.pattern.toLowerCase()}`;
      if (exclusionRows.some((r) => `${r.member_id ?? "org"}:${r.match_type}:${r.pattern.toLowerCase()}` === key)) return null;
      const row = {
        id: `excl-${exclusionRows.length + 1}`,
        match_type: input.matchType,
        pattern: input.pattern,
        note: input.note ?? null,
        created_by: input.createdBy ?? null,
        member_id: input.memberId ?? null,
        created_at: new Date().toISOString(),
      };
      exclusionRows.push(row);
      return row;
    },
    // Scoped like the real DELETE: a null member removes org rows only.
    removeCaptureExclusionPg: async (id, memberId = null) => {
      const before = exclusionRows.length;
      exclusionRows = exclusionRows.filter((r) => !(r.id === id && (r.member_id ?? null) === memberId));
      return exclusionRows.length < before;
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
  listOwnCaptureExclusions,
  addOwnCaptureExclusion,
  removeOwnCaptureExclusion,
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

test("an app exclusion matches regardless of whether either side carries the .exe suffix", async () => {
  // An admin may type the pattern as the display name or the raw
  // executable, and the agent event this is checked against may carry
  // either spelling too (an up-to-date agent already checks all its own
  // candidate spellings client-side; this is the server-side backstop for
  // one that doesn't). Neither side's choice should matter.
  reset();
  await addCaptureExclusion({ matchType: "app", pattern: "notion.exe" }, ADMIN);
  assert.equal(await isCaptureExcluded("app", "Notion"), true, "pattern has .exe, checked name does not");
  assert.equal(await isCaptureExcluded("app", "notion.exe"), true, "both carry .exe");

  reset();
  await addCaptureExclusion({ matchType: "app", pattern: "Slack" }, ADMIN);
  assert.equal(await isCaptureExcluded("app", "slack.exe"), true, "pattern has no .exe, checked name does");
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

// ---- a member's own exclusions -------------------------------------------

test("an employee can exclude something from their own capture", async () => {
  reset();
  const row = await addOwnCaptureExclusion({ matchType: "domain", pattern: "mybank.com" }, "employee-1");
  assert.equal(row.memberId, "employee-1");
  assert.equal((await listOwnCaptureExclusions("employee-1")).length, 1);
});

test("someone else's exclusions are neither visible nor applied", async () => {
  reset();
  await addOwnCaptureExclusion({ matchType: "domain", pattern: "mybank.com" }, "employee-1");
  assert.equal((await listOwnCaptureExclusions("employee-2")).length, 0);
  assert.equal(matchesExclusion(await getCaptureExclusions("employee-2"), "domain", "mybank.com"), false);
  assert.equal(matchesExclusion(await getCaptureExclusions("employee-1"), "domain", "mybank.com"), true);
});

test("the org-wide list never includes a member's personal rules", async () => {
  reset();
  await addOwnCaptureExclusion({ matchType: "app", pattern: "keepass" }, "employee-1");
  await addCaptureExclusion({ matchType: "app", pattern: "1password" }, ADMIN);
  const org = await getCaptureExclusions();
  assert.deepEqual(org.map((r) => r.pattern), ["1password"]);
});

test("a member can remove their own rule but not someone else's", async () => {
  reset();
  const mine = await addOwnCaptureExclusion({ matchType: "app", pattern: "keepass" }, "employee-1");
  assert.equal(await removeOwnCaptureExclusion(mine.id, "employee-2"), false, "another member cannot delete it");
  assert.equal(await removeOwnCaptureExclusion(mine.id, "employee-1"), true);
});

test("the org route cannot delete a member's personal exclusion", async () => {
  // Personal rules are the member's to keep. The management delete is scoped
  // to org rows, so an admin who knows the id still cannot remove one.
  reset();
  const mine = await addOwnCaptureExclusion({ matchType: "app", pattern: "keepass" }, "employee-1");
  await removeCaptureExclusion(mine.id, ADMIN);
  assert.equal((await listOwnCaptureExclusions("employee-1")).length, 1);
});

test("a member cannot delete an org-wide rule through their own route", async () => {
  reset();
  const org = await addCaptureExclusion({ matchType: "app", pattern: "1password" }, ADMIN);
  assert.equal(await removeOwnCaptureExclusion(org.id, "employee-1"), false);
  assert.equal((await getCaptureExclusions()).length, 1);
});

test("a full address is reduced to the host, so what people type actually matches", async () => {
  reset();
  await addOwnCaptureExclusion({ matchType: "domain", pattern: "https://www.MyBank.com/login?x=1" }, "employee-1");
  const [row] = await listOwnCaptureExclusions("employee-1");
  assert.equal(row.pattern, "mybank.com");
  assert.equal(matchesExclusion(await getCaptureExclusions("employee-1"), "domain", "mybank.com"), true);
});

test("excluding a domain also excludes its subdomains, but not lookalikes", async () => {
  reset();
  await addOwnCaptureExclusion({ matchType: "domain", pattern: "bank.com" }, "employee-1");
  const rules = await getCaptureExclusions("employee-1");
  assert.equal(matchesExclusion(rules, "domain", "online.bank.com"), true);
  assert.equal(matchesExclusion(rules, "domain", "a.b.bank.com"), true);
  assert.equal(matchesExclusion(rules, "domain", "notbank.com"), false, "suffix without a dot boundary");
  assert.equal(matchesExclusion(rules, "domain", "bank.com.evil.io"), false);
});

test("subdomain matching does not apply to app names", async () => {
  reset();
  await addOwnCaptureExclusion({ matchType: "app", pattern: "chat" }, "employee-1");
  assert.equal(matchesExclusion(await getCaptureExclusions("employee-1"), "app", "team.chat"), false);
});

test("an unknown match type, an empty pattern and an over-long one are refused", async () => {
  reset();
  await assert.rejects(() => addOwnCaptureExclusion({ matchType: "regex", pattern: "x" }, "employee-1"), /matchType/);
  await assert.rejects(() => addOwnCaptureExclusion({ matchType: "app", pattern: "   " }, "employee-1"), /pattern is required/);
  await assert.rejects(() => addOwnCaptureExclusion({ matchType: "app", pattern: "a".repeat(300) }, "employee-1"), /too long/);
});

test("a member is capped so the list cannot grow without bound", async () => {
  reset();
  for (let i = 0; i < 100; i++) await addOwnCaptureExclusion({ matchType: "app", pattern: `app${i}` }, "employee-1");
  await assert.rejects(() => addOwnCaptureExclusion({ matchType: "app", pattern: "one-more" }, "employee-1"), /up to 100/);
});

test("without a signed-in member nothing can be added or removed", async () => {
  reset();
  await assert.rejects(() => addOwnCaptureExclusion({ matchType: "app", pattern: "x" }, ""), /Sign in/);
  await assert.rejects(() => removeOwnCaptureExclusion("excl-1", ""), /Sign in/);
  assert.deepEqual(await listOwnCaptureExclusions(""), []);
});
