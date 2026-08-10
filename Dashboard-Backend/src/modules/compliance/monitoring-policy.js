import crypto from "node:crypto";
import { isManagementRole } from "../../http/auth-context.js";
import {
  getAllMonitoringCapabilitiesPg,
  getMonitoringCapabilityPg,
  getMonitoringPolicyAuditPg,
  insertMonitoringPolicyAuditPg,
  setMonitoringCapabilityPg,
  getMemberMonitoringConsentPg,
  recordMemberDisclosurePg,
  recordMemberConsentPg,
} from "../../lib/postgres/monitoring-policy-postgres.service.js";

// Must match the CHECK constraint on monitoring_capabilities.capability in
// ensure-lookup-schema.js - kept here too so callers can validate before
// hitting the DB and get a clean 400 instead of a raw constraint violation.
export const KNOWN_CAPABILITIES = Object.freeze([
  "screenshots",
  "app_tracking",
  "url_capture",
  "activity_metering",
  "dns_logging",
  "integrity_signals",
]);

export const JURISDICTION_PROFILES = Object.freeze([
  "eu_uk",
  "us_one_party_consent",
  "us_two_party_consent",
  "strictest",
]);

/**
 * CF-4: "make 'may we' a separate switch from 'can we'." A capability listed
 * here for a profile is not merely off under that profile - it is not
 * offerable at all; setMonitoringCapability refuses to enable it regardless
 * of who asks or what lawful basis they cite.
 *
 * Deliberately conservative and small: only capabilities that exist in
 * KNOWN_CAPABILITIES are restricted here, and only where the compliance plan
 * (TAURI-AGENT-IMPROVEMENTS.md Part 0.4) names a concrete reason. Several of
 * the plan's jurisdiction constraints (audio requiring all-party consent,
 * BIPA restricting biometric capture) don't correspond to anything this
 * product currently captures, so they're not encoded as restrictions on
 * capabilities that don't exist - that would be decorative, not protective.
 *
 * dns_logging is the one clear case: it's the network-destination-logging
 * capability (Part D "Rung 2"), the family of capability the plan's EU/UK
 * row treats most cautiously ("Network interception... effectively
 * unavailable"). Restricted under both eu_uk and the strictest fallback.
 *
 * Expand this matrix as capabilities are added (e.g. if a future audio or
 * full network-interception capability ships) and have counsel confirm it
 * per target jurisdiction before relying on it - see Part 0's own
 * disclaimer.
 */
export const JURISDICTION_CAPABILITY_RESTRICTIONS = Object.freeze({
  eu_uk: Object.freeze(["dns_logging"]),
  us_one_party_consent: Object.freeze([]),
  us_two_party_consent: Object.freeze([]),
  // CF-0.4: "Default to the strictest applicable posture until counsel
  // confirms otherwise" - the fallback profile for anything unspecified.
  strictest: Object.freeze(["dns_logging"]),
});

/**
 * @param {string} capability @param {string|null|undefined} jurisdictionProfile
 */
export function isCapabilityOfferable(capability, jurisdictionProfile) {
  const profile = jurisdictionProfile && JURISDICTION_PROFILES.includes(jurisdictionProfile)
    ? jurisdictionProfile
    : "strictest";
  const restricted = JURISDICTION_CAPABILITY_RESTRICTIONS[profile] ?? [];
  return !restricted.includes(capability);
}

/**
 * CF-0.4: "A capability unavailable in a profile ... does not render as a
 * toggle" - this is what a settings UI would call to decide which toggles to
 * show at all for a chosen profile, not merely which ones start unchecked.
 * @param {string} jurisdictionProfile
 */
export function getOfferableCapabilities(jurisdictionProfile) {
  return KNOWN_CAPABILITIES.filter((c) => isCapabilityOfferable(c, jurisdictionProfile));
}

