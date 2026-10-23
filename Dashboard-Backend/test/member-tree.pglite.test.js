// The member tree's housekeeping and moves, run through the real service and route handlers
// against a real Postgres (PGlite) built from the boot schema, checking the edges left behind.
//
// Replaces source-text checks in member-relationship-sql, admin-placement and member-move.
// Skips itself when PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, request, loadPglite } from "./helpers/pglite.js";
import { fakeFirestore } from "./helpers/firebase-fakes.js";

if (!(await loadPglite())) {
  test("member tree against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite();
  after(() => pg.close());
  const { insert, member } = seeder(pg);
  const firestore = fakeFirestore();
  (await import(srcUrl("config/firebase.js"))).__setTestDb(firestore);

  const { removeMemberHierarchyRelationships, recordMemberRelationship } = await import(srcUrl("modules/member-relationships/service.js"));
  const { routeMemberRelationships } = await import(srcUrl("modules/member-relationships/routes.js"));
  const { applyRoleChangeHierarchyEffects } = await import(srcUrl("modules/hierarchy/hierarchy-sync.js"));
  const { MAX_BULK_MOVE } = await import(srcUrl("modules/member-relationships/move-service.js"));

  const owner = await member("Owner", { first_name: "Olive", date_added: "2026-01-01T00:00:00Z" });
  // Edges go in the way the app adds them, which also keeps the service's in-memory copy fresh.
  const edge = (parent, child) =>
    recordMemberRelationship(null, { parentMemberId: parent.id, childMemberId: child.id, relationshipType: "manual", createdBy: owner.id });
  // States the app no longer produces but older data still has - written straight into the table,
  // before anything has read (and cached) the tree.
  const rawEdge = (parent, child) => insert("member_relationships", { parent_member_id: parent.id, child_member_id: child.id });
  const oldManager = await member("Manager");
  const strandedAdmin = await member("Admin");
  const oldClient = await member("Client");
  const clientReport = await member("Employee");
  await rawEdge(owner, oldManager);
  await rawEdge(oldManager, strandedAdmin);
  await rawEdge(owner, oldClient);
  await rawEdge(oldClient, clientReport);
  const parentsOf = async (m) =>
    (await pg.rows("SELECT parent_member_id FROM member_relationships WHERE child_member_id = $1", [m.id])).map((r) => r.parent_member_id);
  const childrenOf = async (m) =>
    (await pg.rows("SELECT child_member_id FROM member_relationships WHERE parent_member_id = $1 ORDER BY child_member_id", [m.id])).map((r) => r.child_member_id);
  const asOwner = { memberId: owner.id, roleName: "Owner", uid: "uid-owner" };
  const call = (method, path, body) =>
    request({ method, path, viewer: asOwner, body }, (req, res, url) => routeMemberRelationships(req, res, url, undefined));
  const loadTree = () => call("GET", "/api/member-relationships/visual-tree?scope=organization");

  // The load-time repairs run at most once per cooldown, so the first load is the one checked.
  test("the first organization tree load takes Clients out of the tree and moves stranded admins under the Owner", async () => {
    const res = await loadTree();
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(await parentsOf(oldClient), []);
    assert.deepEqual(await childrenOf(oldClient), []);
    assert.deepEqual(await parentsOf(strandedAdmin), [owner.id]);
  });

  test("removing a member's hierarchy edges takes their parent and child edges, and nobody else's", async () => {
    const mgr = await member("Manager");
    const a = await member("Employee");
    const b = await member("Employee");
    const other = await member("Manager");
    const keep = await member("Employee");
    await edge(owner, mgr);
    await edge(mgr, a);
    await edge(mgr, b);
    await edge(other, keep);
    const removed = await removeMemberHierarchyRelationships(null, mgr.id);
    assert.equal(removed, 3);
    assert.deepEqual(await parentsOf(mgr), []);
    assert.deepEqual(await childrenOf(mgr), []);
    assert.deepEqual(await parentsOf(keep), [other.id]);
  });

  test("the tree still loads when a housekeeping step fails", async () => {
    const client = await member("Client");
    await rawEdge(owner, client);
    // Any delete from the tree now fails, so the client cleanup throws part-way through the load.
    await pg.rows(`CREATE FUNCTION refuse_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql`);
    await pg.rows("CREATE TRIGGER refuse_delete BEFORE DELETE ON member_relationships FOR EACH ROW EXECUTE FUNCTION refuse_delete()");
    try {
      const res = await loadTree();
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.deepEqual(await parentsOf(client), [owner.id], "the failed cleanup changed nothing");
    } finally {
      await pg.rows("DROP TRIGGER refuse_delete ON member_relationships");
    }
  });

  test("a member promoted to Admin is moved under the Owner, whoever they were under", async () => {
    const lead = await member("Manager");
    const promoted = await member("Manager");
    await edge(owner, lead);
    await edge(lead, promoted);
    await pg.rows("UPDATE members SET role_id = (SELECT id FROM roles WHERE name = 'Admin') WHERE id = $1", [promoted.id]);
    await applyRoleChangeHierarchyEffects(null, { memberId: promoted.id, nextRoleName: "Admin", actorMemberId: owner.id, actorRoleName: "Owner" });
    assert.deepEqual(await parentsOf(promoted), [owner.id]);
  });

  test("a promotion to Manager leaves the member where they are", async () => {
    const lead = await member("Manager");
    const promoted = await member("Employee");
    await edge(owner, lead);
    await edge(lead, promoted);
    await applyRoleChangeHierarchyEffects(null, { memberId: promoted.id, nextRoleName: "Manager", actorMemberId: owner.id, actorRoleName: "Owner" });
    assert.deepEqual(await parentsOf(promoted), [lead.id]);
  });

  test("the move route takes a list of members and moves them all", async () => {
    const from = await member("Manager");
    const to = await member("Manager");
    const a = await member("Employee");
    const b = await member("Employee");
    for (const m of [from, to]) await edge(owner, m);
    await edge(from, a);
    await edge(from, b);
    const res = await call("POST", "/api/member-relationships/move", { member_ids: [a.id, b.id], new_parent_id: to.id });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.moved, 2);
    assert.deepEqual(await childrenOf(to), [a.id, b.id].sort());
  });

  test("the move route refuses a list past its cap, and unknown fields, before moving anything", async () => {
    const to = await member("Manager");
    const tooMany = Array.from({ length: MAX_BULK_MOVE + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    assert.equal((await call("POST", "/api/member-relationships/move", { member_ids: tooMany, new_parent_id: to.id })).statusCode, 400);
    const extra = await call("POST", "/api/member-relationships/move", { member_ids: [owner.id], new_parent_id: to.id, force: true });
    assert.equal(extra.statusCode, 400);
    assert.deepEqual(await childrenOf(to), []);
  });
}
