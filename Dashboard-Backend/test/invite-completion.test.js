// An invite is done when its person becomes a member - including by signing in from the
// tracker rather than the invite link - and the Members list reports projects/teams as counts.
// Which invites are found and closed is checked on real rows in inbox-and-requests.pglite.test.js.
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
