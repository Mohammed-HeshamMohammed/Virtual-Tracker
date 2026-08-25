// Guards the two features that moved off Firestore last: emailed transfer
// invitations (member_transfer_requests) and the account-deactivation
// workflow (deactivation_requests). Both were read-write Firestore until this
// change - the transfer one behind a Postgres table of the same name whose
// columns described a different design, which is exactly what made a
// name-based audit call it migrated.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ sql: string[], rows: Record<string, unknown>[], notifications: Record<string, unknown>[] }} */
const stub = { sql: [], rows: [], notifications: [] };

function pick(sqlFragment) {
  return stub.sql.filter((sql) => sql.includes(sqlFragment));
}

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params = []) => {
      stub.sql.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("FROM member_transfer_requests")) return stub.rows;
      if (sql.includes("UPDATE member_transfer_requests")) return [];
      if (sql.includes("INSERT INTO member_transfer_requests")) return [];
      if (sql.includes("FROM deactivation_requests")) return stub.rows;
      if (sql.includes("INSERT INTO deactivation_requests")) return [{ id: "d-new" }];
      if (sql.includes("UPDATE deactivation_requests")) return stub.rows;
      if (sql.includes("FROM members")) return [{ id: "m-target", work_email: "t@x.io" }];
      return [];
    },
    isPostgresConfigured: () => true,
    withTransaction: async (fn) => fn({ query: async () => [] }),
    getPostgresPool: () => null,
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
  },
});

mock.module("../src/modules/notifications/service.js", {
  namedExports: {
    createNotification: async (_db, payload) => {
      stub.notifications.push(payload);
      return "n1";
    },
  },
});

mock.module("../src/lib/postgres/members-postgres.service.js", {
  namedExports: {
    getMemberByIdPg: async (id) => ({ id, first_name: "Req", last_name: "Ester" }),
    getMemberByFirebaseUidPg: async () => null,
    getMemberAuthContextPg: async () => null,
    getMembersByIdsPg: async () => [],
    listMembersPg: async () => [],
    listMembersEnrichedPg: async () => [],
    listMembersPagePg: async () => ({ rows: [], total: 0 }),
    createMemberPg: async () => ({}),
    updateMemberPg: async () => ({}),
    deleteMemberPg: async () => ({}),
    resolveMemberIdForFirebaseUidPg: async () => "",
    hasMemberPermissionPg: async () => false,
    revokeAllMemberSessionsPg: async () => ({}),
  },
});

const { declineMemberTransferRequest, getTransferRequestPreview } = await import(
  "../src/modules/hierarchy/transfer-request.service.js"
);
const { submitAccountDeactivationRequest, listPendingDeactivationRequests, resolveDeactivationRequest } =
  await import("../src/modules/auth/account-deactivation.js");

const TOKEN = "t".repeat(48);

function reset(rows = []) {
  stub.sql = [];
  stub.rows = rows;
  stub.notifications = [];
}

test("a transfer token is looked up in Postgres, not Firestore", async () => {
  reset([
    {
      id: "tr1",
      requester_member_id: "m-req",
      target_member_id: "m-target",
      target_email: "target@example.com",
      token: TOKEN,
      status: "pending",
      expires_at: new Date(Date.now() + 60_000),
    },
  ]);
  const result = await getTransferRequestPreview({}, TOKEN);
  assert.equal(result.ok, true);
  assert.equal(result.target_email_masked, "t***t@example.com");
  assert.equal(pick("FROM member_transfer_requests WHERE token = $1").length, 1);
});

test("an expired invitation is refused on preview", async () => {
  reset([
    {
      id: "tr1",
      requester_member_id: "m-req",
      target_member_id: "m-target",
      target_email: "target@example.com",
      token: TOKEN,
      status: "pending",
      expires_at: new Date(Date.now() - 60_000),
    },
  ]);
  const result = await getTransferRequestPreview({}, TOKEN);
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 410);
});

test("declining updates the row by id and clears the token", async () => {
  reset([
    {
      id: "tr1",
      requester_member_id: "m-req",
      target_member_id: "m-target",
      target_email: "target@example.com",
      token: TOKEN,
      status: "pending",
      expires_at: new Date(Date.now() + 60_000),
    },
  ]);
  const result = await declineMemberTransferRequest({}, { token: TOKEN, declinerMemberId: "m-target" });
  assert.equal(result.ok, true);
  const updates = pick("UPDATE member_transfer_requests");
  assert.equal(updates.length, 1);
  assert.match(updates[0], /status = \$2/);
  assert.match(updates[0], /token = \$4/);
  assert.equal(stub.notifications[0].type, "transfer_declined");
});

test("a second deactivation request for the same member is not inserted twice", async () => {
  reset([{ id: "d1", member_id: "m1", status: "pending" }]);
  const result = await submitAccountDeactivationRequest({}, "uid-1", "m1", "Employee", {});
  assert.deepEqual(result, { id: "d1", alreadyPending: true });
  assert.equal(pick("INSERT INTO deactivation_requests").length, 0);
});

test("pending deactivation rows are returned with camelCase keys the UI reads", async () => {
  reset([
    {
      id: "d1",
      member_id: "m1",
      member_name: "Ada L",
      member_email: "ada@example.com",
      role_name: "Employee",
      status: "pending",
    },
  ]);
  const rows = await listPendingDeactivationRequests({}, "Admin");
  assert.equal(rows[0].memberId, "m1");
  assert.equal(rows[0].memberName, "Ada L");
  assert.equal(rows[0].roleName, "Employee");
});

test("resolving a request that is no longer pending throws instead of double-resolving", async () => {
  reset([]); // conditional UPDATE ... WHERE status = 'pending' matches nothing
  await assert.rejects(
    () => resolveDeactivationRequest({}, "d1", "approved", "m-admin", "Admin"),
    /not found|no longer pending/,
  );
  const updates = pick("UPDATE deactivation_requests");
  assert.equal(updates.length, 1);
  assert.match(updates[0], /WHERE id = \$1 AND status = 'pending'/);
});

test("only approval roles may list or resolve", async () => {
  reset([]);
  await assert.rejects(() => listPendingDeactivationRequests({}, "Employee"), /Only Admin/);
  await assert.rejects(() => resolveDeactivationRequest({}, "d1", "approved", "m1", "Employee"), /Only Admin/);
});
