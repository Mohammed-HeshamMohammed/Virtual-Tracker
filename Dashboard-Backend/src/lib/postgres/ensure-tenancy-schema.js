import { logSafeWarn } from "../../http/sanitize-error.js";
import { getPostgresPool, isPostgresConfigured } from "./client.js";
import {
  TENANT_SCOPED_TABLES,
  SINGLETON_KEY_TABLES,
  UNIQUE_CONSTRAINTS_NEEDING_TENANT,
} from "./tenancy-tables.js";

/**
 * The main organization's tenant id. Fixed and well-known rather than
 * looked up, so every part of the codebase that needs "the main tenant" (the
 * bootstrap, the backfill below, tests) can reference it as a constant
 * instead of a query. Deliberately not gen_random_uuid() - a value that
 * changed across environments would make this migration non-reproducible.
 */
export const MAIN_TENANT_ID = "00000000-0000-0000-0000-000000000001";

/**
 * See PLAN-customer-accounts-and-tenancy.md §4.1-§4.3. tenants IS the
 * customer's membership - the paid period is an attribute of the grant, not
 * a separate subscription object (§4.3) - which is why there is no separate
 * "subscriptions" table and no expiry scheduler: tenant_is_active() is
 * computed from period_end on every read, nothing flips a flag at midnight.
 */
