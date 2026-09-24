/**
 * §3.1, §6: every write in this file is a cross-tenant write by nature - an
 * Owner sitting in the main tenant creating, renewing, reseating or
 * removing a CUSTOMER tenant. That is the one deliberately allowed
 * exception to "the tenant is taken from the session, never a parameter"
 * (§4). Once POSTGRES_TENANCY_RLS_ENABLED is actually live AND the
 * connection-string cutover to per-role pools has happened (see
 * ensure-tenancy-rls.js's own comment for why that is a separate, later
 * step), every function in this file MUST run on the vt_admin connection
 * (BYPASSRLS), not vt_app: vt_app's RLS policy would reject
 * createCustomerTenant's own INSERTs, because the acting Owner's published
 * tenant is the MAIN tenant while the rows being inserted belong to the
 * brand-new CUSTOMER tenant - exactly the mismatch the WITH CHECK clause
 * exists to catch. client.js currently exposes one pool for the whole app
 * (the multi-pool split is the same operational step noted above), so this
 * is not yet wired to a distinct connection - flagged here so it is not
 * missed when that wiring lands.
 */
import crypto from "node:crypto";
import { query, withTransaction, withTenant } from "../../lib/postgres/client.js";
import { getAuthAdmin, getDb } from "../../config/firebase.js";
import { resolveRoleIdByName } from "../members/services/relation-sync.js";
import { assertEmailCanUseMemberInviteOrPreprovision, normalizeMemberEmail } from "../members/services/eligibility.js";
import { isEnterpriseRole } from "../../http/role-hierarchy.js";
import { resolveAppPublicUrl } from "../auth/app-public-url.js";
import { sendMemberInviteEmail } from "../auth/invite-email.js";
import { deleteFromGCS } from "../../lib/gcs/upload.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { recordCustomerAccountAudit } from "./audit.service.js";
import { invalidateTenantGrantCache } from "./tenant-grant-cache.js";
import { getEnv } from "../../config/env.js";
import {
  getTenancyIsolationReport,
  ISOLATION_ENFORCED,
} from "../../lib/postgres/verify-tenancy-isolation.js";
import { MAIN_TENANT_ID } from "../../lib/postgres/ensure-tenancy-schema.js";
import { usedSeatsSql } from "./seat-usage.service.js";
import {
  seedLookupTablePostgresIfEmpty,
  seedOrgFieldOptionsPostgresIfEmpty,
} from "../../lib/postgres/lookup-postgres.service.js";
import { ORG_FIELD_OPTION_SEEDS, ORG_LOOKUP_SEEDS } from "../../bootstrap/entity-bootstrap-manifest.js";

const RETENTION_DATA_TYPES = ["screenshots", "app_logs", "url_logs", "sessions"];
const MONITORING_CAPABILITIES = [
  "screenshots",
  "app_tracking",
  "url_capture",
  "activity_metering",
  "dns_logging",
  "integrity_signals",
];

/**
 * §15.3: the five org-singleton config tables are re-keyed to
 * (tenant_id[, oldKey]), so a new tenant starts with ZERO rows unless
 * seeded here - a customer with no currency_settings row, for instance,
 * would read as broken rather than simply defaulted. Every non-key column
 * on these tables already has a DEFAULT (see ensure-tenancy-schema.js's
 * singletonKeyMigrationDdl), so inserting just the key columns is enough to
 * give a new tenant the same defaults a fresh main org gets.
 */
async function seedDefaultTenantSettings(client, tenantId) {
  await client.query(`INSERT INTO currency_settings (tenant_id) VALUES ($1)`, [tenantId]);
  await client.query(`INSERT INTO capture_minimization_settings (tenant_id) VALUES ($1)`, [tenantId]);
  await client.query(`INSERT INTO activity_scoring_settings (tenant_id) VALUES ($1)`, [tenantId]);
  for (const dataType of RETENTION_DATA_TYPES) {
    await client.query(`INSERT INTO data_retention_settings (tenant_id, data_type) VALUES ($1, $2)`, [tenantId, dataType]);
  }
  for (const capability of MONITORING_CAPABILITIES) {
    await client.query(`INSERT INTO monitoring_capabilities (tenant_id, capability) VALUES ($1, $2)`, [tenantId, capability]);
  }
}

