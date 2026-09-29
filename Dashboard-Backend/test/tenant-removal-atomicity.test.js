// PLAN-customer-accounts-and-tenancy.md §0.1 blocker 6: removeCustomerTenant
// used to delete the tenant row unconditionally even when a GCS blob delete
// failed, cascading away the activity_screenshots rows a retry would need -
// an unrecoverable orphan, not a retryable one. These pin the fix: the
// tenant row is deleted only once every archived blob is confirmed gone,
// and resumeStuckTenantRemovals can finish the job later, attributing the
// completion audit row to the original human actor (customer_account_audit.
// actor_id is NOT NULL, so an automatic resume cannot pass null).
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ tenants: Map<string, any>, screenshots: Array<any>, audit: Array<any> }} */
let db;
const gcsFailFor = new Set();

function reset() {
  db = { tenants: new Map(), screenshots: [], audit: [] };
  gcsFailFor.clear();
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

function seedTenant(overrides = {}) {
  db.tenants.set(TENANT, {
    id: TENANT,
    type: "customer",
    lifecycle: "live",
    email: "customer@example.com",
    granted_role: "Enterprise Manager",
    seat_limit: 5,
    period_start: new Date(),
    period_end: new Date(Date.now() + 86_400_000),
    created_at: new Date(),
    root_user_id: null,
    ...overrides,
  });
}

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    getPostgresPool: () => null,
    isPostgresConfigured: () => true,
    withTenant: async (_tenantId, fn) => fn(),
    // Minimal query router: enough SQL shape-matching for tenant.service.js
    // and audit.service.js (which shares this mock via the module cache).
    queryAsAdmin: async (sql, params = []) => {
      if (/^UPDATE tenants SET lifecycle = 'removing'/.test(sql)) {
        const t = db.tenants.get(params[0]);
        if (t) t.lifecycle = "removing";
        return [];
      }
      if (/^SELECT firebase_uid FROM members/.test(sql)) {
        return [];
      }
      if (/^SELECT id, screenshot_url FROM activity_screenshots/.test(sql)) {
        return db.screenshots.filter((s) => s.tenant_id === params[0]);
      }
      if (/^DELETE FROM tenants WHERE id = \$1/.test(sql)) {
        db.tenants.delete(params[0]);
        return [];
      }
      if (/^SELECT id FROM tenants WHERE lifecycle = 'removing'/.test(sql)) {
        return [...db.tenants.values()].filter((t) => t.lifecycle === "removing").map((t) => ({ id: t.id }));
      }
      if (/^SELECT\s+t\.id, t\.granted_role.*t\.root_user_id/s.test(sql)) {
        const t = db.tenants.get(params[0]);
        return t ? [{ ...t, email: t.email, active: t.lifecycle === "live" }] : [];
      }
      if (/^INSERT INTO customer_account_audit/.test(sql)) {
        db.audit.push({ tenant_id: params[0], actor_id: params[1], action: params[2], detail: params[3], created_at: new Date() });
        return [];
      }
      if (/^SELECT actor_id FROM customer_account_audit/.test(sql)) {
        const rows = db.audit
          .filter((a) => a.tenant_id === params[0] && a.action === "removal_requested")
          .sort((a, b) => b.created_at - a.created_at);
        return rows.length ? [{ actor_id: rows[0].actor_id }] : [];
      }
      throw new Error(`unexpected queryAsAdmin: ${sql}`);
    },
    withTransactionAsAdmin: async () => {
      throw new Error("withTransactionAsAdmin should not be called by removal");
    },
    // Not exercised by removal - present only because other modules in
    // tenant.service.js's import graph (e.g. lookup-availability.js, via
    // lookup-postgres.service.js) statically import these from client.js.
    query: async () => [],
    queryRaw: async () => ({ rows: [] }),
    withTransaction: async () => null,
  },
});

