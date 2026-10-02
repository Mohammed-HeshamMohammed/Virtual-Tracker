// An invite is done when its person becomes a member - including by signing in from the
// tracker rather than the invite link - and the Members list reports projects/teams as counts.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const calls = [];
let responder = () => [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    // mock.module replaces the whole namespace, so everything anything in the import chain
    // touches has to exist here, not just query.
    getPostgresPool: () => null,
    getAdminPostgresPool: () => null,
    queryAsAdmin: async () => [],
    queryRaw: async () => ({ rows: [] }),
    withTenant: async (_tenantId, fn) => fn(),
    isPostgresConfigured: () => true,
    withTransaction: async (fn) => fn(),
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
    query: async (sql, params) => {
      calls.push({ sql, params });
      return responder(sql, params);
    },
  },
});

const completion = await import("../src/modules/members/services/invite-completion.js");
const { flattenViewRelations } = await import("../src/modules/members/services/member-list-enrichment.js");

function reset(fn = () => []) {
  calls.length = 0;
  responder = fn;
}

test("findPendingInviteForEmail: matches case-insensitively, is scoped, and skips an expired invite", async () => {
  reset(() => [
    { id: "old", status: "pending_signup", expires_at: "2020-01-01T00:00:00Z" },
    { id: "new", status: "pending_signup" },
  ]);
  const found = await completion.findPendingInviteForEmail("  David@TheVirtualCallers.com ", { tenantId: "t1" });
  assert.equal(found.id, "new", "the expired row is passed over");
  assert.deepEqual(calls[0].params, ["david@thevirtualcallers.com", "t1"]);
  assert.match(calls[0].sql, /status = 'pending_signup'/);
  assert.match(calls[0].sql, /COALESCE\(invite_kind, 'email'\) = 'email'/);

  reset(() => []);
  assert.equal(await completion.findPendingInviteForEmail(""), null);
  assert.equal(calls.length, 0, "no query for an empty address");
});

test("completeInvitesForJoinedMember closes only pending email invites for that address", async () => {
  reset(() => [{ id: "a" }, { id: "b" }]);
  const closed = await completion.completeInvitesForJoinedMember({ email: "Joined@X.com", uid: "uid-1", tenantId: null });
  assert.equal(closed, 2);
  assert.match(calls[0].sql, /SET status = 'completed'/);
  assert.match(calls[0].sql, /status = 'pending_signup'/);
  assert.match(calls[0].sql, /invite_kind, 'email'\) = 'email'/, "share links are never closed by a sign-in");
  assert.deepEqual(calls[0].params, ["joined@x.com", "uid-1", null]);
  assert.equal(await completion.completeInvitesForJoinedMember({ email: "" }), 0);
});

test("dropInvitesOfJoinedMembers hides and closes the invite of someone who already joined", async () => {
  const rows = [
    { id: "1", email: "david@x.com", status: "pending_signup", invite_kind: "email" },
    { id: "2", email: "waiting@x.com", status: "pending_signup", invite_kind: "email" },
    { id: "3", email: "david@x.com", status: "completed", invite_kind: "email" },
    { id: "4", email: "", status: "pending_signup", invite_kind: "open_link" },
  ];
  reset((sql) => (sql.includes("FROM members") ? [{ e: "david@x.com", p: null }] : [{ id: "1" }]));
  const kept = await completion.dropInvitesOfJoinedMembers(rows, "t1");
  assert.deepEqual(kept.map((r) => r.id), ["2", "3", "4"]);
  assert.ok(calls.some((c) => c.sql.includes("SET status = 'completed'")), "the stale invite is closed, not just hidden");
  assert.match(calls.find((c) => c.sql.includes("FROM members")).sql, /status = 'active'/, "only an active member counts as joined");
});

test("dropInvitesOfJoinedMembers leaves the list alone when nobody has joined, or when the check fails", async () => {
  const rows = [{ id: "2", email: "waiting@x.com", status: "pending_signup", invite_kind: "email" }];
  reset(() => []);
  assert.deepEqual(await completion.dropInvitesOfJoinedMembers(rows, "t1"), rows);

  reset(() => {
    throw new Error("db down");
  });
  assert.deepEqual(await completion.dropInvitesOfJoinedMembers(rows, "t1"), rows, "a failed check never empties the list");
});

test("flattenViewRelations turns the view's arrays into the counts and ids the table speaks", () => {
  const out = flattenViewRelations({
    id: "m1",
    projects: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }, { id: "p1", name: "A" }],
    teams: [{ id: "t1", name: "Core", is_lead: true }],
  });
  assert.equal(out.projects, 2, "counted once each");
  assert.deepEqual(out.project_ids, ["p1", "p2"]);
  assert.equal(out.teams, 1);
  assert.deepEqual(out.team_names, ["Core"]);
});

test("flattenViewRelations: empty arrays are zero, and rows already in count form pass through", () => {
  const empty = flattenViewRelations({ projects: [], teams: [] });
  assert.equal(empty.projects, 0);
  assert.deepEqual(empty.project_ids, []);
  const counted = { projects: 3, teams: 2 };
  assert.equal(flattenViewRelations(counted), counted);
});