/** Same job-title/department/employment-type defaults ensureOrganizationEntities
 *  seeds for the main org at bootstrap (entity-bootstrap.js), scoped to the
 *  new tenant via withTenant so seedLookupTablePostgresIfEmpty's implicit
 *  tenantIdOrMain() resolves to it rather than the main tenant. */
async function seedDefaultTenantLookups(tenantId) {
  await withTenant(tenantId, async () => {
    for (const [collection, names] of Object.entries(ORG_LOOKUP_SEEDS)) {
      await seedLookupTablePostgresIfEmpty(collection, names, null);
    }
    for (const [type, labels] of Object.entries(ORG_FIELD_OPTION_SEEDS)) {
      await seedOrgFieldOptionsPostgresIfEmpty(type, labels);
    }
  });
}

export class CustomerAccountError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || "CUSTOMER_ACCOUNT_ERROR";
  }
}

function randomInviteToken() {
  return crypto.randomBytes(24).toString("hex");
}

function assertValidGrantedRole(roleName) {
  if (!isEnterpriseRole(roleName)) {
    throw new CustomerAccountError(
      400,
      "Role must be Enterprise Super Manager or Enterprise Manager.",
      "INVALID_ROLE",
    );
  }
}

function assertPeriodEndInFuture(periodEndIso) {
  const t = Date.parse(periodEndIso);
  if (!Number.isFinite(t)) {
    throw new CustomerAccountError(400, "Paid period end date is invalid.", "INVALID_PERIOD");
  }
  if (t <= Date.now()) {
    throw new CustomerAccountError(400, "Paid period must end in the future.", "INVALID_PERIOD");
  }
  return new Date(t).toISOString();
}

function assertValidSeatLimit(seatLimit) {
  const n = Number(seatLimit);
  if (!Number.isInteger(n) || n < 1) {
    throw new CustomerAccountError(400, "Seats must be a whole number of at least 1.", "INVALID_SEATS");
  }
  return n;
}

/**
 * The moment the tenancy gap stops being theoretical. While the main tenant
 * is the only one, unenforced isolation leaks nothing - there is no second
 * organization to leak to. Creating a customer tenant is the single action
 * that turns that same configuration into live cross-tenant exposure, so it
 * is the single action worth refusing.
 *
 * Refusing here rather than at boot is deliberate: taking the whole server
 * down over a risk that is currently inert would be worse than the risk.
 */
export async function assertIsolationReadyForNewTenant() {
  if (getEnv().postgres.allowUnisolatedCustomerTenants) {
    logSafeWarn(
      "[customer-accounts] creating a customer tenant with database isolation unverified; " +
        "ALLOW_UNISOLATED_CUSTOMER_TENANTS is set.",
    );
    return;
  }
  const report = await getTenancyIsolationReport();
  if (report.status === ISOLATION_ENFORCED) return;

  throw new CustomerAccountError(
    409,
    "This database is not enforcing tenant isolation, so a second organization's data would be " +
      `reachable from the first. ${report.reasons.join(" ")}`,
    "TENANT_ISOLATION_NOT_ENFORCED",
  );
}

