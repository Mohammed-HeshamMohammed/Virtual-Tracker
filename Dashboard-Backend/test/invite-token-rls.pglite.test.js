// An invite link is opened by someone not signed in, so the request carries no tenant - and once
// tenancy is enforced, an ordinary query with no tenant published sees no invites at all. The
// token has to be resolved to its tenant first (a narrow admin lookup), then read in that tenant.
//
// Runs the public invite routes against a real Postgres (PGlite) with the real row-level security
// policies applied and app queries running as vt_app. Replaces source-text checks in
// invite-token-tenant-lookup.test.js. Skips itself when PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, request, loadPglite } from "./helpers/pglite.js";
import { fakeAuth, fakeFirestore } from "./helpers/firebase-fakes.js";

if (!(await loadPglite())) {
  test("invite token lookup under RLS (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite({
    rls: true,
    mocks: {
      "lib/notify/phone-validation-client.js": { validatePhoneViaNotify: async (phone) => phone.trim() },
      "lib/auth/auth-backend-client.js": { validatePasswordViaAuthBackend: async () => ({ valid: true, error: null }) },
    },
  });
  after(() => pg.close());
  const { insert, role } = seeder(pg);
  const firebase = await import(srcUrl("config/firebase.js"));
  firebase.__setTestDb(fakeFirestore());
  firebase.__setTestAuth(fakeAuth());
  const { routeMemberInvites } = await import(srcUrl("modules/members/routes/member-invites.routes.js"));
  const { query } = await import(srcUrl("lib/postgres/client.js"));

  const CUSTOMER = "cccccccc-0000-4000-8000-0000000000aa";
  await insert("tenants", { id: CUSTOMER, type: "customer", granted_role: "Enterprise Manager", seat_limit: 10 });
  const token = "customer-invite-token-0123456789";
  await insert("invites", {
    email: "new@example.test", invite_token: token, invite_kind: "email", role_id: await role("Employee"),
    status: "pending_signup", tenant_id: CUSTOMER,
  });

  const publicCall = (method, path, body) =>
    request({ method, path, body }, (req, res, url) => routeMemberInvites(req, res, url, undefined));

  test("the harness enforces it: with no tenant published an ordinary query sees no invites", async () => {
    assert.deepEqual(await query("SELECT id FROM invites"), []);
  });

  test("opening a customer account's invite link finds the invite and its role", async () => {
    const res = await publicCall("GET", `/api/public/invites/${token}`);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.invite.email, "new@example.test");
    assert.equal(res.body.invite.roleName, "Employee");
  });

  test("an unknown token is not found", async () => {
    const res = await publicCall("GET", "/api/public/invites/no-such-token-0123456789abcdef");
    assert.equal(res.statusCode, 404);
  });

  test(
    "registering through it completes under enforced tenancy",
    { todo: "fails today: after the invite lookup the request has no tenant, so writing the pay rate breaks RLS (pay_rates)" },
    async () => {
      const res = await publicCall("POST", `/api/public/invites/${token}/register`, {
        email: "new@example.test", password: "Str0ng!Passw0rd#2026", confirmPassword: "Str0ng!Passw0rd#2026",
        firstName: "New", lastName: "Person", phone: "+201000000001",
      });
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    },
  );
}