function normalizeCapabilityRow(row) {
  return {
    capability: row.capability,
    enabled: row.enabled === true,
    jurisdictionProfile: row.jurisdiction_profile,
    lawfulBasis: row.lawful_basis ?? null,
    enabledBy: row.enabled_by ?? null,
    enabledAt: row.enabled_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * CF-0.1 default-deny: a capability with no row, or enabled = false, is
 * never captured. Every capture path that needs to gate on this calls
 * through here - never reads the table directly - so "is this on" has one
 * implementation, not one per call site.
 * @param {string} capability
 */
export async function isCapabilityEnabled(capability) {
  if (!KNOWN_CAPABILITIES.includes(capability)) return false;
  const row = await getMonitoringCapabilityPg(capability);
  return row?.enabled === true;
}

/** All known capabilities, including ones with no explicit row yet (reported as disabled, unset profile/basis) - the registry is default-deny even for a capability that has never been touched. */
export async function getMonitoringPolicy() {
  const rows = await getAllMonitoringCapabilitiesPg();
  const byCapability = new Map(rows.map((r) => [r.capability, r]));
  return KNOWN_CAPABILITIES.map((capability) => {
    const row = byCapability.get(capability);
    return row
      ? normalizeCapabilityRow(row)
      : {
          capability,
          enabled: false,
          jurisdictionProfile: null,
          lawfulBasis: null,
          enabledBy: null,
          enabledAt: null,
          updatedAt: null,
        };
  });
}

/**
 * The only write path for monitoring_capabilities. Admin-role-gated
 * (CF-0.1's "enabled_by (admin user id) - audit" requirement) and always
 * writes a paired monitoring_policy_audit row in the same call, so the two
 * tables can never drift out of sync the way an ad-hoc UPDATE would risk.
 *
 * @param {{ capability: string, enabled: boolean, jurisdictionProfile?: string, lawfulBasis?: string|null }} input
 * @param {{ memberId: string, roleName: string }} actor
 */
export async function setMonitoringCapability(input, actor) {
  if (!KNOWN_CAPABILITIES.includes(input.capability)) {
    const err = new Error(`Unknown capability: ${input.capability}`);
    err.code = "UNKNOWN_CAPABILITY";
    throw err;
  }
  if (input.jurisdictionProfile && !JURISDICTION_PROFILES.includes(input.jurisdictionProfile)) {
    const err = new Error(`Unknown jurisdiction profile: ${input.jurisdictionProfile}`);
    err.code = "UNKNOWN_JURISDICTION_PROFILE";
    throw err;
  }
  if (!isManagementRole(actor?.roleName)) {
    const err = new Error("Only management may change monitoring capabilities.");
    err.code = "FORBIDDEN";
    throw err;
  }
  if (input.enabled && !input.lawfulBasis) {
    // CF-0.1: lawful_basis is part of what makes this an audit trail worth
    // anything - "someone flipped it on" with no recorded basis is not
    // evidence of lawful processing.
    const err = new Error("lawfulBasis is required to enable a capability.");
    err.code = "LAWFUL_BASIS_REQUIRED";
    throw err;
  }

  const previous = await getMonitoringCapabilityPg(input.capability);

  // CF-0.4: "may we" is checked separately from "can we" - even a management
  // actor with a valid lawful basis cannot enable a capability the effective
  // jurisdiction profile doesn't offer at all. The profile in play is
  // whichever this call sets, falling back to whatever's already stored.
  if (input.enabled) {
    const effectiveProfile = input.jurisdictionProfile ?? previous?.jurisdiction_profile ?? "strictest";
    if (!isCapabilityOfferable(input.capability, effectiveProfile)) {
      const err = new Error(
        `'${input.capability}' is not offerable under the '${effectiveProfile}' jurisdiction profile.`,
      );
      err.code = "CAPABILITY_NOT_OFFERABLE_IN_JURISDICTION";
      throw err;
    }
  }

  const updated = await setMonitoringCapabilityPg({
    capability: input.capability,
    enabled: input.enabled,
    jurisdictionProfile: input.jurisdictionProfile,
    lawfulBasis: input.enabled ? input.lawfulBasis : (input.lawfulBasis ?? previous?.lawful_basis ?? null),
    enabledBy: input.enabled ? actor.memberId : (previous?.enabled_by ?? null),
  });
  await insertMonitoringPolicyAuditPg({
    capability: input.capability,
    previousEnabled: previous ? previous.enabled === true : null,
    newEnabled: input.enabled,
    lawfulBasis: input.lawfulBasis ?? previous?.lawful_basis ?? null,
    actorMemberId: actor.memberId,
  });
  return normalizeCapabilityRow(updated);
}

/** @param {string} capability @param {number} [limit] */
export async function getMonitoringPolicyAudit(capability, limit) {
  if (!KNOWN_CAPABILITIES.includes(capability)) return [];
  const rows = await getMonitoringPolicyAuditPg(capability, limit);
  return rows.map((r) => ({
    id: r.id,
    capability: r.capability,
    previousEnabled: r.previous_enabled,
    newEnabled: r.new_enabled,
    lawfulBasis: r.lawful_basis,
    actorMemberId: r.actor_member_id,
    createdAt: r.created_at,
  }));
}

function normalizeConsentRow(memberId, row) {
  return {
    memberId,
    disclosedAt: row?.disclosed_at ?? null,
    consentedAt: row?.consented_at ?? null,
    noticeVersion: row?.notice_version ?? null,
  };
}

/** @param {string} memberId */
export async function getMemberMonitoringConsent(memberId) {
  const row = await getMemberMonitoringConsentPg(memberId);
  return normalizeConsentRow(memberId, row);
}

/**
 * CF-0.2: a member has been shown the current notice. Called on first run
 * and whenever a capability change re-triggers it - never implies consent by
 * itself, see recordMemberConsent.
 * @param {string} memberId @param {string} noticeVersion
 */
export async function recordMemberDisclosure(memberId, noticeVersion) {
  const row = await recordMemberDisclosurePg(memberId, noticeVersion);
  return normalizeConsentRow(memberId, row);
}

/**
 * CF-0.2: a member has acknowledged the current notice. `noticeVersion` must
 * match what they were actually shown - the caller (routes.js) is
 * responsible for that; this just records it.
 * @param {string} memberId @param {string} noticeVersion
 */
export async function recordMemberConsent(memberId, noticeVersion) {
  const row = await recordMemberConsentPg(memberId, noticeVersion);
  return normalizeConsentRow(memberId, row);
}

// CF-2: plain-language text per capability, used to build the disclosure
// notice. Placeholder copy - explicitly NOT reviewed by counsel (matches the
// disclaimer in TAURI-AGENT-IMPROVEMENTS.md Part 0). Swap the strings, not
// the mechanism, once real copy is approved.
const CAPABILITY_DISCLOSURE_TEXT = {
  screenshots: "Periodic screenshots of your screen while a timer is running.",
  app_tracking: "The name of the application and window you have active while a timer is running.",
  url_capture: "The web address of the page you're viewing in a supported browser while a timer is running.",
  activity_metering:
    "A measure of your mouse and keyboard activity while a timer is running, used to compute an activity percentage.",
  dns_logging: "The network destinations (domains) your device connects to while a timer is running.",
  integrity_signals:
    "Automated signals used to flag suspected attendance fraud (e.g. automated input, background video playback) for manager review.",
};

/**
 * CF-2: composes the current disclosure notice from the live CF-1 policy -
 * "sourced from the monitoring_policy row so it's always accurate to what's
 * actually enabled," never hardcoded. The version is a deterministic hash of
 * exactly the fields that change what an employee is told (capability,
 * enabled, lawful basis) - a policy change that actually changes the notice
 * text changes the version too, which is what forces re-disclosure
 * (hasCurrentConsent compares against this). A change to something the
 * notice doesn't mention (e.g. jurisdiction_profile alone) does not
 * spuriously invalidate an already-current consent.
 */
export async function composeMonitoringNotice() {
  const policy = await getMonitoringPolicy();
  const enabledCapabilities = policy.filter((c) => c.enabled);

  const versionInput = enabledCapabilities
    .map((c) => `${c.capability}:${c.enabled}:${c.lawfulBasis ?? ""}`)
    .sort()
    .join("|");
  const version = crypto.createHash("sha256").update(versionInput).digest("hex").slice(0, 16);

  const lines = [
    "Virtual Tracker records activity only while a timer you started is running - never in the background, and never without this notice.",
  ];
  if (enabledCapabilities.length === 0) {
    lines.push("No monitoring capabilities are currently enabled for your account.");
  } else {
    lines.push("What is collected while you are tracked:");
    for (const c of enabledCapabilities) {
      lines.push(`- ${CAPABILITY_DISCLOSURE_TEXT[c.capability] ?? c.capability}`);
    }
  }
  lines.push(
    "You can see your own collected data at any time, and a persistent indicator is shown whenever tracking is active.",
  );

  return { version, text: lines.join("\n"), enabledCapabilities: enabledCapabilities.map((c) => c.capability) };
}

/**
 * True only if the member has consented to the *current* notice text -
 * a stale consent (from before a policy change bumped the version) does not
 * count. This is what CF-2's agent gate and tracking-start check should call.
 * @param {string} memberId @param {string} currentNoticeVersion
 */
export async function hasCurrentConsent(memberId, currentNoticeVersion) {
  const consent = await getMemberMonitoringConsent(memberId);
  return Boolean(consent.consentedAt) && consent.noticeVersion === currentNoticeVersion;
}