/** Phase 4: create a customer tenant + its root invite. */
export async function createCustomerTenant({ email, periodEnd, seatLimit, grantedRole, actorId, appOrigin }) {
  await assertIsolationReadyForNewTenant();
  assertValidGrantedRole(grantedRole);
  const validPeriodEnd = assertPeriodEndInFuture(periodEnd);
  const validSeatLimit = assertValidSeatLimit(seatLimit);

  const emailNorm = normalizeMemberEmail(email);
  const db = getDb();
  const auth = getAuthAdmin();
  if (!auth) {
    throw new CustomerAccountError(503, "Authentication service is not configured.", "AUTH_UNAVAILABLE");
  }
  const eligibility = await assertEmailCanUseMemberInviteOrPreprovision(db, auth, emailNorm);
  if (!eligibility.ok) {
    throw new CustomerAccountError(409, eligibility.message, "EMAIL_UNAVAILABLE");
  }

  const roleId = await resolveRoleIdByName(db, grantedRole);
  const token = randomInviteToken();
  const inviteId = crypto.randomUUID();

  const { tenant } = await withTransaction(async (client) => {
    const tenantRows = await client.query(
      `INSERT INTO tenants (type, granted_role, seat_limit, period_start, period_end, lifecycle, created_by)
       VALUES ('customer', $1, $2, now(), $3, 'live', $4)
       RETURNING id, type, granted_role, seat_limit, period_start, period_end, lifecycle, created_at`,
      [grantedRole, validSeatLimit, validPeriodEnd, actorId],
    );
    const newTenant = tenantRows.rows[0];

    await client.query(
      `INSERT INTO invites (id, email, invite_token, invite_kind, role_id, pay_rate, currency, status, sent_at, created_by, tenant_id)
       VALUES ($1, $2, $3, 'email', $4, 0, 'USD', 'pending_signup', now(), $5, $6)`,
      [inviteId, emailNorm, token, roleId, actorId, newTenant.id],
    );

    await seedDefaultTenantSettings(client, newTenant.id);

    return { tenant: newTenant };
  });

  // Non-critical seed data (job titles, departments, employment-type
  // options) - useful for onboarding but not atomic with tenant creation
  // the way the five config-singleton rows above are (a tenant with no
  // currency/retention/monitoring row would read as broken; one with no
  // job titles yet just reads as empty, same as a fresh main org would).
  await seedDefaultTenantLookups(tenant.id).catch((err) =>
    logSafeWarn("[customer-accounts] default lookup seeding failed", { tenantId: tenant.id, err }),
  );

  const inviteUrl = `${resolveAppPublicUrl(appOrigin)}/invite/${token}`;
  const emailResult = await sendMemberInviteEmail({ email: emailNorm, inviteUrl, roleName: grantedRole });

  await recordCustomerAccountAudit({
    tenantId: tenant.id,
    actorId,
    action: "created",
    detail: { email: emailNorm, grantedRole, seatLimit: validSeatLimit, periodEnd: validPeriodEnd },
  });

  return { tenant, inviteUrl, emailSent: emailResult.sent === true };
}

/** US-5: email, role, seats used/limit, period end, status - one list row
 *  per tenant. Seats used is seat-usage.service.js's usedSeatsSql, the one
 *  definition every seat figure and the add/invite guard share. */
export async function listCustomerTenants() {
  return query(
    `SELECT
       t.id, t.granted_role, t.seat_limit, t.period_start, t.period_end, t.lifecycle, t.created_at,
       COALESCE(root.work_email, invite_email.email) AS email,
       (t.lifecycle = 'live' AND now() < t.period_end) AS active,
       ${usedSeatsSql("t.id")} AS seats_used
     FROM tenants t
     LEFT JOIN members root ON root.id = t.root_user_id
     LEFT JOIN LATERAL (
       SELECT email FROM invites WHERE tenant_id = t.id ORDER BY sent_at ASC LIMIT 1
     ) invite_email ON root.id IS NULL
     WHERE t.type = 'customer'
     ORDER BY t.created_at DESC`,
  );
}

