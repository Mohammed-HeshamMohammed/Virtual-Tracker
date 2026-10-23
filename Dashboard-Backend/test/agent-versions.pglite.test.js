// What the agent's check-in leaves on the member row, and who the Agent versions list shows. Run
// against a real Postgres (PGlite) built from the boot schema.
//
// Replaces the SQL-text checks in agent-update-blocked.test.js. Skips itself when PGlite is
// missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, loadPglite } from "./helpers/pglite.js";

if (!(await loadPglite())) {
  test("agent versions against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite();
  after(() => pg.close());
  const { member } = seeder(pg);
  const { reportAgentOpen, listAgentVersionMembers } = await import(srcUrl("modules/agent-versions/service.js"));
  const stored = async (m) =>
    (await pg.rows("SELECT agent_version, agent_update_blocked, agent_install_dir FROM members WHERE id = $1", [m.id]))[0];

  test("a check-in records the version, whether updates are blocked, and where it is installed", async () => {
    const m = await member("Employee");
    await reportAgentOpen(m.id, "1.0.28", "windows", true, "C:\\Program Files\\My Virtual Tracker");
    assert.deepEqual(await stored(m), {
      agent_version: "1.0.28",
      agent_update_blocked: true,
      agent_install_dir: "C:\\Program Files\\My Virtual Tracker",
    });
  });

  test("an older agent checking in without an install dir does not erase the one already known", async () => {
    const m = await member("Employee");
    await reportAgentOpen(m.id, "1.0.28", "windows", false, "D:\\VT");
    await reportAgentOpen(m.id, "1.0.27", "windows", undefined, undefined);
    const row = await stored(m);
    assert.equal(row.agent_install_dir, "D:\\VT");
    assert.equal(row.agent_update_blocked, null, "too old to report the field: unknown, not 'not blocked'");
  });

  test("the list leaves Owners out, except the Owner who is looking", async () => {
    const ownerA = await member("Owner");
    const ownerB = await member("Owner");
    const worker = await member("Employee");
    const ids = (rows) => new Set(rows.map((r) => r.memberId));

    const everyone = ids(await listAgentVersionMembers("1.0.28"));
    assert.ok(everyone.has(worker.id));
    assert.ok(!everyone.has(ownerA.id) && !everyone.has(ownerB.id));

    const forA = ids(await listAgentVersionMembers("1.0.28", null, { includeMemberId: ownerA.id }));
    assert.ok(forA.has(ownerA.id) && !forA.has(ownerB.id));

    // Limited to the members the viewer may see, the same rule holds inside that list.
    const visible = [worker.id, ownerA.id, ownerB.id];
    const scoped = ids(await listAgentVersionMembers("1.0.28", visible, { includeMemberId: ownerA.id }));
    assert.deepEqual([...scoped].sort(), [ownerA.id, worker.id].sort());
    const narrow = ids(await listAgentVersionMembers("1.0.28", [worker.id], { includeMemberId: ownerA.id }));
    assert.deepEqual([...narrow], [worker.id]);
  });
}
