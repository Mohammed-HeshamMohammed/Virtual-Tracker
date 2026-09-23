// Where a row lands when nobody names a tenant, and who a list query can
// see. Both used to answer "the main organization" regardless of who asked:
//
//   - tenant_id's column DEFAULT was the literal main tenant, so every write
//     path not yet retrofitted (projects, tasks, teams, time entries, ...)
//     put a CUSTOMER's rows in the main org.
//   - the invite lists had no tenant predicate at all, relying on RLS, which
//     is off by default.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAIN_TENANT_ID,
  listTenancySchemaStatements,
} from "../src/lib/postgres/ensure-tenancy-schema.js";
import { TENANT_SCOPED_TABLES } from "../src/lib/postgres/tenancy-tables.js";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const statements = listTenancySchemaStatements();

const tableNames = TENANT_SCOPED_TABLES.map((e) => (typeof e === "string" ? e : e.name));

test("the tenant default reads the request's tenant, not a hardcoded main", () => {
  const defaults = statements.filter((s) => /ALTER COLUMN tenant_id SET DEFAULT/.test(s));
  assert.ok(defaults.length > 0, "the migration must set the default explicitly");

  for (const s of defaults) {
    assert.match(s, /current_setting\('app\.tenant_id', true\)/, s);
    // NULLIF: an unset GUC publishes '' (client.js always publishes
    // something), and ''::uuid throws rather than yielding NULL.
    assert.match(s, /NULLIF\(current_setting\('app\.tenant_id', true\), ''\)/, s);
    // Background work with no tenant frame still falls back to main.
    assert.ok(s.includes(`'${MAIN_TENANT_ID}'::uuid`), s);
  }
});

test("every tenant-scoped table gets that default, not just newly created ones", () => {
  // ADD COLUMN IF NOT EXISTS is a no-op once the column exists, so a
  // database that already ran the old migration would keep the old literal
  // default forever without a separate SET DEFAULT per table.
  const withDefault = new Set(
    statements
      .map((s) => /^ALTER TABLE (\w+) ALTER COLUMN tenant_id SET DEFAULT/.exec(s)?.[1])
      .filter(Boolean),
  );
  const missing = tableNames.filter((t) => !withDefault.has(t));
  assert.deepEqual(missing, [], `tables left on the old default: ${missing.join(", ")}`);
});

test("no tenant column is still created with the old literal default", () => {
  for (const s of statements) {
    if (!/ADD COLUMN IF NOT EXISTS tenant_id/.test(s)) continue;
    assert.doesNotMatch(
      s,
      new RegExp(`DEFAULT '${MAIN_TENANT_ID}'`),
      `still pins new rows to the main tenant: ${s}`,
    );
  }
});

test("an explicit tenant_id still wins over the default", () => {
  // Not a property of the SQL above - a column DEFAULT only applies when the
  // column is omitted - but the retrofitted paths depend on it, so this
  // pins the fact that they keep naming their tenant explicitly.
  const invites = read("src/modules/members/routes/member-invites.routes.js");
  assert.match(invites, /tenant_id: viewer\?\.tenantId \|\| MAIN_TENANT_ID/);
  assert.match(read("src/lib/postgres/clients-postgres.service.js"), /data\.tenantId \?\? currentTenantId\(\)/);
});

test("every invite LIST query is scoped to one tenant", () => {
  // By-id / by-token / by-email lookups are excluded: they are addressed by
  // a specific identifier and gated by their own route checks. It is the
  // unbounded lists that leaked another organization's pending invites.
  const files = [
    "src/modules/compat/routes.js",
    "src/modules/bootstrap/bootstrap-warm-service.js",
    "src/modules/member-onboarding/routes.js",
    "src/modules/schema/services/postgres-crud.service.js",
  ];
  for (const file of files) {
    const src = read(file);
    for (const line of src.split("\n")) {
      if (!/FROM invites/.test(line)) continue;
      if (/WHERE id = \$1|WHERE invite_token|WHERE email = \$1/.test(line)) continue;
      assert.match(line.trim(), /tenant_id = \$\d/, `${file}: unscoped invite list -> ${line.trim()}`);
    }
  }
});