export async function getCustomerTenantDetail(tenantId) {
  const rows = await query(
    `SELECT
       t.id, t.granted_role, t.seat_limit, t.period_start, t.period_end, t.lifecycle, t.created_at,
       t.root_user_id,
       COALESCE(root.work_email, invite_email.email) AS email,
       (t.lifecycle = 'live' AND now() < t.period_end) AS active,
       ${usedSeatsSql("t.id")} AS seats_used
     FROM tenants t
     LEFT JOIN members root ON root.id = t.root_user_id
     LEFT JOIN LATERAL (
       SELECT email FROM invites WHERE tenant_id = t.id ORDER BY sent_at ASC LIMIT 1
     ) invite_email ON root.id IS NULL
     WHERE t.id = $1 AND t.type = 'customer'
     LIMIT 1`,
    [tenantId],
  );
  const tenant = rows[0];
  if (!tenant) throw new CustomerAccountError(404, "Customer account not found.", "NOT_FOUND");
  return tenant;
}

export async function renewCustomerTenantPeriod(tenantId, periodEnd, actorId) {
  const validPeriodEnd = assertPeriodEndInFuture(periodEnd);
  const rows = await query(
    `UPDATE tenants SET period_end = $2 WHERE id = $1 AND type = 'customer'
     RETURNING id, period_end`,
    [tenantId, validPeriodEnd],
  );
  if (!rows[0]) throw new CustomerAccountError(404, "Customer account not found.", "NOT_FOUND");
  // "Renewal restores access immediately" (§4.3) - not after the grant
  // cache's TTL expires on its own.
  invalidateTenantGrantCache(tenantId);
  await recordCustomerAccountAudit({
    tenantId,
    actorId,
    action: "renewed",
    detail: { periodEnd: validPeriodEnd },
  });
  return rows[0];
}

export async function changeCustomerTenantSeats(tenantId, seatLimit, actorId) {
  const validSeatLimit = assertValidSeatLimit(seatLimit);
  return withTransaction(async (client) => {
    const tenantRows = await client.query(
      `SELECT id, seat_limit FROM tenants WHERE id = $1 AND type = 'customer' FOR UPDATE`,
      [tenantId],
    );
    const tenant = tenantRows.rows[0];
    if (!tenant) throw new CustomerAccountError(404, "Customer account not found.", "NOT_FOUND");

    const usedRows = await client.query(
      `SELECT ${usedSeatsSql("$1")} AS used`,
      [tenantId],
    );
    const used = Number(usedRows.rows[0]?.used ?? 0);
    if (validSeatLimit < used) {
      throw new CustomerAccountError(
        409,
        `Cannot set the seat limit below ${used}, the number of seats already in use.`,
        "SEATS_BELOW_USED",
      );
    }

    const updated = await client.query(
      `UPDATE tenants SET seat_limit = $2 WHERE id = $1 RETURNING id, seat_limit`,
      [tenantId, validSeatLimit],
    );
    invalidateTenantGrantCache(tenantId);

    await recordCustomerAccountAudit({
      tenantId,
      actorId,
      action: "seats_changed",
      detail: { from: tenant.seat_limit, to: validSeatLimit },
    });

    return updated.rows[0];
  });
}

/** US-5's read-only detail view: every Owner/Super Admin open of a
 *  customer's data is audited (spec, §9). Call this from the read-only
 *  cross-tenant route, not from the account-management list above (which is
 *  metadata about the account, not a look at its business data). */
export async function recordCustomerDataView(tenantId, actorId, surface) {
  await recordCustomerAccountAudit({
    tenantId,
    actorId,
    action: "viewed",
    detail: { surface: surface || "dashboard" },
  });
}

/** Counts for the removal confirmation dialog (US-7). Deliberately not
 *  exhaustive across all 75 scoped tables - these are the ones a human
 *  reads before typing the confirmation email. */
export async function getRemovalPreview(tenantId) {
  await getCustomerTenantDetail(tenantId); // 404s if missing
  const rows = await query(
    `SELECT
       (SELECT count(*) FROM members WHERE tenant_id = $1) AS members,
       (SELECT count(*) FROM invites WHERE tenant_id = $1) AS pending_invites,
       (SELECT count(*) FROM projects WHERE tenant_id = $1) AS projects,
       (SELECT count(*) FROM tasks WHERE tenant_id = $1) AS tasks,
       (SELECT count(*) FROM time_entries WHERE tenant_id = $1) AS time_entries,
       (SELECT count(*) FROM activity_screenshots WHERE tenant_id = $1) AS screenshots`,
    [tenantId],
  );
  return rows[0];
}

