// Guards the generic task-child CRUD wiring in postgres-crud.service.js
// (task-comments/task-subtasks/task-attachments/task-hours) - one
// column-driven implementation shared by all four instead of four
// hand-written branches. The risk is entirely in the column-list-driven
// SQL building: a wrong column set silently drops or corrupts a field.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ rows: Record<string, any[]>, calls: Array<{ sql: string, params: any[] }> }} */
const stub = { rows: { task_comments: [], task_subtasks: [], task_attachments: [], task_hours: [] }, calls: [] };

function tableOf(sql) {
  const m = /FROM (\w+)|INTO (\w+)|UPDATE (\w+)/.exec(sql);
  return m ? m[1] || m[2] || m[3] : null;
}

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params = []) => {
      stub.calls.push({ sql, params });
      const table = tableOf(sql);
      if (sql.startsWith("INSERT INTO")) {
        // Row shape mirrors real Postgres: only the columns actually named in
        // the INSERT's column list are set from params - everything else in
        // RETURNING comes back as whatever the table's own DEFAULT is (here,
        // simplified to null, since these tests check presence/absence of
        // fields via stub.calls, not the simulated DEFAULT value itself).
        const cols = /\(([^)]+)\) VALUES/.exec(sql)[1].split(",").map((c) => c.trim());
        const returning = /RETURNING ([\s\S]+)$/.exec(sql)[1].split(",").map((c) => c.trim());
        const row = {};
        for (const c of returning) row[c] = null;
        cols.forEach((c, i) => (row[c] = params[i]));
        stub.rows[table].push(row);
        return [row];
      }
      if (sql.startsWith("UPDATE")) {
        const id = params[0];
        const row = stub.rows[table].find((r) => r.id === id);
        const sets = /SET ([\s\S]+?) WHERE/.exec(sql)[1].split(",").map((s) => s.trim().split(" = ")[0]);
        sets.forEach((c, i) => (row[c] = params[i + 1]));
        return [row];
      }
      if (sql.startsWith("DELETE")) {
        const id = params[0];
        stub.rows[table] = stub.rows[table].filter((r) => r.id !== id);
        return [];
      }
      if (params.length && sql.includes("task_id = $1") && sql.includes("SELECT")) {
        return stub.rows[table].filter((r) => r.task_id === params[0]);
      }
      if (params.length && sql.includes("WHERE id = $1")) {
        return stub.rows[table].filter((r) => r.id === params[0]);
      }
      return [...stub.rows[table]];
    },
    withTransaction: async (fn) => fn({ query: async () => [] }),
    isPostgresConfigured: () => true,
    getPostgresPool: () => null,
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
    __closePostgresPoolForTests: async () => null,
    getPostgresPool: async () => null,
    isPostgresConfigured: () => true,
    probePostgresReadiness: async () => null,
    withTransaction: async () => null,
  },
});
mock.module("../src/lib/postgres/lookup-availability.js", { namedExports: { isPostgresLookupReady: async () => true,
    markPostgresLookupReady: async () => null,
    resetPostgresLookupReadyCache: async () => null,
  } });
mock.module("../src/lib/postgres/member-data-availability.js", { namedExports: { isPostgresMemberDataReady: async () => true,
    markPostgresMemberDataReady: async () => null,
    resetPostgresMemberDataReadyCache: async () => null,
  } });
