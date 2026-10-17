import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
after(() => db.close());
const queryRows = async (sql, params) => (await db.query(sql, params)).rows;
mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: queryRows,
    queryAsAdmin: queryRows,
    queryAsReadonlyCrossTenant: queryRows,
    queryRaw: (sql, params) => db.query(sql, params),
    withTransaction: (fn) => fn({ query: (sql, params) => db.query(sql, params) }),
    withTransactionAsAdmin: (fn) => fn({ query: (sql, params) => db.query(sql, params) }),
    withTenant: (_tenantId, fn) => fn(),
    isPostgresConfigured: () => true,
    isTenancyEnforced: () => false,
    getPostgresPool: () => null,
    getAdminPostgresPool: () => null,
    getReadonlyCrossTenantPostgresPool: () => null,
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
  },
});
mock.module("../src/modules/members/services/privileged-role-governance.js", {
  namedExports: { enforcePrivilegedRoleGovernanceForMember: async () => ({ ok: true }) },
});

const { getViewerProjectIds, viewerCanWriteProject, clientMayTrackProject } = await import("../src/http/project-access.js");
const { getMemberProjectIds } = await import("../src/modules/dashboard/dashboard-utils.js");
const { getBootstrapPayload } = await import("../src/modules/bootstrap/bootstrap-service.js");
const { setAuthContext } = await import("../src/http/auth-context.js");
const { routeProjects } = await import("../src/modules/projects/routes.js");
const { linkClientProjectPg, unlinkClientProjectPg } = await import("../src/lib/postgres/projects-postgres.service.js");
const { getDashboardCache, setDashboardCache } = await import("../src/modules/dashboard/dashboard-cache.js");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENT_MEMBER = id(1), OTHER_MEMBER = id(2), WORKER = id(3);
const CLIENT = id(10), OTHER_CLIENT = id(11);
const DIRECT = id(20), LINKED = id(21), UNRELATED = id(22), REASSIGNED = id(23), BOTH = id(24);
const viewer = { memberId: CLIENT_MEMBER, roleName: "Client", uid: "client-user" };

await db.exec(`
  CREATE TABLE clients (id uuid PRIMARY KEY, member_id uuid);
  CREATE TABLE members (id uuid PRIMARY KEY, first_name text, work_email text, hierarchy_status text);
  CREATE TABLE projects (
    id uuid PRIMARY KEY, name text, client_id uuid, created_by uuid,
    client_can_manage boolean DEFAULT false, client_can_track boolean DEFAULT false,
    status text DEFAULT 'active', type text DEFAULT 'normal',
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE client_projects (
    id uuid PRIMARY KEY, client_id uuid, project_id uuid, assigned_by uuid,
    UNIQUE (client_id, project_id)
  );
  CREATE TABLE project_members (id uuid PRIMARY KEY, project_id uuid, member_id uuid, timezone text);
  CREATE TABLE tasks (id uuid PRIMARY KEY, project_id uuid, assigned_to uuid);
`);
await db.query("INSERT INTO clients VALUES ($1, $2), ($3, $4)", [CLIENT, CLIENT_MEMBER, OTHER_CLIENT, OTHER_MEMBER]);
await db.query("INSERT INTO members VALUES ($1, 'Client', 'client@example.test', 'assigned')", [CLIENT_MEMBER]);
for (const [pid, cid] of [[DIRECT, CLIENT], [LINKED, null], [UNRELATED, OTHER_CLIENT], [REASSIGNED, CLIENT], [BOTH, CLIENT]]) {
  await db.query("INSERT INTO projects (id, name, client_id) VALUES ($1, $2, $3)", [pid, `Project ${pid}`, cid]);
}
for (const [n, cid, pid] of [[30, CLIENT, LINKED], [31, OTHER_CLIENT, REASSIGNED], [32, CLIENT, BOTH]]) {
  await db.query("INSERT INTO client_projects (id, client_id, project_id) VALUES ($1, $2, $3)", [id(n), cid, pid]);
}
await db.query("INSERT INTO project_members VALUES ($1, $2, $3, null)", [id(40), DIRECT, WORKER]);
for (const [n, pid] of [[50, DIRECT], [51, LINKED], [52, UNRELATED]]) {
  await db.query("INSERT INTO tasks VALUES ($1, $2, $3)", [id(n), pid, WORKER]);
}