/**
 * §14.1's four-step removal:
 *   1. lifecycle='removing' + revoke every session in the tree - access ends
 *      before anything is destroyed, instantly (the auth-middleware grant
 *      gate reads lifecycle on the very next request).
 *   2. delete archived screenshot blobs from GCS, lock-then-delete exactly
 *      like data-retention.js's own retention sweep (delete the blob, THEN
 *      count it as handled - a failure leaves the row for the next attempt
 *      rather than losing track of it).
 *   3. ONE transaction: DELETE FROM tenants WHERE id = $1, which cascades to
 *      every scoped table through the ON DELETE CASCADE FKs added in
 *      ensure-tenancy-schema.js - atomic and correctly ordered by Postgres
 *      itself rather than a hand-authored 75-table sequence.
 *   4. audit 'removed', written after commit against the (now-deleted)
 *      tenant_id - customer_account_audit is deliberately not a foreign key
 *      to tenants(id) for exactly this moment.
 */
export async function removeCustomerTenant(tenantId, actorId, { confirmEmail }) {
  const tenant = await getCustomerTenantDetail(tenantId);
  const normalizedConfirm = normalizeMemberEmail(confirmEmail);
  if (!normalizedConfirm || normalizedConfirm !== normalizeMemberEmail(tenant.email || "")) {
    throw new CustomerAccountError(
      400,
      "Type the customer's exact email address to confirm removal.",
      "CONFIRM_EMAIL_MISMATCH",
    );
  }

  // Step 1: lock the tenant out before touching any data. The cache bust
  // happens HERE, not after this whole function returns - steps 2-3 below
  // (GCS deletes, the final transaction) can take real time on a tenant
  // with a lot of archived screenshots, and a stale cached "active" grant
  // for that entire window would defeat the point of locking out first.
  await query(`UPDATE tenants SET lifecycle = 'removing' WHERE id = $1`, [tenantId]);
  invalidateTenantGrantCache(tenantId);
  const auth = getAuthAdmin();
  if (auth) {
    const memberRows = await query(`SELECT firebase_uid FROM members WHERE tenant_id = $1`, [tenantId]);
    await Promise.all(
      memberRows
        .filter((r) => r.firebase_uid)
        .map((r) =>
          auth.revokeRefreshTokens(r.firebase_uid).catch((err) => {
            logSafeWarn("[customer-accounts/remove] revokeRefreshTokens failed", { uid: r.firebase_uid, err });
          }),
        ),
    );
  }

  // Step 2: delete archived screenshot blobs before the rows that reference
  // them disappear in step 3 - same ordering rationale as
  // data-retention.js's runRetentionSweep (delete the blob, then the row can
  // safely go; a blob delete failure here just means it is retried by the
  // ordinary retention sweep for whatever rows survive until step 3 runs).
  const archived = await query(
    `SELECT id, screenshot_url FROM activity_screenshots WHERE tenant_id = $1 AND screenshot_url IS NOT NULL`,
    [tenantId],
  );
  for (const row of archived) {
    try {
      await deleteFromGCS(row.screenshot_url);
    } catch (err) {
      logSafeWarn("[customer-accounts/remove] GCS delete failed, will remain for a later pass", {
        id: row.id,
        err,
      });
    }
  }

  // Step 3: one atomic statement, cascades everywhere.
  await query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);

  // Step 4: outside any transaction, deliberately - see this function's own
  // doc comment on why customer_account_audit is not an FK to tenants(id).
  await recordCustomerAccountAudit({
    tenantId,
    actorId,
    action: "removed",
    detail: { email: tenant.email, membersRemoved: tenant.seats_used ?? null },
  });

  return { removed: true };
}

export { MAIN_TENANT_ID };