const CONTROL_PLANE_DDL = [
  `CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          VARCHAR(10)  NOT NULL DEFAULT 'customer' CHECK (type IN ('main', 'customer')),
  root_user_id  UUID,
  granted_role  VARCHAR(40)  NOT NULL DEFAULT '',
  seat_limit    INT          NOT NULL DEFAULT 1 CHECK (seat_limit >= 1),
  period_start  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  period_end    TIMESTAMPTZ  NOT NULL DEFAULT 'infinity',
  lifecycle     VARCHAR(20)  NOT NULL DEFAULT 'live' CHECK (lifecycle IN ('live', 'removing', 'removed')),
  created_by    UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_tenants_lifecycle ON tenants (lifecycle, period_end)",
  "DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants",
  `CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

  // The one definition of "may this tenant be used right now" - every caller
  // (the auth-middleware grant gate, the seat-check helper, the retention
  // sweep filter) goes through this rather than inventing its own reading of
  // lifecycle + period_end, which is exactly how two definitions drift apart.
  `CREATE OR REPLACE FUNCTION tenant_is_active(t tenants) RETURNS boolean AS $$
  SELECT t.lifecycle = 'live' AND now() < t.period_end;
$$ LANGUAGE sql STABLE`,

  // The main organization, seeded once at a fixed id (see MAIN_TENANT_ID's
  // own comment). period_end = infinity rather than special-casing
  // type = 'main' in every caller of tenant_is_active().
  `INSERT INTO tenants (id, type, granted_role, seat_limit, period_end, lifecycle)
   VALUES ('${MAIN_TENANT_ID}', 'main', 'Owner', 2147483647, 'infinity', 'live')
   ON CONFLICT (id) DO NOTHING`,

  // §4.1. code_hash stores only the hash (scrypt, salted - see
  // verification-code.service.js); the plaintext code never touches disk.
  `CREATE TABLE IF NOT EXISTS verification_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID         NOT NULL,
  purpose     VARCHAR(40)  NOT NULL DEFAULT 'customer_accounts_tab',
  code_hash   TEXT         NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  attempts    INT          NOT NULL DEFAULT 0,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_verification_codes_member ON verification_codes (member_id, purpose, created_at DESC)",

  // §4.1, §9. Deliberately NOT a foreign key to tenants(id): removal (§14.1)
  // deletes the tenant row itself, and the audit trail must survive that -
  // "this is the only way customer data is deleted... removal deletes
  // everyone under them" must not also silently delete the record that it
  // happened. Holds no customer business data, only the fact of the action.
  `CREATE TABLE IF NOT EXISTS customer_account_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL,
  actor_id    UUID         NOT NULL,
  action      VARCHAR(40)  NOT NULL,
  detail      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
)`,
  "CREATE INDEX IF NOT EXISTS idx_customer_audit_tenant ON customer_account_audit (tenant_id, created_at DESC)",
];

/**
 * Backfills every existing row of a normal-volume table to the main tenant
 * and locks the column down. Safe to run on an empty table (fresh installs)
 * or a populated one (existing deployments) - IF NOT EXISTS / WHERE
 * tenant_id IS NULL make every statement here idempotent across boots.
 */
/**
 * DEFAULT '<main>' on every one of these columns is deliberate, and it is
 * the boundary of what this migration can promise on its own (read this
 * before touching it). Two options were considered:
 *
 *   - NO default, NOT NULL: any INSERT that omits tenant_id fails loudly.
 *     Correct once every write path is retrofitted, but ~229 existing query
 *     call sites across ~43 service files (projects, tasks, teams, clients,
 *     time entries, invoices, expenses, ...) do not yet pass tenant_id at
 *     all - this would break ordinary member/project/task creation the
 *     instant this migration runs, which breaks §5 Phase 2's own promise
 *     ("columns exist, every row says main, nothing behaves differently").
 *   - DEFAULT main tenant: every untouched call site keeps working exactly
 *     as today, because its rows keep landing in the main tenant - which is
 *     where they already conceptually belonged before this feature existed.
 *
 * The cost of the second option: until a business table's write path is
 * EXPLICITLY retrofitted (the same currentTenantId() ?? MAIN_TENANT_ID
 * pattern already applied to lookup_tables/org_field_options in
 * lookup-postgres.service.js, and to members/invites via the customer-
 * accounts module and invite acceptance), a CUSTOMER creating their own
 * project/task/etc. would silently land it in the main tenant rather than
 * their own - not a leak (the main tenant can't be reached from a customer
 * session either way), but wrong data ownership. This is real, unfinished
 * work, not a default that quietly finishes the feature: every business
 * table's create path needs that explicit pass before customer tenants can
 * safely operate on their own data. Tracked, not hidden.
 */
function tenantColumnDdl(table) {
  return [
    // REFERENCES ... ON DELETE CASCADE (rather than a bare UUID column) is
    // what makes removal (§14.1) a single `DELETE FROM tenants WHERE id =
    // $1` instead of ~75 hand-ordered DELETEs - Postgres already knows every
    // table's dependency graph, more reliable than a manually authored
    // FK-safe order would be without a live database to verify it against.
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '${MAIN_TENANT_ID}' REFERENCES tenants(id) ON DELETE CASCADE`,
    `UPDATE ${table} SET tenant_id = '${MAIN_TENANT_ID}' WHERE tenant_id IS NULL`,
    `ALTER TABLE ${table} ALTER COLUMN tenant_id SET NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table} (tenant_id)`,
  ];
}

/**
 * Same column, but for a table large enough that SET NOT NULL's full-table
 * validation scan (or a plain CREATE INDEX's ACCESS EXCLUSIVE lock) would
 * stall production traffic - see PLAN-customer-accounts-and-tenancy.md §5
 * Phase 2. NOT VALID defers the scan to a separate VALIDATE CONSTRAINT
 * statement that does not block concurrent writes; the index is built
 * CONCURRENTLY outside the transactional loop entirely. Both live in
 * runHighVolumeTenancyMigrations below, each with its own try/catch, for
 * the same reason idx_act_url_session_visited does in
 * ensure-lookup-schema.js: a slow build must not abort schema setup for
 * every statement ordered after it.
 */
function tenantColumnDdlHighVolume(table) {
  return [
    // DEFAULT here for the same reason as tenantColumnDdl above - its own
    // doc comment explains the tradeoff.
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '${MAIN_TENANT_ID}' REFERENCES tenants(id) ON DELETE CASCADE`,
    `UPDATE ${table} SET tenant_id = '${MAIN_TENANT_ID}' WHERE tenant_id IS NULL`,
    `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${table}_tenant_id_not_null') THEN
    ALTER TABLE ${table} ADD CONSTRAINT ${table}_tenant_id_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
  END IF;
END $$`,
  ];
}

/**
 * The five org-singleton tables (§15.3): their primary key today PHYSICALLY
 * forbids a second row, so a tenant_id column alone does nothing for them -
 * this changes the key itself. Backfill happens before the key change so the
 * existing (singleton) row keeps its data as it becomes tenant main's row.
 */
