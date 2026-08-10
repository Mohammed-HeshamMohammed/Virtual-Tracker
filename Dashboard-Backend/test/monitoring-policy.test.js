// Guards CF-1: the consent/config registry's core invariants -
// default-deny, admin-gated writes, a paired audit row on every write, and
// lawful-basis-required-to-enable. These are the properties Part 0 of the
// compliance plan depends on ("A capability with no row, or enabled = FALSE,
// is never captured", "Every change writes an immutable audit record").
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {Map<string, any>} */
let capabilityRows;
/** @type {any[]} */
let auditRows;
/** @type {Map<string, any>} */
let consentRows;

mock.module("../src/lib/postgres/monitoring-policy-postgres.service.js", {
  namedExports: {
    getAllMonitoringCapabilitiesPg: async () => [...capabilityRows.values()],
    getMonitoringCapabilityPg: async (capability) => capabilityRows.get(capability) ?? null,
    setMonitoringCapabilityPg: async (input) => {
      const row = {
        capability: input.capability,
        enabled: input.enabled,
        jurisdiction_profile: input.jurisdictionProfile ?? "strictest",
        lawful_basis: input.lawfulBasis ?? null,
        enabled_by: input.enabledBy ?? null,
        enabled_at: input.enabled ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      capabilityRows.set(input.capability, row);
      return row;
    },
    insertMonitoringPolicyAuditPg: async (input) => {
      auditRows.push({
        id: `audit-${auditRows.length + 1}`,
        capability: input.capability,
        previous_enabled: input.previousEnabled,
        new_enabled: input.newEnabled,
        lawful_basis: input.lawfulBasis ?? null,
        actor_member_id: input.actorMemberId ?? null,
        created_at: new Date().toISOString(),
      });
    },
    getMonitoringPolicyAuditPg: async (capability) =>
      auditRows.filter((r) => r.capability === capability).slice().reverse(),
    getMemberMonitoringConsentPg: async (memberId) => consentRows.get(memberId) ?? null,
    recordMemberDisclosurePg: async (memberId, noticeVersion) => {
      const existing = consentRows.get(memberId) ?? {};
      const row = { ...existing, member_id: memberId, disclosed_at: new Date().toISOString(), notice_version: noticeVersion };
      consentRows.set(memberId, row);
      return row;
    },
    recordMemberConsentPg: async (memberId, noticeVersion) => {
      const existing = consentRows.get(memberId) ?? {};
      const row = {
        ...existing,
        member_id: memberId,
        disclosed_at: existing.disclosed_at ?? new Date().toISOString(),
        consented_at: new Date().toISOString(),
        notice_version: noticeVersion,
      };
      consentRows.set(memberId, row);
      return row;
    },
  },
});

const {
  isCapabilityEnabled,
  getMonitoringPolicy,
  setMonitoringCapability,
  getMonitoringPolicyAudit,
  hasCurrentConsent,
  recordMemberDisclosure,
  recordMemberConsent,
  composeMonitoringNotice,
  isCapabilityOfferable,
  getOfferableCapabilities,
  KNOWN_CAPABILITIES,
} = await import("../src/modules/compliance/monitoring-policy.js");

const ADMIN = { memberId: "admin-1", roleName: "Admin" };
const EMPLOYEE = { memberId: "employee-1", roleName: "Employee" };

function reset() {
  capabilityRows = new Map();
  auditRows = [];
  consentRows = new Map();
}

test("a capability with no row at all is disabled (default-deny)", async () => {
  reset();
  assert.equal(await isCapabilityEnabled("screenshots"), false);
});

test("an unknown capability name is always disabled, never queried", async () => {
  reset();
  assert.equal(await isCapabilityEnabled("not_a_real_capability"), false);
});

test("getMonitoringPolicy reports every known capability even with zero rows in the DB", async () => {
  reset();
  const policy = await getMonitoringPolicy();
  assert.equal(policy.length, KNOWN_CAPABILITIES.length);
  assert.ok(policy.every((c) => c.enabled === false));
});

test("a non-management actor cannot enable a capability", async () => {
  reset();
  await assert.rejects(
    () => setMonitoringCapability({ capability: "screenshots", enabled: true, lawfulBasis: "consent" }, EMPLOYEE),
    /FORBIDDEN|management/i,
  );
  assert.equal(await isCapabilityEnabled("screenshots"), false, "must not have been enabled by the rejected call");
});

test("management can enable a capability given a lawful basis", async () => {
  reset();
  const result = await setMonitoringCapability(
    { capability: "screenshots", enabled: true, lawfulBasis: "consent", jurisdictionProfile: "eu_uk" },
    ADMIN,
  );
  assert.equal(result.enabled, true);
  assert.equal(await isCapabilityEnabled("screenshots"), true);
});

test("enabling without a lawful basis is rejected", async () => {
  reset();
  await assert.rejects(
    () => setMonitoringCapability({ capability: "screenshots", enabled: true }, ADMIN),
    /LAWFUL_BASIS_REQUIRED|lawful/i,
  );
});

test("disabling never requires a lawful basis", async () => {
  reset();
  await setMonitoringCapability({ capability: "screenshots", enabled: true, lawfulBasis: "consent" }, ADMIN);
  const result = await setMonitoringCapability({ capability: "screenshots", enabled: false }, ADMIN);
  assert.equal(result.enabled, false);
});

test("an unknown capability is rejected before touching storage", async () => {
  reset();
  await assert.rejects(
    () => setMonitoringCapability({ capability: "keystroke_content", enabled: true, lawfulBasis: "consent" }, ADMIN),
    /unknown capability/i,
  );
  assert.equal(capabilityRows.size, 0);
});

test("every write produces exactly one audit row recording actor and before/after state", async () => {
  reset();
  await setMonitoringCapability({ capability: "url_capture", enabled: true, lawfulBasis: "legitimate_interest" }, ADMIN);
  await setMonitoringCapability({ capability: "url_capture", enabled: false }, ADMIN);

  const audit = await getMonitoringPolicyAudit("url_capture");
  assert.equal(audit.length, 2);
  assert.equal(audit[0].newEnabled, false, "most recent first");
  assert.equal(audit[0].previousEnabled, true);
  assert.equal(audit[1].newEnabled, true);
  assert.equal(audit[1].previousEnabled, null, "first-ever change has no prior state");
  assert.ok(audit.every((a) => a.actorMemberId === ADMIN.memberId));
});

test("audit trail for one capability never includes another capability's rows", async () => {
  reset();
  await setMonitoringCapability({ capability: "screenshots", enabled: true, lawfulBasis: "consent" }, ADMIN);
  await setMonitoringCapability({ capability: "url_capture", enabled: true, lawfulBasis: "consent" }, ADMIN);
  const audit = await getMonitoringPolicyAudit("screenshots");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].capability, "screenshots");
});

