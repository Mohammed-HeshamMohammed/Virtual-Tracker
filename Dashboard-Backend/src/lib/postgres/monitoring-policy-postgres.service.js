import { query } from "./client.js";

const CAPABILITY_COLUMNS = [
  "capability",
  "enabled",
  "jurisdiction_profile",
  "lawful_basis",
  "enabled_by",
  "enabled_at",
  "updated_at",
];

export async function getAllMonitoringCapabilitiesPg() {
  return query(`SELECT ${CAPABILITY_COLUMNS.join(", ")} FROM monitoring_capabilities ORDER BY capability`);
}

export async function getMonitoringCapabilityPg(capability) {
  const rows = await query(
    `SELECT ${CAPABILITY_COLUMNS.join(", ")} FROM monitoring_capabilities WHERE capability = $1 LIMIT 1`,
    [capability],
  );
  return rows[0] ?? null;
}

export async function setMonitoringCapabilityPg(input) {
  const rows = await query(
    `INSERT INTO monitoring_capabilities (capability, enabled, jurisdiction_profile, lawful_basis, enabled_by, enabled_at, updated_at)
     VALUES ($1, $2, COALESCE($3, 'strictest'), $4, $5, CASE WHEN $2 THEN now() ELSE NULL END, now())
     ON CONFLICT (capability) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       jurisdiction_profile = COALESCE($3, monitoring_capabilities.jurisdiction_profile),
       lawful_basis = $4,
       enabled_by = $5,
       enabled_at = CASE WHEN EXCLUDED.enabled THEN now() ELSE monitoring_capabilities.enabled_at END,
       updated_at = now()
     RETURNING ${CAPABILITY_COLUMNS.join(", ")}`,
    [
      input.capability,
      input.enabled,
      input.jurisdictionProfile ?? null,
      input.lawfulBasis ?? null,
      input.enabledBy ?? null,
    ],
  );
  return rows[0] ?? null;
}

export async function insertMonitoringPolicyAuditPg(input) {
  await query(
    `INSERT INTO monitoring_policy_audit (capability, previous_enabled, new_enabled, lawful_basis, actor_member_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.capability,
      input.previousEnabled ?? null,
      input.newEnabled,
      input.lawfulBasis ?? null,
      input.actorMemberId ?? null,
    ],
  );
}

export async function getMonitoringPolicyAuditPg(capability, limit = 200) {
  return query(
    `SELECT id, capability, previous_enabled, new_enabled, lawful_basis, actor_member_id, created_at
     FROM monitoring_policy_audit WHERE capability = $1 ORDER BY created_at DESC LIMIT $2`,
    [capability, limit],
  );
}

export async function getMemberMonitoringConsentPg(memberId) {
  const rows = await query(
    `SELECT member_id, disclosed_at, consented_at, notice_version, updated_at
     FROM member_monitoring_consent WHERE member_id = $1 LIMIT 1`,
    [memberId],
  );
  return rows[0] ?? null;
}

export async function recordMemberDisclosurePg(memberId, noticeVersion) {
  const rows = await query(
    `INSERT INTO member_monitoring_consent (member_id, disclosed_at, notice_version, updated_at)
     VALUES ($1, now(), $2, now())
     ON CONFLICT (member_id) DO UPDATE SET
       disclosed_at = now(),
       notice_version = $2,
       updated_at = now()
     RETURNING member_id, disclosed_at, consented_at, notice_version, updated_at`,
    [memberId, noticeVersion],
  );
  return rows[0] ?? null;
}

export async function recordMemberConsentPg(memberId, noticeVersion) {
  const rows = await query(
    `INSERT INTO member_monitoring_consent (member_id, disclosed_at, consented_at, notice_version, updated_at)
     VALUES ($1, now(), now(), $2, now())
     ON CONFLICT (member_id) DO UPDATE SET
       consented_at = now(),
       notice_version = $2,
       updated_at = now()
     RETURNING member_id, disclosed_at, consented_at, notice_version, updated_at`,
    [memberId, noticeVersion],
  );
  return rows[0] ?? null;
}