mock.module("../src/config/firebase.js", {
  namedExports: {
    getAuthAdmin: () => null,
    getDb: () => ({}),
    // presence-pubsub.js (transitively reachable) needs this export too -
    // §0.1b's own documented pitfall: an incomplete firebase.js mock here
    // throws a SyntaxError at import time, not a normal test failure.
    resolveFirebaseDatabaseUrl: () => "https://example.firebaseio.com",
    warnIfDatabaseUrlMismatch: () => {},
  },
});

mock.module("../src/lib/gcs/upload.js", {
  namedExports: {
    deleteFromGCS: async (url) => {
      if (gcsFailFor.has(url)) throw new Error(`GCS delete failed for ${url}`);
    },
  },
});

const { removeCustomerTenant, resumeStuckTenantRemovals } = await import(
  "../src/modules/customer-accounts/tenant.service.js"
);

test.beforeEach(() => reset());

test("a clean removal (no archived screenshots) deletes the tenant and records 'removed'", async () => {
  seedTenant();
  const result = await removeCustomerTenant(TENANT, ACTOR, { confirmEmail: "customer@example.com" });
  assert.deepEqual(result, { removed: true });
  assert.equal(db.tenants.has(TENANT), false);
  const actions = db.audit.filter((a) => a.tenant_id === TENANT).map((a) => a.action);
  assert.deepEqual(actions, ["removal_requested", "removed"]);
});

test("a GCS delete failure leaves the tenant locked (lifecycle 'removing'), not deleted", async () => {
  seedTenant();
  db.screenshots.push({ id: "s1", tenant_id: TENANT, screenshot_url: "gs://bucket/s1.png" });
  gcsFailFor.add("gs://bucket/s1.png");

  const result = await removeCustomerTenant(TENANT, ACTOR, { confirmEmail: "customer@example.com" });
  assert.deepEqual(result, { removed: false, retrying: true });
  assert.equal(db.tenants.has(TENANT), true, "the tenant row must survive a GCS failure");
  assert.equal(db.tenants.get(TENANT).lifecycle, "removing");
  const actions = db.audit.filter((a) => a.tenant_id === TENANT).map((a) => a.action);
  assert.deepEqual(actions, ["removal_requested"], "no 'removed' row until the delete actually completes");
});

test("resumeStuckTenantRemovals completes a stuck removal and attributes it to the original actor", async () => {
  seedTenant();
  db.screenshots.push({ id: "s1", tenant_id: TENANT, screenshot_url: "gs://bucket/s1.png" });
  gcsFailFor.add("gs://bucket/s1.png");
  await removeCustomerTenant(TENANT, ACTOR, { confirmEmail: "customer@example.com" });
  assert.equal(db.tenants.has(TENANT), true, "sanity: still stuck before resume");

  gcsFailFor.delete("gs://bucket/s1.png"); // GCS is healthy again
  const results = await resumeStuckTenantRemovals();

  assert.deepEqual(results, [{ tenantId: TENANT, completed: true }]);
  assert.equal(db.tenants.has(TENANT), false, "resume must finish the deletion");
  const removedRow = db.audit.find((a) => a.tenant_id === TENANT && a.action === "removed");
  assert.ok(removedRow, "a 'removed' row must exist");
  assert.equal(removedRow.actor_id, ACTOR, "must attribute to the original human actor, not a null/system actor");
});

test("resumeStuckTenantRemovals is a no-op when nothing is stuck", async () => {
  seedTenant();
  const results = await resumeStuckTenantRemovals();
  assert.deepEqual(results, []);
  assert.equal(db.tenants.has(TENANT), true, "an untouched live tenant must be left alone");
});

test("a mismatched confirmation email is rejected before the tenant is ever locked out", async () => {
  seedTenant();
  await assert.rejects(
    () => removeCustomerTenant(TENANT, ACTOR, { confirmEmail: "wrong@example.com" }),
    /CONFIRM_EMAIL_MISMATCH|Type the customer's exact email/,
  );
  assert.equal(db.tenants.get(TENANT).lifecycle, "live", "must not lock out on a failed confirmation");
  assert.equal(db.audit.filter((a) => a.tenant_id === TENANT).length, 0);
});