test("consent is only current when it matches the notice version actually shown", async () => {
  reset();
  await recordMemberDisclosure("member-1", "v1");
  await recordMemberConsent("member-1", "v1");
  assert.equal(await hasCurrentConsent("member-1", "v1"), true);
  assert.equal(await hasCurrentConsent("member-1", "v2"), false, "a policy-text bump invalidates old consent");
});

test("disclosure alone (no acceptance) is never read as consent", async () => {
  reset();
  await recordMemberDisclosure("member-1", "v1");
  assert.equal(await hasCurrentConsent("member-1", "v1"), false);
});

test("a member with no consent record at all has no current consent", async () => {
  reset();
  assert.equal(await hasCurrentConsent("never-seen-member", "v1"), false);
});

// --- composeMonitoringNotice (CF-2) ---------------------------------------

test("the notice lists only enabled capabilities, never disabled ones", async () => {
  reset();
  await setMonitoringCapability({ capability: "screenshots", enabled: true, lawfulBasis: "consent" }, ADMIN);
  await setMonitoringCapability({ capability: "dns_logging", enabled: false }, ADMIN);
  const notice = await composeMonitoringNotice();
  assert.deepEqual(notice.enabledCapabilities, ["screenshots"]);
  assert.match(notice.text, /screen/i);
  assert.doesNotMatch(notice.text, /domains/i, "a disabled capability must not appear in what employees are told is collected");
});

test("with nothing enabled, the notice says so plainly rather than an empty list", async () => {
  reset();
  const notice = await composeMonitoringNotice();
  assert.deepEqual(notice.enabledCapabilities, []);
  assert.match(notice.text, /no monitoring capabilities/i);
});

test("enabling a capability changes the notice version (forces re-disclosure)", async () => {
  reset();
  const before = await composeMonitoringNotice();
  await setMonitoringCapability({ capability: "app_tracking", enabled: true, lawfulBasis: "legitimate_interest" }, ADMIN);
  const after = await composeMonitoringNotice();
  assert.notEqual(before.version, after.version);
});

