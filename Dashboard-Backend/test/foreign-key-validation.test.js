// Guards validateForeignKeys after the last per-field Firestore fallback was
// removed. That fallback ran whenever the Postgres readiness checks returned
// false, and checked db.collection(collection).doc(value) - collections that
// stopped receiving writes at each domain's cutover, so it either rejected
// valid references or validated nothing at all. Every FK now resolves against
// Postgres, and an unmapped field fails loudly instead of skipping the check.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ existingIds: Set<string>, lookupIds: Set<string>, queries: string[] }} */
const stub = { existingIds: new Set(), lookupIds: new Set(), queries: [] };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      stub.queries.push(sql);
      if (sql.includes("FROM roles WHERE id = $1")) {
        return stub.lookupIds.has(String(params[0])) ? [{ "?column?": 1 }] : [];
      }
      if (/SELECT 1 FROM \w+ WHERE id = \$1/.test(sql)) {
        return stub.existingIds.has(String(params[0])) ? [{ "?column?": 1 }] : [];
      }
      if (sql.includes("FROM lookup_tables")) {
        return stub.lookupIds.has(String(params[0])) ? [{ "?column?": 1 }] : [];
      }
      if (sql.includes("FROM team_projects")) return [{ "?column?": 1 }];
      throw new Error(`unexpected query: ${sql}`);
    },
    isPostgresConfigured: () => true,
    withTransaction: async (fn) => fn({ query: async () => [] }),
    getPostgresPool: () => null,
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
  },
});

const { validateForeignKeys } = await import("../src/modules/schema/services/schema-crud.service.js");

// Any access to this proves a Firestore read snuck back into FK validation.
const db = {
  collection() {
    throw new Error("Firestore must not be consulted for foreign keys");
  },
};

function reset() {
  stub.existingIds = new Set();
  stub.lookupIds = new Set();
  stub.queries = [];
}

test("an entity FK resolves against Postgres, never Firestore", async () => {
  reset();
  stub.existingIds.add("m1");
  await validateForeignKeys(db, { member_id: "m1" }, { entityKey: "employment" });
  assert.ok(stub.queries.some((sql) => sql.includes("FROM members")));
});

test("a missing entity FK is rejected", async () => {
  reset();
  await assert.rejects(
    () => validateForeignKeys(db, { project_id: "p-gone" }, { entityKey: "tasks" }),
    /project_id references missing/,
  );
});

test("a lookup FK resolves through the lookup table with no readiness gate", async () => {
  reset();
  stub.lookupIds.add("r1");
  await validateForeignKeys(db, { role_id: "r1" }, { entityKey: "members" });
  await assert.rejects(
    () => validateForeignKeys(db, { role_id: "r-gone" }, { entityKey: "members" }),
    /role_id references missing roles/,
  );
});

test("every FK field in the catalog has a table mapping", async () => {
  reset();
  const { foreignKeyCollectionByField } = await import("../src/modules/schema/catalog/index.js");
  for (const field of Object.keys(foreignKeyCollectionByField)) {
    stub.existingIds.add("x1");
    stub.lookupIds.add("x1");
    // No mapping would throw "has no foreign-key table mapping" instead.
    await validateForeignKeys(db, { [field]: "x1" }, { entityKey: "members" });
  }
});
