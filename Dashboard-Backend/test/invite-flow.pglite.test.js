// Invites end to end: creating them (bulk, single, open link, pre-provision) and accepting one
// (public register), run through the real route handlers against a real Postgres (PGlite) built
// from the boot schema. Firebase Auth and the profile store are in-memory fakes. Row-level
// security is off here, as it is in production until tenancy enforcement is switched on; the
// token lookup under RLS is in invite-token-rls.pglite.test.js.
//
// Replaces source-text checks that only proved the handlers were written in a certain order:
// invite-tree-parent, invite-register-root-user-id and invite-token-tenant-lookup.
// Skips itself when PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, request, loadPglite } from "./helpers/pglite.js";
import { fakeAuth, fakeFirestore } from "./helpers/firebase-fakes.js";

if (!(await loadPglite())) {
  test("invite flow against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  // Phone numbers and passwords are checked by other services (Notify, Auth-Backend); stand-ins
  // accept what those would accept here.
  const pg = await startPglite({
    mocks: {
      "lib/notify/phone-validation-client.js": { validatePhoneViaNotify: async (phone) => phone.trim() },
      "lib/auth/auth-backend-client.js": { validatePasswordViaAuthBackend: async () => ({ valid: true, error: null }) },
    },
  });
  after(() => pg.close());
  const { insert, member, role } = seeder(pg);

  const firestore = fakeFirestore();
  const auth = fakeAuth();
  const firebase = await import(srcUrl("config/firebase.js"));
  firebase.__setTestDb(firestore);
  firebase.__setTestAuth(auth);

  const { routeMemberInvites } = await import(srcUrl("modules/members/routes/member-invites.routes.js"));
  const { routeCompatibility } = await import(srcUrl("modules/compat/routes.js"));
  const { routeMemberMigration } = await import(srcUrl("modules/members/routes/member-migration.routes.js"));
  const { MAIN_TENANT_ID } = await import(srcUrl("lib/postgres/ensure-tenancy-schema.js"));

  const CUSTOMER = "cccccccc-0000-4000-8000-000000000001";
  await insert("tenants", { id: CUSTOMER, type: "customer", granted_role: "Enterprise Manager", seat_limit: 5 });

  // Main organisation: the Owner, a Manager and an Employee who both report to the Owner, a client.
  const owner = await member("Owner", { first_name: "Olive", firebase_uid: "uid-owner" });
  const manager = await member("Manager", { first_name: "Mia", firebase_uid: "uid-manager" });
  const employee = await member("Employee", { first_name: "Eve" });
  const client = await member("Client", { first_name: "Cleo" });
  await insert("member_relationships", { parent_member_id: owner.id, child_member_id: manager.id });
  await insert("member_relationships", { parent_member_id: owner.id, child_member_id: employee.id });
  // A manager inside the customer account.
  const custAdmin = await member("Manager", { first_name: "Cara", firebase_uid: "uid-cust", tenant_id: CUSTOMER });

  const as = (m, tenantId = MAIN_TENANT_ID) => ({
    memberId: m.id, uid: m.firebase_uid ?? `uid-${m.id}`, roleName: m.roleName, tenantId,
  });
  owner.roleName = "Owner";
  manager.roleName = "Manager";
  custAdmin.roleName = "Manager";

  const compat = (viewer, path, body) =>
    request({ method: "POST", path, viewer, body }, (req, res, url) => routeCompatibility(req, res, url, firestore, undefined));
  const invites = (viewer, method, path, body) =>
    request({ method, path, viewer, body }, (req, res, url) => routeMemberInvites(req, res, url, undefined));
  const inviteRows = (where = "true", params = []) => pg.rows(`SELECT * FROM invites WHERE ${where} ORDER BY sent_at`, params);

  let phone = 100;
  const register = (token, email, extra = {}) =>
    invites(null, "POST", `/api/public/invites/${token}/register`, {
      email, password: "Str0ng!Passw0rd#2026", confirmPassword: "Str0ng!Passw0rd#2026",
      firstName: "New", lastName: "Person", phone: `+2010000${String(++phone).padStart(5, "0")}`, ...extra,
    });
  const parentOf = async (memberId) =>
    (await pg.rows("SELECT parent_member_id FROM member_relationships WHERE child_member_id = $1", [memberId]))
      .map((r) => r.parent_member_id);
  const memberByEmail = async (email) => (await pg.rows("SELECT * FROM members WHERE work_email = $1", [email]))[0];

  const bulk = (viewer, body) => compat(viewer, "/api/invites/bulk", { inviteKind: "open_link", role: "Employee", rows: [{}], ...body });

  test("a bulk invite placed under a member the inviter manages stores that parent", async () => {
    const res = await bulk(as(owner), { treeParentMemberId: manager.id });
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    const [row] = await inviteRows("id = $1", [res.body.data[0].id]);
    assert.equal(row.tree_parent_member_id, manager.id);
    assert.equal(row.tenant_id, MAIN_TENANT_ID);
  });

  test("a bulk invite under someone outside the inviter's reach is refused and stores nothing", async () => {
    const before = (await inviteRows()).length;
    const res = await bulk(as(manager), { treeParentMemberId: employee.id });
    assert.equal(res.statusCode, 403);
    assert.equal((await inviteRows()).length, before);
  });

  test("a client can never be the parent", async () => {
    const res = await bulk(as(owner), { treeParentMemberId: client.id });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Clients cannot/);
  });

  test("accepting the invite places the new member under the stored parent", async () => {
    const res = await bulk(as(owner), { treeParentMemberId: manager.id });
    const token = res.body.data[0].invite_token ?? res.body.data[0].inviteToken;
    const reg = await register(token, "placed@example.test");
    assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));
    const joined = await memberByEmail("placed@example.test");
    assert.deepEqual(await parentOf(joined.id), [manager.id]);
    const [row] = await inviteRows("invite_token = $1", [token]);
    assert.equal(row.status, "completed");
  });

  test("if the chosen parent has left by then, the new member goes under the inviter", async () => {
    const leaver = await member("Manager", { first_name: "Leo" });
    await insert("member_relationships", { parent_member_id: owner.id, child_member_id: leaver.id });
    const res = await bulk(as(owner), { treeParentMemberId: leaver.id });
    const token = res.body.data[0].invite_token ?? res.body.data[0].inviteToken;
    await pg.rows("UPDATE members SET status = 'inactive' WHERE id = $1", [leaver.id]);
    assert.equal((await register(token, "fallback@example.test")).statusCode, 201);
    assert.deepEqual(await parentOf((await memberByEmail("fallback@example.test")).id), [owner.id]);
  });

  test("every invite a customer account creates belongs to that account", async () => {
    const viewer = as(custAdmin, CUSTOMER);
    const single = await compat(viewer, "/api/invites", { email: "single@example.test" });
    assert.equal(single.statusCode, 201, JSON.stringify(single.body));
    const many = await bulk(viewer, {});
    assert.equal(many.statusCode, 201, JSON.stringify(many.body));
    const link = await invites(viewer, "POST", "/api/invites/open-link", { role: "Employee" });
    assert.equal(link.statusCode, 201, JSON.stringify(link.body));
    const pre = await invites(viewer, "POST", "/api/members/preprovision", { name: "Pre Person", email: "pre@example.test", role: "Employee" });
    assert.equal(pre.statusCode, 201, JSON.stringify(pre.body));

    const ids = [single.body.data.id, many.body.data[0].id, link.body.data.id];
    const rows = await inviteRows("id = ANY($1::uuid[])", [ids]);
    assert.deepEqual(rows.map((r) => r.tenant_id), [CUSTOMER, CUSTOMER, CUSTOMER]);
    const [pending] = await pg.rows("SELECT tenant_id FROM pending_auth_members WHERE email = 'pre@example.test'");
    assert.equal(pending.tenant_id, CUSTOMER);
  });

  test("an invite that would go past the account's seat limit is refused before anything is created", async () => {
    // The limit is 5: the manager plus the three pending invites and one pre-provisioned
    // account from the test above already fill it.
    const viewer = as(custAdmin, CUSTOMER);
    const before = (await inviteRows()).length;
    const res = await invites(viewer, "POST", "/api/invites/open-link", { role: "Employee" });
    assert.equal(res.statusCode >= 400 && res.statusCode < 500, true, String(res.statusCode));
    assert.equal((await inviteRows()).length, before);
    for (const res of [await compat(viewer, "/api/invites", { email: "over@example.test" }), await bulk(viewer, {})]) {
      assert.equal(res.statusCode >= 400 && res.statusCode < 500, true, String(res.statusCode));
    }
    assert.equal((await inviteRows()).length, before);
    const pre = await invites(viewer, "POST", "/api/members/preprovision", { name: "Too Many", email: "toomany@example.test", role: "Employee" });
    assert.equal(pre.statusCode >= 400 && pre.statusCode < 500, true, String(pre.statusCode));
    assert.equal(auth.users.size, [...auth.users.values()].filter((u) => u.email !== "toomany@example.test").length, "no sign-in account was created");
  });

  test("a sign-in account migrated in by a customer account's admin joins that account", async () => {
    await pg.rows("UPDATE tenants SET seat_limit = 50 WHERE id = $1", [CUSTOMER]);
    const custOrgAdmin = await member("Admin", { first_name: "Ada", firebase_uid: "uid-cust-admin", tenant_id: CUSTOMER });
    custOrgAdmin.roleName = "Admin";
    const user = await auth.createUser({ email: "migrated@example.test", displayName: "Mig Rated" });
    const res = await request(
      { method: "POST", path: "/api/members/migrate", viewer: as(custOrgAdmin, CUSTOMER), body: { migrations: [{ uid: user.uid, role: "Employee" }] } },
      (req, res, url) => routeMemberMigration(req, res, url, undefined),
    );
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const migrated = await pg.rows("SELECT tenant_id FROM members WHERE firebase_uid = $1", [user.uid]);
    assert.deepEqual(migrated.map((m) => m.tenant_id), [CUSTOMER]);
  });

  test("someone joining through a customer account's link becomes a member of that account", async () => {
    const [inv] = await inviteRows("invite_kind = 'open_link' AND tenant_id = $1", [CUSTOMER]);
    const reg = await register(inv.invite_token, "joiner@example.test");
    assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));
    const joined = await memberByEmail("joiner@example.test");
    assert.equal(joined.tenant_id, CUSTOMER);
    const [after] = await inviteRows("id = $1", [inv.id]);
    assert.equal(after.status, "completed");
    assert.equal(after.use_count, 1);
  });

  test("the first Enterprise member to join a customer account becomes its root user; a second does not replace them", async () => {
    const roleId = await role("Enterprise Manager");
    const seedInvite = async (email) =>
      insert("invites", {
        email, invite_token: `tok-${email.replace(/\W/g, "")}-0123456789abcdef`, invite_kind: "email",
        role_id: roleId, status: "pending_signup", created_by_uid: "uid-owner", tenant_id: CUSTOMER,
      });
    const fresh = "cccccccc-0000-4000-8000-000000000002";
    await insert("tenants", { id: fresh, type: "customer", granted_role: "Enterprise Manager", seat_limit: 5 });
    const first = await seedInvite("root1@example.test");
    const second = await seedInvite("root2@example.test");
    await pg.rows("UPDATE invites SET tenant_id = $1 WHERE id = ANY($2::uuid[])", [fresh, [first.id, second.id]]);

    assert.equal((await register(first.invite_token, "root1@example.test")).statusCode, 201);
    const root = await memberByEmail("root1@example.test");
    const [t1] = await pg.rows("SELECT root_user_id FROM tenants WHERE id = $1", [fresh]);
    assert.equal(t1.root_user_id, root.id);

    assert.equal((await register(second.invite_token, "root2@example.test")).statusCode, 201);
    const [t2] = await pg.rows("SELECT root_user_id FROM tenants WHERE id = $1", [fresh]);
    assert.equal(t2.root_user_id, root.id);
  });

  test("an Employee joining a customer account does not become its root user", async () => {
    const [t] = await pg.rows("SELECT root_user_id FROM tenants WHERE id = $1", [CUSTOMER]);
    assert.equal(t.root_user_id, null, "the joiner above was an Employee");
  });
}