test("the notice version is stable when nothing that appears in the text has changed", async () => {
  reset();
  await setMonitoringCapability({ capability: "screenshots", enabled: true, lawfulBasis: "consent" }, ADMIN);
  const first = await composeMonitoringNotice();
  const second = await composeMonitoringNotice();
  assert.equal(first.version, second.version);
});

test("consent recorded against an old notice version does not satisfy a changed notice", async () => {
  reset();
  const before = await composeMonitoringNotice();
  await recordMemberDisclosure("member-1", before.version);
  await recordMemberConsent("member-1", before.version);
  assert.equal(await hasCurrentConsent("member-1", before.version), true);

  await setMonitoringCapability({ capability: "integrity_signals", enabled: true, lawfulBasis: "legitimate_interest" }, ADMIN);
  const after = await composeMonitoringNotice();
  assert.equal(await hasCurrentConsent("member-1", after.version), false, "must re-disclose after the policy changed what's collected");
});

// --- Jurisdiction profiles (CF-4) -----------------------------------------

test("dns_logging is not offerable under the EU/UK profile", () => {
  assert.equal(isCapabilityOfferable("dns_logging", "eu_uk"), false);
});

test("dns_logging is not offerable under the strictest fallback profile", () => {
  assert.equal(isCapabilityOfferable("dns_logging", "strictest"), false);
  assert.equal(isCapabilityOfferable("dns_logging", undefined), false, "no profile at all defaults to strictest");
  assert.equal(isCapabilityOfferable("dns_logging", "not_a_real_profile"), false, "an unrecognised profile also defaults to strictest");
});

test("dns_logging is offerable under US profiles", () => {
  assert.equal(isCapabilityOfferable("dns_logging", "us_one_party_consent"), true);
  assert.equal(isCapabilityOfferable("dns_logging", "us_two_party_consent"), true);
});

test("screenshots are offerable everywhere - jurisdiction restricts specific invasive capabilities, not the whole registry", () => {
  for (const profile of ["eu_uk", "us_one_party_consent", "us_two_party_consent", "strictest"]) {
    assert.equal(isCapabilityOfferable("screenshots", profile), true, `screenshots should be offerable under ${profile}`);
  }
});

test("getOfferableCapabilities excludes exactly the restricted set for a profile", () => {
  const euOfferable = getOfferableCapabilities("eu_uk");
  assert.ok(!euOfferable.includes("dns_logging"));
  assert.equal(euOfferable.length, KNOWN_CAPABILITIES.length - 1);

  const usOfferable = getOfferableCapabilities("us_one_party_consent");
  assert.equal(usOfferable.length, KNOWN_CAPABILITIES.length);
});

test("management cannot enable a capability the jurisdiction profile does not offer, even with a lawful basis", async () => {
  reset();
  await assert.rejects(
    () =>
      setMonitoringCapability(
        { capability: "dns_logging", enabled: true, lawfulBasis: "consent", jurisdictionProfile: "eu_uk" },
        ADMIN,
      ),
    /CAPABILITY_NOT_OFFERABLE_IN_JURISDICTION|not offerable/i,
  );
  assert.equal(await isCapabilityEnabled("dns_logging"), false);
});

test("the offerability check uses the profile already on the row when none is passed in this call", async () => {
  reset();
  // First set the profile to eu_uk without enabling (allowed - disabling/setting profile never needs a lawful basis).
  await setMonitoringCapability({ capability: "dns_logging", enabled: false, jurisdictionProfile: "eu_uk" }, ADMIN);
  // Now try to enable it with no jurisdictionProfile in this call - must fall back to the stored eu_uk and still refuse.
  await assert.rejects(
    () => setMonitoringCapability({ capability: "dns_logging", enabled: true, lawfulBasis: "consent" }, ADMIN),
    /CAPABILITY_NOT_OFFERABLE_IN_JURISDICTION|not offerable/i,
  );
});

test("switching the profile to one that offers the capability then allows enabling it", async () => {
  reset();
  await setMonitoringCapability(
    { capability: "dns_logging", enabled: true, lawfulBasis: "consent", jurisdictionProfile: "us_one_party_consent" },
    ADMIN,
  );
  assert.equal(await isCapabilityEnabled("dns_logging"), true);
});