mock.module("../src/lib/postgres/lookup-postgres.service.js", {
  namedExports: {
    LOOKUP_POSTGRES_ENTITY_KEYS: [],
    createLookupPostgresRow: async () => null,
    deleteLookupPostgresRow: async () => null,
    getLookupPostgresRow: async () => null,
    isLookupPostgresEntityKey: () => false,
    listLookupPostgresRows: async () => [],
    updateLookupPostgresRow: async () => null,
    LOOKUP_COLLECTION_TO_CATEGORY: {},
    LOOKUP_ENTITY_CATEGORY: {},
    ORG_FIELD_OPTION_TYPES: new Set(),
    createOrgFieldOptionPg: async () => null,
    ensureDefaultRolesPg: async () => null,
    listOrgFieldOptionsPg: async () => [],
    lookupNameByIdPg: async () => null,
    lookupRowExistsInPostgres: async () => null,
    normalizeLookupRow: async () => null,
    resolveLookupIdByNamePg: async () => null,
    resolveRoleIdByNamePg: async () => null,
    resolveRoleNameByIdPg: async () => null,
    seedLookupTablePostgresIfEmpty: async () => null,
    seedOrgFieldOptionsPostgresIfEmpty: async () => null,
  },
});
mock.module("../src/lib/postgres/member-data-postgres.service.js", {
  namedExports: {
    MEMBER_DATA_POSTGRES_ENTITY_KEYS: [],
    createMemberDataSchemaRow: async () => null,
    deleteMemberDataSchemaRow: async () => null,
    getMemberDataSchemaRow: async () => null,
    isMemberDataPostgresEntityKey: () => false,
    listMemberDataSchemaRows: async () => [],
    updateMemberDataSchemaRow: async () => null,
    clearAllMemberTreeCachePg: async () => null,
    createMemberOnboardingRowPg: async () => null,
    dedupeMemberOnboardingByMemberIdPg: async () => null,
    deleteLimitsDocPg: async () => null,
    deleteMemberOnboardingByMemberIdPg: async () => null,
    deleteMemberScopedRowsPg: async () => null,
    deleteMemberTreeCachePg: async () => null,
    ensureLimitsDocPg: async () => null,
    ensureMemberOnboardingRowPg: async () => null,
    ensureMemberScopedRowPg: async () => null,
    findActiveBanByEmailPg: async () => null,
    findActiveBanByFirebaseUidPg: async () => null,
    findActiveBanByMemberIdPg: async () => null,
    findMemberOnboardingByInviteIdPg: async () => null,
    findMemberOnboardingByMemberIdPg: async () => null,
    getLimitsBatchPg: async () => null,
    getLimitsPg: async () => null,
    getMemberBanPg: async () => null,
    getMemberOnboardingRowByIdPg: async () => null,
    getMemberScopedRowPg: async () => null,
    getMemberTreeCachePg: async () => null,
    getPayRatesBatchPg: async () => null,
    getSystemMetaPg: async () => null,
    insertMemberBanPg: async () => null,
    isDevicePermanentlyBannedPg: async () => null,
    listActiveMemberBansPg: async () => [],
    listMemberOnboardingRowsPg: async () => [],
    memberUsesShiftsForLimitsPg: async () => null,
    normalizeMemberDataRow: async () => null,
    recordBanIpAndMaybeDeviceBanPg: async () => null,
    rekeyMemberDataMemberIdPg: async () => null,
    setMemberOnboardingRowPg: async () => null,
    setMemberTreeCachePg: async () => null,
    setSystemMetaPg: async () => null,
    updateMemberBanPg: async () => null,
    updateMemberOnboardingRowPg: async () => null,
    updateWorkLimitsConditionalPg: async () => null,
    upsertLimitFieldPg: async () => null,
    upsertMemberScopedRowPg: async () => null,
  },
});
mock.module("../src/lib/postgres/tasks-postgres.service.js", {
  namedExports: {
    createTaskPg: async () => null,
    deleteTaskPg: async () => null,
    getTaskPg: async () => null,
    listTasksPg: async () => [],
    updateTaskPg: async () => null,
    getTasksByIdsPg: async () => null,
  },
});
mock.module("../src/lib/postgres/task-assignments-postgres.service.js", {
  namedExports: {
    deleteAssignmentPg: async () => null,
    getAssignmentByIdPg: async () => null,
    getTaskAssignmentsPg: async () => [],
    listAllAssignmentsPg: async () => [],
    updateAssignmentPg: async () => null,
    upsertAssignmentPg: async () => null,
    findAssignmentPg: async () => null,
    getAssignmentsForTasksPg: async () => null,
    getInReviewAssignmentsForTaskPg: async () => null,
    getTaskIdsAssignedToMembersPg: async () => null,
    hasAssignmentPg: async () => null,
    sumActiveAssignmentSecondsPg: async () => null,
  },
});
mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    createProjectPg: async () => null,
    getProjectPg: async () => null,
    updateProjectPg: async () => null,
    deleteProjectPg: async () => null,
    listProjectsPg: async () => [],
    addProjectMemberPg: async () => null,
    removeProjectMemberPg: async () => null,
    listProjectMembersPg: async () => [],
    getProjectBudgetPg: async () => null,
    getAllProjectBudgetsPg: async () => [],
    upsertProjectBudgetPg: async () => null,
    listProjectMemberLimitsPg: async () => [],
    getAllProjectMemberLimitsPg: async () => [],
    upsertProjectMemberLimitPg: async () => null,
    linkClientProjectPg: async () => null,
    unlinkClientProjectPg: async () => null,
    listClientIdsForProjectPg: async () => [],
    listProjectIdsForClientPg: async () => [],
    linkTeamProjectPg: async () => null,
    unlinkTeamProjectPg: async () => null,
    listTeamIdsForProjectPg: async () => [],
    listProjectIdsForTeamPg: async () => [],
    archiveProjectPg: async () => null,
    computeProjectBudgetTargetForAllPg: async () => null,
    computeProjectBudgetTargetPg: async () => null,
    computeProjectSpentCostPg: async () => null,
    computeProjectSpentForAllPg: async () => null,
    computeProjectSpentPg: async () => null,
    countMembersByProjectPg: async () => null,
    deleteProjectMemberLimitPg: async () => null,
    deleteTeamProjectsForTeamPg: async () => null,
    getDailyActivityTotalsPg: async () => null,
    getMemberActivitySecondsPg: async () => null,
    getMemberWeeklyCapacityPg: async () => null,
    getProjectActivityMetricsPg: async () => null,
    getProjectMemberLimitPg: async () => null,
    getProjectTrackedSecondsPg: async () => null,
    listClientManagedProjectIdsPg: async () => new Set(),
    listClientTrackableProjectIdsPg: async () => new Set(),
    listMemberIdsForProjectsPg: async () => [],
    listProjectIdsForMemberPg: async () => [],
    listViewerProjectIdsPg: async () => [],
    resolveMemberHourlyRatePg: async () => null,
  },
});
mock.module("../src/lib/postgres/clients-postgres.service.js", {
  namedExports: {
    getClientPg: async () => null,
    listClientsPg: async () => [],
    createClientPg: async () => null,
    updateClientPg: async () => null,
    deleteClientPg: async () => null,
    getClientBudgetPg: async () => null,
    getAllClientBudgetsPg: async () => [],
    upsertClientBudgetPg: async () => null,
    getClientInvoicingPg: async () => null,
    upsertClientInvoicingPg: async () => null,
    deleteClientBudgetPg: async () => null,
    getClientAutomationStatePg: async () => null,
    upsertClientAutomationStatePg: async () => null,
  },
});
mock.module("../src/lib/postgres/teams-postgres.service.js", {
  namedExports: {
    createTeamPg: async () => null,
    getTeamByIdPg: async () => null,
    listTeamsPg: async () => [],
    updateTeamPg: async () => null,
    deleteTeamPg: async () => null,
    listTeamMembersPg: async () => [],
    listAllTeamMembersPg: async () => [],
    addTeamMemberPg: async () => null,
    removeTeamMemberPg: async () => null,
    getTeamsByIdsPg: async () => null,
    listTeamMembershipsForMemberPg: async () => [],
    replaceTeamRosterPg: async () => null,
  },
});
mock.module("../src/lib/postgres/members-postgres.service.js", {
  namedExports: {
    createMemberPg: async () => null,
    getMemberByIdPg: async () => null,
    listMembersPg: async () => [],
    updateMemberPg: async () => null,
    deleteMemberPg: async () => null,
    getMemberAuthContextPg: async () => null,
    getMemberByFirebaseUidPg: async () => null,
    getMembersByIdsPg: async () => null,
    hasMemberPermissionPg: async () => null,
    listMembersEnrichedPg: async () => [],
    listMembersPagePg: async () => [],
    resolveMemberIdForFirebaseUidPg: async () => null,
    revokeAllMemberSessionsPg: async () => null,
  },
});
mock.module("../src/modules/realtime/change-bus.js", {
  namedExports: { publishChange: async () => {}, subscribeChanges: () => () => {},
    resetChangeBusForTests: async () => null,
  },
});