function singletonKeyMigrationDdl({ name, oldKey }) {
  const pkConstraint = `${name}_pkey`;
  return [
    `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`,
    `UPDATE ${name} SET tenant_id = '${MAIN_TENANT_ID}' WHERE tenant_id IS NULL`,
    `ALTER TABLE ${name} ALTER COLUMN tenant_id SET NOT NULL`,
    // Drop the CHECK (id = 1) singleton guard where one exists - harmless
    // no-op via DO block when the table's guard was an enum PK instead
    // (data_retention_settings, monitoring_capabilities have no such CHECK).
    `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = '${name}' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%= 1%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE ${name} DROP CONSTRAINT ' || c.conname
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = '${name}' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%= 1%'
      LIMIT 1
    );
  END IF;
END $$`,
    // Re-key: (tenant_id) alone for the id-keyed tables (one row per tenant),
    // (tenant_id, oldKey) for the enum-keyed tables (one row per tenant PER
    // data_type/capability - the old key stays meaningful, it just stops
    // being globally unique on its own).
    `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${pkConstraint}') THEN
    ALTER TABLE ${name} DROP CONSTRAINT ${pkConstraint};
  END IF;
END $$`,
    oldKey === "id"
      ? `ALTER TABLE ${name} ADD CONSTRAINT ${pkConstraint} PRIMARY KEY (tenant_id)`
      : `ALTER TABLE ${name} ADD CONSTRAINT ${pkConstraint} PRIMARY KEY (tenant_id, ${oldKey})`,
  ];
}

/** The UNIQUE constraints in §15.4 that break once two tenants can both
 *  want the same human-chosen name. */
function tenantUniqueMigrationDdl({ table, oldConstraint, columns }) {
  const newConstraint = `uq_${table}_tenant_${columns.join("_")}`;
  const dropOld = oldConstraint
    ? [
        `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${oldConstraint}') THEN
    ALTER TABLE ${table} DROP CONSTRAINT ${oldConstraint};
  END IF;
END $$`,
      ]
    : [
        // Unnamed UNIQUE constraints (invoices.number, time_off_policies.name)
        // - find whatever Postgres auto-named it and drop that instead.
        `DO $$
DECLARE cname text;
BEGIN
  SELECT c.conname INTO cname
  FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = '${table}' AND c.contype = 'u'
    AND c.conkey = (
      SELECT array_agg(a.attnum ORDER BY a.attnum)
      FROM pg_attribute a
      WHERE a.attrelid = t.oid AND a.attname = ANY(ARRAY[${columns.map((c) => `'${c}'`).join(", ")}])
    )
  LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE ${table} DROP CONSTRAINT ' || cname;
  END IF;
END $$`,
      ];
  return [
    ...dropOld,
    `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${newConstraint}') THEN
    ALTER TABLE ${table} ADD CONSTRAINT ${newConstraint} UNIQUE (tenant_id, ${columns.join(", ")});
  END IF;
END $$`,
  ];
}

const HIGH_VOLUME_NAMES = new Set(
  TENANT_SCOPED_TABLES.filter((e) => typeof e === "object" && e.highVolume).map((e) => e.name),
);
const SINGLETON_NAMES = new Set(SINGLETON_KEY_TABLES.map((e) => e.name));

const TENANT_COLUMN_DDL = TENANT_SCOPED_TABLES.flatMap((entry) => {
  const name = typeof entry === "string" ? entry : entry.name;
  // Singleton-key tables get their column + backfill as part of the PK
  // migration below (the PK change needs the column to exist first anyway),
  // not twice.
  if (SINGLETON_NAMES.has(name)) return [];
  return HIGH_VOLUME_NAMES.has(name) ? tenantColumnDdlHighVolume(name) : tenantColumnDdl(name);
});

const SINGLETON_KEY_DDL = SINGLETON_KEY_TABLES.flatMap((entry) => singletonKeyMigrationDdl(entry));

const UNIQUE_CONSTRAINT_DDL = UNIQUE_CONSTRAINTS_NEEDING_TENANT.flatMap((entry) =>
  tenantUniqueMigrationDdl(entry),
);

