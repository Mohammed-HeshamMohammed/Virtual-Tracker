// Owner <-> member messaging on real rows: who a thread can reach, who hears about a reply, that
// a closed conversation takes no more, and that reading a thread clears only the other side's
// messages. Run against a real Postgres (PGlite) built from the boot schema.
//
// Replaces the SQL-text checks in owner-messaging.test.js. Skips itself when PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, loadPglite } from "./helpers/pglite.js";

if (!(await loadPglite())) {
  test("messaging against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite();
  after(() => pg.close());
  const { insert, member } = seeder(pg);
  const msg = await import(srcUrl("modules/messages/service.js"));
  const { withTenant } = await import(srcUrl("lib/postgres/client.js"));
  const { MAIN_TENANT_ID } = await import(srcUrl("lib/postgres/ensure-tenancy-schema.js"));

  const OTHER = "eeeeeeee-0000-4000-8000-000000000001";
  await insert("tenants", { id: OTHER, type: "customer", granted_role: "Enterprise Manager", seat_limit: 10 });
  const owner = await member("Owner");
  const ann = await member("Employee");
  const bob = await member("Employee");
  const foreign = await member("Employee", { tenant_id: OTHER });
  const inMain = (fn) => withTenant(MAIN_TENANT_ID, fn);
  const threadsOf = (m) => pg.rows("SELECT id, opened_by FROM message_threads WHERE member_id = $1", [m.id]);
  const notes = (m, type) => pg.rows("SELECT link FROM notifications WHERE recipient_id = $1 AND type = $2", [m.id, type]);
  const agentInbox = (m) => pg.rows("SELECT id FROM agent_notifications WHERE recipient_id = $1", [m.id]);
  const messageCount = async (thread) =>
    (await pg.rows("SELECT count(*)::int AS n FROM thread_messages WHERE thread_id = $1", [thread.id]))[0].n;

  test("opening threads reaches only members of the sender's own organization, and says how many it skipped", async () => {
    const result = await inMain(() =>
      msg.openThreads(owner.id, { memberIds: [ann.id, foreign.id], subject: "Please update", body: "Your tracker is out of date." }),
    );
    assert.equal(result.sent, 1);
    assert.equal(result.skipped, 1);
    assert.equal((await threadsOf(ann)).length, 1);
    assert.deepEqual(await threadsOf(foreign), []);
  });

  test("a new thread rings the member's web bell, linked to it, and lands in their tracker", async () => {
    await inMain(() => msg.openThreads(owner.id, { memberIds: [bob.id], subject: "Hello", body: "A message." }));
    const [thread] = await threadsOf(bob);
    const bell = await notes(bob, "owner_message");
    assert.equal(bell.length, 1);
    assert.match(bell[0].link, new RegExp(`thread=${thread.id}`));
    assert.equal((await agentInbox(bob)).length, 1);
  });

  test("a member's reply rings the Owner's bell and no tracker; the Owner's reply reaches the member's tracker", async () => {
    const [thread] = await threadsOf(ann);
    const trackerBefore = (await agentInbox(ann)).length;
    await inMain(() => msg.replyToThread(thread.id, ann.id, "Done, thanks."));
    assert.equal((await notes(owner, "member_reply")).length, 1);
    assert.deepEqual(await agentInbox(owner), []);
    await inMain(() => msg.replyToThread(thread.id, owner.id, "Following up."));
    assert.equal((await agentInbox(ann)).length, trackerBefore + 1);
  });

  test("reading a thread marks the other side's messages read, never your own", async () => {
    const [thread] = await threadsOf(ann);
    await inMain(() => msg.markThreadRead(thread.id, ann.id));
    const rows = await pg.rows("SELECT sender_id, read_at FROM thread_messages WHERE thread_id = $1", [thread.id]);
    assert.ok(rows.some((r) => r.sender_id === ann.id) && rows.some((r) => r.sender_id === owner.id));
    for (const r of rows) {
      if (r.sender_id === ann.id) assert.equal(r.read_at, null, "Ann's own reply stays unread for the Owner");
      else assert.notEqual(r.read_at, null, "the Owner's messages are now read");
    }
  });

  test("a closed conversation takes no more replies", async () => {
    const [thread] = await threadsOf(bob);
    await pg.rows("UPDATE message_threads SET closed_at = now() WHERE id = $1", [thread.id]);
    const before = await messageCount(thread);
    await assert.rejects(inMain(() => msg.replyToThread(thread.id, bob.id, "hello")), (e) => e.status === 409);
    assert.equal(await messageCount(thread), before);
  });

  test("someone outside the thread cannot read it, reply or mark it, and is not told it exists", async () => {
    const [thread] = await threadsOf(ann);
    const calls = [
      () => msg.getThread(thread.id, bob.id),
      () => msg.replyToThread(thread.id, bob.id, "hi"),
      () => msg.markThreadRead(thread.id, bob.id),
    ];
    for (const call of calls) await assert.rejects(inMain(call), (e) => e.status === 404);
  });
}