const {
  listPostgresRows,
  getPostgresRow,
  createPostgresRow,
  updatePostgresRow,
  deletePostgresRow,
  shouldRouteEntityToPostgres,
} = await import("../src/modules/schema/services/postgres-crud.service.js");

function reset() {
  stub.rows = { task_comments: [], task_subtasks: [], task_attachments: [], task_hours: [] };
  stub.calls = [];
}

/** The most recent INSERT's explicit column list, as text - checked
 * directly against the SQL rather than the row state, since a row can look
 * identical whether a column was set to null by the INSERT or defaulted by
 * Postgres afterward; only the SQL itself proves which happened. */
function lastInsertColumns() {
  const call = [...stub.calls].reverse().find((c) => c.sql.startsWith("INSERT INTO"));
  return /\(([^)]+)\) VALUES/.exec(call.sql)[1];
}

test("all four task-child keys route to Postgres", async () => {
  for (const key of ["task-comments", "task-subtasks", "task-attachments", "task-hours"]) {
    assert.equal(await shouldRouteEntityToPostgres(key), true, key);
  }
});

test("create then list-by-task round-trips every field", async () => {
  reset();
  const created = await createPostgresRow("task-comments", {
    id: "c1",
    task_id: "t1",
    body: "looks good",
    created_at: new Date(),
    created_by: "m1",
  });
  assert.equal(created.body, "looks good");
  assert.equal(created.taskId, "t1", "normalizePgRow's camelCase mirror must be present too");

  const listed = await listPostgresRows("task-comments", new URL("http://x?task_id=t1"));
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "c1");
});