/**
 * Replaces fn_audit_log_trigger() (originally defined in
 * ensure-lookup-schema.js, which still runs first and creates audit_logs
 * itself) with a tenant-aware version, once audit_logs.tenant_id definitely
 * exists - see §14.3. Ordered after TENANT_COLUMN_DDL in the statement list
 * below for exactly that reason: CREATE OR REPLACE FUNCTION's body is
 * validated against the live catalog, so this must not run before the
 * column it inserts into does.
 */
const AUDIT_TRIGGER_DDL = [
  `CREATE OR REPLACE FUNCTION fn_audit_log_trigger()
RETURNS TRIGGER AS $$
DECLARE
  actor UUID;
  row_tenant UUID;
BEGIN
  BEGIN
    actor := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    actor := NULL;
  END;

  -- Derived generically from whichever row triggered this, not by naming
  -- tables - a table with no tenant_id (the global ones, e.g. roles) simply
  -- yields NULL from the ->>'tenant_id' lookup below and falls through to
  -- the main tenant, and a trigger added to a third table later is covered
  -- automatically. Falling back to the main tenant rather than leaving NULL
  -- keeps "NULL" from ever meaning "visible to every tenant" once audit_logs
  -- itself gets an RLS policy in Phase 3.
  BEGIN
    row_tenant := COALESCE(
      NULLIF(COALESCE(to_jsonb(NEW)->>'tenant_id', to_jsonb(OLD)->>'tenant_id'), '')::uuid,
      '${MAIN_TENANT_ID}'::uuid
    );
  EXCEPTION WHEN others THEN
    row_tenant := '${MAIN_TENANT_ID}'::uuid;
  END;

  INSERT INTO audit_logs (table_name, record_id, action, old_data, new_data, performed_by, tenant_id)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    actor,
    row_tenant
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER`,
];

export async function ensureTenancySchema() {
  if (!isPostgresConfigured()) {
    return { ok: true, skipped: true };
  }
  const pool = getPostgresPool();
  if (!pool) {
    return { ok: false, error: "Postgres pool unavailable" };
  }

  const client = await pool.connect();
  try {
    for (const statement of [
      ...CONTROL_PLANE_DDL,
      ...TENANT_COLUMN_DDL,
      ...SINGLETON_KEY_DDL,
      ...UNIQUE_CONSTRAINT_DDL,
      ...AUDIT_TRIGGER_DDL,
    ]) {
      await client.query(statement);
    }
    return { ok: true };
  } catch (err) {
    logSafeWarn("[postgres] ensure tenancy schema failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

/**
 * The slow part of Phase 2 for the high-volume tables (§5): VALIDATE
 * CONSTRAINT (the scan SET NOT NULL would otherwise take an ACCESS
 * EXCLUSIVE lock for) and CREATE INDEX CONCURRENTLY, both outside any
 * transaction, both non-fatal on failure - a miss just means the table is
 * still only NOT VALID / unindexed until next boot's retry, matching the
 * idx_act_url_session_visited precedent in ensure-lookup-schema.js.
 *
 * Deliberately not part of ensureTenancySchema's own transaction-less loop
 * above: called separately, after it, so a single slow table can't delay
 * every other statement in the main pass.
 */
export async function runHighVolumeTenancyMigrations() {
  if (!isPostgresConfigured()) return;
  const pool = getPostgresPool();
  if (!pool) return;

  for (const table of HIGH_VOLUME_NAMES) {
    const indexName = `idx_${table}_tenant`;
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = '${indexName}' AND NOT i.indisvalid
          ) THEN
            EXECUTE 'DROP INDEX ${indexName}';
          END IF;
        END $$;
      `);
      await pool.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON ${table} (tenant_id)`);
    } catch (err) {
      logSafeWarn(`[postgres] ${indexName} not built this boot:`, err);
    }

    try {
      await pool.query(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${table}_tenant_id_not_null`);
    } catch (err) {
      logSafeWarn(`[postgres] ${table}_tenant_id_not_null not validated this boot:`, err);
    }
  }
}
