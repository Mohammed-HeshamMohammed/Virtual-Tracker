// PLAN-customer-accounts-and-tenancy.md §11: "the highest-value test in the
// list" - a table can be forgotten, but it must not be forgotten QUIETLY.
// This never touches Postgres: it statically parses every
// `CREATE TABLE IF NOT EXISTS <name>` in ensure-lookup-schema.js and asserts
// each one appears in EXACTLY ONE of TENANT_SCOPED_TABLES / GLOBAL_TABLES
// (tenancy-tables.js) - the single source of truth that ensure-tenancy-
// schema.js and ensure-tenancy-rls.js both build from. A table added to the
// schema without being classified fails THIS test at review time, long
// before it could ever leak data in production.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  listTenantScopedTableNames,
  listGlobalTableNames,
  SINGLETON_KEY_TABLES,
} from "../src/lib/postgres/tenancy-tables.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaSource = readFileSync(
  path.join(here, "../src/lib/postgres/ensure-lookup-schema.js"),
  "utf8",
);

function tablesDefinedInSchema(source) {
  const names = new Set();
  const re = /CREATE TABLE IF NOT EXISTS (\w+)/g;
  let match;
  while ((match = re.exec(source))) names.add(match[1]);
  return names;
}

test("every table the schema creates is classified as tenant-scoped or global", () => {
  const definedTables = tablesDefinedInSchema(schemaSource);
  const scoped = new Set(listTenantScopedTableNames());
  const global = new Set(listGlobalTableNames());

  const unclassified = [...definedTables].filter((t) => !scoped.has(t) && !global.has(t));
  assert.deepEqual(
    unclassified,
    [],
    `These tables exist in ensure-lookup-schema.js but are not in TENANT_SCOPED_TABLES ` +
      `or GLOBAL_TABLES (tenancy-tables.js) - see PLAN-customer-accounts-and-tenancy.md §15.5: ${unclassified.join(", ")}`,
  );
});

test("no table is classified as both tenant-scoped and global", () => {
  const scoped = listTenantScopedTableNames();
  const global = new Set(listGlobalTableNames());
  const overlap = scoped.filter((t) => global.has(t));
  assert.deepEqual(overlap, []);
});

test("no table name is listed twice within TENANT_SCOPED_TABLES", () => {
  const scoped = listTenantScopedTableNames();
  const seen = new Set();
  const duplicates = scoped.filter((t) => (seen.has(t) ? true : (seen.add(t), false)));
  assert.deepEqual(duplicates, []);
});

test("classification does not name a table the schema never actually creates", () => {
  // Guards the other direction: a typo'd or renamed table sitting in
  // tenancy-tables.js after the real table was renamed elsewhere would
  // otherwise go unnoticed - it would just silently stop getting a
  // tenant_id column or an RLS policy would never be checked against it.
  const definedTables = tablesDefinedInSchema(schemaSource);
  const scoped = listTenantScopedTableNames();
  const global = listGlobalTableNames();
  const ghosts = [...scoped, ...global].filter((t) => !definedTables.has(t));
  assert.deepEqual(
    ghosts,
    [],
    `These are classified in tenancy-tables.js but no such CREATE TABLE exists: ${ghosts.join(", ")}`,
  );
});

test("every singleton-key table is also tenant-scoped", () => {
  // §15.3: these get a PK change on top of the ordinary tenant_id column,
  // not instead of it.
  const scoped = new Set(listTenantScopedTableNames());
  for (const { name } of SINGLETON_KEY_TABLES) {
    assert.equal(scoped.has(name), true, `${name} is a singleton-key table but missing from TENANT_SCOPED_TABLES`);
  }
});
