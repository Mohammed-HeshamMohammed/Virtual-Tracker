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

export const JURISDICTION_CAPABILITY_RESTRICTIONS = Object.freeze({
  eu_uk: Object.freeze(["dns_logging"]),
  us_one_party_consent: Object.freeze([]),
  us_two_party_consent: Object.freeze([]),
  strictest: Object.freeze(["dns_logging"]),
});

export function isCapabilityOfferable(capability, jurisdictionProfile) {
  const profile = jurisdictionProfile && JURISDICTION_PROFILES.includes(jurisdictionProfile)
    ? jurisdictionProfile
    : "strictest";
  const restricted = JURISDICTION_CAPABILITY_RESTRICTIONS[profile] ?? [];
  return !restricted.includes(capability);
}

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

export async function isCapabilityEnabled(capability) {
  if (!KNOWN_CAPABILITIES.includes(capability)) return false;
  const row = await getMonitoringCapabilityPg(capability);
  return row?.enabled === true;
}

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
    const err = new Error("lawfulBasis is required to enable a capability.");
    err.code = "LAWFUL_BASIS_REQUIRED";
    throw err;
  }

  const previous = await getMonitoringCapabilityPg(input.capability);

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

export async function getMemberMonitoringConsent(memberId) {
  const row = await getMemberMonitoringConsentPg(memberId);
  return normalizeConsentRow(memberId, row);
}

export async function recordMemberDisclosure(memberId, noticeVersion) {
  const row = await recordMemberDisclosurePg(memberId, noticeVersion);
  return normalizeConsentRow(memberId, row);
}

export async function recordMemberConsent(memberId, noticeVersion) {
  const row = await recordMemberConsentPg(memberId, noticeVersion);
  return normalizeConsentRow(memberId, row);
}

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

export async function hasCurrentConsent(memberId, currentNoticeVersion) {
  const consent = await getMemberMonitoringConsent(memberId);
  return Boolean(consent.consentedAt) && consent.noticeVersion === currentNoticeVersion;
}
