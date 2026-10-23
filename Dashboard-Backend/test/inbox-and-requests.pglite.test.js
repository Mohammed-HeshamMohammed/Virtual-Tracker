// Things a member asks for or receives, checked on real rows: the notification bell's read and
// clear actions, closing an invite once its person has joined, screenshot removal requests, and a
// buzz. Run against a real Postgres (PGlite) built from the boot schema.
//
// Replaces the SQL-text assertions in notifications-management, invite-completion,
// screenshot-removal-requests and buzz. Skips itself when PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, request, loadPglite } from "./helpers/pglite.js";

if (!(await loadPglite())) {
  test("inbox and requests against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pushed = [];
  const gateway = await import(srcUrl("modules/presence/presence-gateway.js"));
  const pg = await startPglite({
    mocks: {
      // The tracker's live connection is not part of this test; record what would be pushed.
      "modules/presence/presence-gateway.js": {
        ...gateway,
        pushToTracker: (memberId, message) => {
          pushed.push({ memberId, message });
          return true;
        },
      },
    },
  });
  after(() => pg.close());
  const { insert, member } = seeder(pg);
  const { withTenant } = await import(srcUrl("lib/postgres/client.js"));
  const { MAIN_TENANT_ID } = await import(srcUrl("lib/postgres/ensure-tenancy-schema.js"));
  const { routeNotifications } = await import(srcUrl("modules/notifications/routes.js"));
  const completion = await import(srcUrl("modules/members/services/invite-completion.js"));
  const removal = await import(srcUrl("modules/activity/screenshot-removal.service.js"));
  const { sendBuzz } = await import(srcUrl("modules/messages/buzz.js"));

  const OTHER = "ffffffff-0000-4000-8000-000000000001";
  await insert("tenants", { id: OTHER, type: "customer", granted_role: "Enterprise Manager", seat_limit: 10 });
  const inMain = (fn) => withTenant(MAIN_TENANT_ID, fn);

  // ── the bell ─────────────────────────────────────────────────────────────
  const ann = await member("Employee", { first_name: "Ann" });
  const bob = await member("Employee", { first_name: "Bob" });
  const note = (m, read) => insert("notifications", { recipient_id: m.id, title: "t", message: "m", read });
  const bell = (method, path, body) =>
    request({ method, path, viewer: { memberId: ann.id, roleName: "Employee" }, body }, (req, res, url) =>
      routeNotifications(req, res, url, undefined),
    );
  const idsOf = async (m) => (await pg.rows("SELECT id, read FROM notifications WHERE recipient_id = $1 ORDER BY id", [m.id]));

  test("clearing the read ones removes only the member's own read notifications", async () => {
    const keep = await note(ann, false);
    await note(ann, true);
    const bobs = await note(bob, true);
    const res = await bell("POST", "/api/notifications/clear", { readOnly: true });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual((await idsOf(ann)).map((r) => r.id), [keep.id]);
    assert.ok((await idsOf(bob)).some((r) => r.id === bobs.id), "another member's are untouched");
  });

  test("clearing by id clears only the member's own, and ignores ids that are not", async () => {
    const mine = await note(ann, false);
    const theirs = await note(bob, false);
    const res = await bell("POST", "/api/notifications/clear", { ids: [mine.id, theirs.id, "not-an-id", mine.id.toUpperCase()] });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.cleared, 1);
    assert.equal((await idsOf(ann)).some((r) => r.id === mine.id), false);
    assert.ok((await idsOf(bob)).some((r) => r.id === theirs.id));
  });

  test("marking several read touches only the member's unread ones", async () => {
    const unread = await note(ann, false);
    const already = await note(ann, true);
    const theirs = await note(bob, false);
    const res = await bell("POST", "/api/notifications/read", { ids: [unread.id, already.id, theirs.id] });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.updated, 1);
    assert.equal((await pg.rows("SELECT read FROM notifications WHERE id = $1", [unread.id]))[0].read, true);
    assert.equal((await pg.rows("SELECT read FROM notifications WHERE id = $1", [theirs.id]))[0].read, false);
  });

  test("clearing everything clears all of the member's own and nobody else's", async () => {
    await note(ann, false);
    await note(ann, true);
    const theirs = await note(bob, false);
    const res = await bell("POST", "/api/notifications/clear", { all: true });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(await idsOf(ann), []);
    assert.ok((await idsOf(bob)).some((r) => r.id === theirs.id));
  });

  // ── invites closing once their person joins ───────────────────────────────
  const invite = (row) => insert("invites", { invite_token: `tok-${Math.random().toString(36).slice(2)}`, status: "pending_signup", ...row });
  const statusOf = async (inv) => (await pg.rows("SELECT status FROM invites WHERE id = $1", [inv.id]))[0].status;

  test("the pending invite for an address is found whatever its case, in that account only, skipping an expired one", async () => {
    const live = await invite({ email: "dave@example.test", sent_at: "2026-09-01T00:00:00Z" });
    // The newest one has expired, so it is passed over.
    await invite({ email: "dave@example.test", sent_at: "2026-09-02T00:00:00Z", expires_at: "2026-09-03T00:00:00Z" });
    await invite({ email: "dave@example.test", tenant_id: OTHER });
    const found = await completion.findPendingInviteForEmail("  Dave@Example.TEST ", { tenantId: MAIN_TENANT_ID });
    assert.equal(found.id, live.id);
    assert.equal(await completion.findPendingInviteForEmail("nobody@example.test", { tenantId: MAIN_TENANT_ID }), null);
  });

  test("joining closes only the pending email invites for that address", async () => {
    const email = await invite({ email: "joined@example.test" });
    const shareLink = await invite({ email: "joined@example.test", invite_kind: "open_link" });
    const someoneElse = await invite({ email: "waiting@example.test" });
    const closed = await completion.completeInvitesForJoinedMember({ email: "Joined@Example.test", uid: "uid-joined", tenantId: MAIN_TENANT_ID });
    assert.equal(closed, 1);
    assert.equal(await statusOf(email), "completed");
    assert.equal(await statusOf(shareLink), "pending_signup", "a share link is never closed by one sign-in");
    assert.equal(await statusOf(someoneElse), "pending_signup");
  });

  test("the invite list hides and closes the invite of someone who already joined, and only an active member counts", async () => {
    await member("Employee", { work_email: "here@example.test" });
    await member("Employee", { work_email: "gone@example.test", status: "inactive" });
    const joined = await invite({ email: "here@example.test" });
    const left = await invite({ email: "gone@example.test" });
    const rows = await pg.rows("SELECT * FROM invites WHERE id = ANY($1::uuid[])", [[joined.id, left.id]]);
    const kept = await completion.dropInvitesOfJoinedMembers(rows, MAIN_TENANT_ID);
    assert.deepEqual(kept.map((r) => r.id), [left.id]);
    assert.equal(await statusOf(joined), "completed");
    assert.equal(await statusOf(left), "pending_signup");
  });

  // ── screenshot removal requests ──────────────────────────────────────────
  const shot = async (m, tenant) => {
    const s = await insert("activity_sessions", { member_id: m.id, status: "stopped", started_at: "2026-09-01T09:00:00Z", ended_at: "2026-09-01T10:00:00Z", ...(tenant ? { tenant_id: tenant } : {}) });
    return insert("activity_screenshots", { member_id: m.id, session_id: s.id, captured_at: "2026-09-01T09:30:00Z", ...(tenant ? { tenant_id: tenant } : {}) });
  };
  const requestsFor = (s) => pg.rows("SELECT status, reviewed_by FROM screenshot_removal_requests WHERE screenshot_id = $1", [s.id]);
  const exists = async (s) => (await pg.rows("SELECT 1 FROM activity_screenshots WHERE id = $1", [s.id])).length === 1;

  test("a member cannot object to someone else's screenshot, and is not told it exists", async () => {
    const bobs = await shot(bob);
    await assert.rejects(inMain(() => removal.requestRemoval(ann.id, bobs.id, "nope")), (e) => e.status === 404);
    assert.deepEqual(await requestsFor(bobs), []);
  });

  test("a screenshot in another account cannot be reached, even by its own member id", async () => {
    const foreigner = await member("Employee", { tenant_id: OTHER });
    const theirs = await shot(foreigner, OTHER);
    await assert.rejects(inMain(() => removal.requestRemoval(foreigner.id, theirs.id, "x")), (e) => e.status === 404);
    assert.deepEqual(await requestsFor(theirs), []);
  });

  test("declining keeps the screenshot; approving removes it and keeps who approved", async () => {
    const manager = await member("Manager");
    const one = await shot(ann);
    const two = await shot(ann);
    for (const s of [one, two]) await inMain(() => removal.requestRemoval(ann.id, s.id, "private"));
    const idOf = async (s) => (await pg.rows("SELECT id FROM screenshot_removal_requests WHERE screenshot_id = $1", [s.id]))[0].id;
    const firstId = await idOf(one);
    const secondId = await idOf(two);

    assert.deepEqual(await inMain(() => removal.resolveRequest(firstId, manager.id, { approve: false, note: "Work related." })), { status: "declined" });
    assert.equal(await exists(one), true);

    assert.deepEqual(await inMain(() => removal.resolveRequest(secondId, manager.id, { approve: true })), { status: "approved" });
    assert.equal(await exists(two), false);
    const [kept] = await pg.rows("SELECT status, reviewed_by FROM screenshot_removal_requests WHERE id = $1", [secondId]);
    assert.deepEqual(kept, { status: "approved", reviewed_by: manager.id });
  });

  // ── buzz ─────────────────────────────────────────────────────────────────
  test("a buzz reaches only active members of the sender's own organization", async () => {
    const owner = await member("Owner", { first_name: "Olive" });
    const away = await member("Employee", { status: "inactive" });
    const foreigner = await member("Employee", { tenant_id: OTHER });
    pushed.length = 0;
    for (const target of [away, foreigner]) {
      await assert.rejects(inMain(() => sendBuzz(owner.id, { memberId: target.id })), (e) => e.status === 404);
    }
    assert.equal(pushed.length, 0);
    await inMain(() => sendBuzz(owner.id, { memberId: bob.id }, Date.now()));
    assert.deepEqual(pushed.map((p) => [p.memberId, p.message.type, p.message.from]), [[bob.id, "buzz", "Olive"]]);
  });
}