async function call(method, path, body) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  req.method = method;
  req.headers = { "content-type": "application/json" };
  setAuthContext(req, viewer);
  const out = {};
  const res = {
    writeHead: (status) => { out.status = status; },
    setHeader: () => {},
    end: (payload) => { out.body = JSON.parse(String(payload)); },
  };
  await routeProjects(req, res, new URL(path, "http://localhost"), null, "http://localhost");
  return out;
}

test("client visibility resolves direct and linked assignments without membership or duplicate projects", async () => {
  const expected = [DIRECT, LINKED, BOTH].sort();
  assert.deepEqual((await getViewerProjectIds(null, CLIENT_MEMBER, "Client")).sort(), expected);
  assert.deepEqual([...(await getMemberProjectIds(null, CLIENT_MEMBER, "Client"))].sort(), expected);
  assert.deepEqual(await getViewerProjectIds(null, id(99), "Client"), []);
});

test("project reads include the client's assignments and exclude unrelated or reassigned projects", async () => {
  const response = await call("GET", "/api/projects");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.data.map((p) => p.id).sort(), [DIRECT, LINKED, BOTH].sort());
  const denied = await call("GET", `/api/projects/${UNRELATED}`);
  assert.equal(denied.status, 404);
});

test("being assigned grants read access without edit or tracking permission", async () => {
  assert.equal(await viewerCanWriteProject(null, viewer, DIRECT), false);
  assert.equal(await clientMayTrackProject(viewer, DIRECT), false);
  const response = await call("PATCH", `/api/projects/${DIRECT}`, { name: "Changed" });
  assert.equal(response.status, 403);
  assert.notEqual((await queryRows("SELECT name FROM projects WHERE id = $1", [DIRECT]))[0].name, "Changed");
});

test("project tabs refuse direct reads of another client's project data", async () => {
  for (const path of ["project-members", "project-budgets", "project-member-limits", "client-projects", "team-projects"]) {
    const response = await call("GET", `/api/${path}?project_id=${UNRELATED}`);
    assert.equal(response.status, 404, path);
  }
  const response = await call("GET", "/api/client-projects");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map((row) => row.project_id).sort(), [LINKED, BOTH].sort());
});

test("bootstrap exposes project tabs and team task counts while keeping management disabled", async () => {
  const payload = await getBootstrapPayload(null, viewer);
  assert.equal(payload.permissions.canSeePmTasksSection, true);
  assert.equal(payload.permissions.canManageProjects, false);
  assert.equal(payload.permissions.canManageClients, false);
  assert.equal(payload.permissions.canCreateTasks, false);
  assert.equal(payload.workspace.defaultNavItem, "command-center");
  assert.equal(payload.dashboardSummary.projects, 3);
  assert.equal(payload.dashboardSummary.tasks, 2);
});

test("explicit edit and track switches work for legacy assignments without granting unrelated access", async () => {
  await db.query("UPDATE projects SET client_can_manage = true, client_can_track = true WHERE id = ANY($1::uuid[])", [[DIRECT, UNRELATED]]);
  try {
    assert.equal(await viewerCanWriteProject(null, viewer, DIRECT), true);
    assert.equal(await clientMayTrackProject(viewer, DIRECT), true);
    assert.equal(await viewerCanWriteProject(null, viewer, UNRELATED), false);
    assert.equal(await clientMayTrackProject(viewer, UNRELATED), false);
  } finally {
    await db.query("UPDATE projects SET client_can_manage = false, client_can_track = false");
  }
});

test("assignment changes clear cached metrics and unlinking cannot restore legacy access", async () => {
  const key = `command-center:${CLIENT_MEMBER}`;
  setDashboardCache(key, { stale: true });
  await linkClientProjectPg(CLIENT, DIRECT, OTHER_MEMBER);
  assert.equal(getDashboardCache(key), null);
  setDashboardCache(key, { stale: true });
  await unlinkClientProjectPg(CLIENT, DIRECT);
  assert.equal(getDashboardCache(key), null);
  assert.ok(!(await getViewerProjectIds(null, CLIENT_MEMBER, "Client")).includes(DIRECT));
  assert.equal((await queryRows("SELECT client_id FROM projects WHERE id = $1", [DIRECT]))[0].client_id, null);
});
