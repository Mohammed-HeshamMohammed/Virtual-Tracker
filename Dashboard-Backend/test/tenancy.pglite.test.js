// Customer accounts kept apart with tenancy enforced: seat counting and the seat guard, sign-in
// for a member of a customer account, and which tenant a new row lands in. Run against a real
// Postgres (PGlite) with the real row-level security policies, app queries running as vt_app with
// the request's tenant published.
//
// Replaces source-text and SQL-text checks in seat-usage, session-bootstrap-tenant-lookup and
// tenancy-write-ownership. Skips itself when PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, request, loadPglite } from "./helpers/pglite.js";
import { fakeAuth, fakeFirestore } from "./helpers/firebase-fakes.js";

if (!(await loadPglite())) {
  test("tenancy against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  // Warnings are kept, so a step that failed and was quietly retried still shows.
  const warnings = [];
  const { sanitizeErrorMessage, formatErrorForLog, redactUnknown } = await import(srcUrl("http/sanitize-error.js"));
  const pg = await startPglite({
    rls: true,
    mocks: {
      "http/sanitize-error.js": {
        sanitizeErrorMessage, formatErrorForLog, redactUnknown,
        logSafeWarn: (context) => warnings.push(String(context)),
        logSafeError: (context) => warnings.push(String(context)),
      },
    },
  });
  after(() => pg.close());
  const { insert, member } = seeder(pg);
  const auth = fakeAuth();
  const firebase = await import(srcUrl("config/firebase.js"));
  const firestore = fakeFirestore();
  firebase.__setTestDb(firestore);
  firebase.__setTestAuth(auth);

  const seats = await import(srcUrl("modules/customer-accounts/seat-usage.service.js"));
  const { withTenant, query } = await import(srcUrl("lib/postgres/client.js"));
  const { handleSessionBootstrap } = await import(srcUrl("modules/auth/session-bootstrap.js"));
  const { authenticateRequest } = await import(srcUrl("http/auth-middleware.js"));
  const { getAuthContext } = await import(srcUrl("http/auth-context.js"));
  const { createClientPg } = await import(srcUrl("lib/postgres/clients-postgres.service.js"));

  let n = 0;
  const tenant = async (seatLimit) => {
    const id = `dddddddd-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    await insert("tenants", { id, type: "customer", granted_role: "Enterprise Manager", seat_limit: seatLimit });
    return id;
  };

  test("used seats count active members, pending invites and pre-provisioned accounts of that account only", async () => {
    const t = await tenant(10);
    const other = await tenant(10);
    await member("Employee", { tenant_id: t });
    await member("Employee", { tenant_id: t });
    await member("Employee", { tenant_id: t, status: "inactive" });
    await member("Employee", { tenant_id: other });
    await insert("invites", { invite_token: `a-${t}`, status: "pending_signup", tenant_id: t });
    await insert("invites", { invite_token: `b-${t}`, status: "completed", tenant_id: t });
    await insert("pending_auth_members", { firebase_uid: `pending-${t}`, tenant_id: t });
    const usage = await seats.getTenantSeatUsage(t);
    assert.deepEqual(usage, { seatLimit: 10, seatsUsed: 4, seatsOpen: 6, unlimited: false });
  });

  test("the guard works on the tenant-scoped identity, inserting while it holds the account's seat lock", async () => {
    const t = await tenant(2);
    await member("Employee", { tenant_id: t });
    // The app identity has no access to the tenants table itself.
    await assert.rejects(withTenant(t, () => query("SELECT seat_limit FROM tenants")), /permission denied/);
    let lockedDuringInsert = null;
    await withTenant(t, () =>
      seats.withSeatsAvailable(t, 1, {
        insert: async (client) => {
          const locks = await client.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted");
          lockedDuringInsert = locks.rows[0].n > 0;
          await client.query("INSERT INTO invites (invite_token, status, tenant_id) VALUES ($1, 'pending_signup', $2)", [`g-${t}`, t]);
        },
      }),
    );
    assert.equal(lockedDuringInsert, true);
    assert.equal((await seats.getTenantSeatUsage(t)).seatsUsed, 2);
  });

  test("a request that does not fit is refused whole, before anything is inserted", async () => {
    const t = await tenant(3);
    await member("Employee", { tenant_id: t });
    let inserted = false;
    await assert.rejects(
      withTenant(t, () => seats.withSeatsAvailable(t, 3, { insert: async () => { inserted = true; } })),
      (e) => e instanceof seats.SeatLimitError && e.status === 409 && /Only 2 of 3 seats are open/.test(e.message),
    );
    assert.equal(inserted, false);
  });

  test("a public request with no tenant of its own is counted under the account it names", async () => {
    const t = await tenant(1);
    await member("Employee", { tenant_id: t });
    // No tenant published: the guard has to switch to `t` itself, or it would count nothing.
    await assert.rejects(seats.withSeatsAvailable(t, 1), /All 1 seats are in use/);
  });

  test("the seat limit is set through the owner identity and cannot go below what is in use", async () => {
    const t = await tenant(5);
    await member("Employee", { tenant_id: t });
    await member("Employee", { tenant_id: t });
    await withTenant(t, async () => {
      await assert.rejects(seats.setTenantSeatLimit(t, 1), (e) => e.status === 409);
      assert.deepEqual(await seats.setTenantSeatLimit(t, 3), { from: 5, to: 3 });
    });
    assert.equal((await pg.rows("SELECT seat_limit FROM tenants WHERE id = $1", [t]))[0].seat_limit, 3);
  });

  test("a customer account's member signs in to their own member record", async () => {
    const t = await tenant(10);
    const m = await member("Employee", { tenant_id: t, firebase_uid: "uid-cust-1", work_email: "cust1@example.test", first_name: "Cus" });
    const token = auth.seedUser("uid-cust-1", { email: "cust1@example.test", displayName: "Cus Tomer" });
    const before = (await pg.rows("SELECT count(*)::int AS n FROM members"))[0].n;
    const res = await request(
      { method: "POST", path: "/api/auth/session-bootstrap", headers: { authorization: `Bearer ${token}` }, body: {} },
      (req, res, url) => handleSessionBootstrap(req, res, undefined, url),
    );
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(JSON.stringify(res.body).includes(m.id), true, "the response names the existing member");
    assert.equal((await pg.rows("SELECT count(*)::int AS n FROM members"))[0].n, before, "no second member was created");
    assert.deepEqual(warnings.filter((w) => w.includes("session-bootstrap")), [], "it worked first time, not on a retry");
  });

  test("a sign-in that fails once and is retried still lands in the member's own record", async () => {
    const t = await tenant(10);
    const m = await member("Employee", { tenant_id: t, firebase_uid: "uid-cust-3", work_email: "cust3@example.test" });
    const token = auth.seedUser("uid-cust-3", { email: "cust3@example.test" });
    const before = (await pg.rows("SELECT count(*)::int AS n FROM members"))[0].n;
    firestore.control.failWrites = 1;
    const res = await request(
      { method: "POST", path: "/api/auth/session-bootstrap", headers: { authorization: `Bearer ${token}` }, body: {} },
      (req, res, url) => handleSessionBootstrap(req, res, undefined, url),
    );
    assert.equal(firestore.control.failWrites, 0, "the first attempt did hit the failure");
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(JSON.stringify(res.body).includes(m.id), true);
    assert.equal((await pg.rows("SELECT count(*)::int AS n FROM members"))[0].n, before);
  });

  test("a sign-in resolves to the account of its member, or of its pending sign-up, or else the main one", async () => {
    const { resolveTenantIdForFirebaseUid, __clearTenantResolutionCacheForTests } = await import(srcUrl("lib/postgres/tenant-resolution.js"));
    const { MAIN_TENANT_ID } = await import(srcUrl("lib/postgres/ensure-tenancy-schema.js"));
    __clearTenantResolutionCacheForTests();
    const t = await tenant(10);
    const u = await tenant(10);
    await member("Employee", { tenant_id: t, firebase_uid: "uid-res-member" });
    await insert("pending_auth_members", { firebase_uid: "uid-res-pending", tenant_id: u });
    // Called before any account is known, so it must not depend on one being published.
    assert.equal(await resolveTenantIdForFirebaseUid("uid-res-member"), t);
    assert.equal(await resolveTenantIdForFirebaseUid("uid-res-pending"), u);
    assert.equal(await resolveTenantIdForFirebaseUid("uid-nobody"), MAIN_TENANT_ID);
  });

  test("every request from that member is scoped to their account before the member is looked up", async () => {
    const t = await tenant(10);
    const m = await member("Manager", { tenant_id: t, firebase_uid: "uid-cust-2", work_email: "cust2@example.test" });
    const token = auth.seedUser("uid-cust-2", { email: "cust2@example.test" });
    const res = await request(
      { method: "GET", path: "/api/members", headers: { authorization: `Bearer ${token}` } },
      async (req, _res, url) => {
        await authenticateRequest(req, url, firebase.getDb());
        return getAuthContext(req);
      },
    );
    assert.equal(res.handled?.memberId, m.id);
    assert.equal(res.handled?.tenantId, t);
  });

  test("a new row lands in the request's account, whether the code names it or leaves it to the column default", async () => {
    const t = await tenant(10);
    const named = await withTenant(t, () => createClientPg({ name: "Named" }));
    assert.equal(named.tenant_id, t);
    const viaDefault = await withTenant(t, () => query("INSERT INTO teams (name) VALUES ('Team') RETURNING tenant_id"));
    assert.equal(viaDefault[0].tenant_id, t);
  });

  test("a row naming another account, or written with no account at all, is refused rather than misfiled", async () => {
    const t = await tenant(10);
    const other = await tenant(10);
    await assert.rejects(withTenant(t, () => createClientPg({ name: "Elsewhere", tenantId: other })), /row-level security/);
    await assert.rejects(createClientPg({ name: "Nowhere" }), /row-level security/);
    const rows = await pg.rows("SELECT name FROM clients WHERE name IN ('Elsewhere', 'Nowhere')");
    assert.deepEqual(rows, []);
  });

}