test("an omitted column falls through to its own DEFAULT, not an explicit null", async () => {
  reset();
  // "completed" deliberately omitted - subtasks table defaults it to false.
  await createPostgresRow("task-subtasks", { id: "s1", task_id: "t1", title: "Draft copy" });
  assert.doesNotMatch(lastInsertColumns(), /\bcompleted\b/, "completed must not be a named column in the INSERT");
  assert.match(lastInsertColumns(), /\btitle\b/, "title was provided and must still be inserted");
});

test("update only touches columns actually passed, id and task_id are never reassignable", async () => {
  reset();
  await createPostgresRow("task-subtasks", { id: "s1", task_id: "t1", title: "Draft copy", completed: false });
  const updated = await updatePostgresRow(
    "task-subtasks",
    "s1",
    { completed: true },
    { title: "Draft copy", task_id: "t1" },
  );
  assert.equal(updated.completed, true);
  assert.equal(updated.title, "Draft copy", "fields not in the payload must survive from existing, not be nulled");
  assert.equal(updated.taskId, "t1", "task_id must be unchanged by an update that never mentions it");
});

test("delete removes exactly one row, by id, scoped to its own table", async () => {
  reset();
  await createPostgresRow("task-attachments", { id: "a1", task_id: "t1", file_name: "spec.pdf" });
  await createPostgresRow("task-hours", { id: "h1", task_id: "t1", user_id: "m1", hours_spent: 2 });
  await deletePostgresRow("task-attachments", "a1");
  assert.equal(await getPostgresRow("task-attachments", "a1"), null);
  assert.notEqual(await getPostgresRow("task-hours", "h1"), null);
});
