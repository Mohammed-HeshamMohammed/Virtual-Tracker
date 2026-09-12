// Member limits used to be accepted for anyone in the org: the Members Limits
// picker listed every member, and the backend saved whatever it was sent. A
// limit only means something for someone assigned to the project, so the one
// function every limit is saved through now refuses anyone else - and taking
// someone off a project takes their limit with them.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OUTSIDER = "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const calls = [];
const state = { trackers: new Set() };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      const text = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: text, params });
      if (/FROM project_members/.test(text) && /SELECT 1/.test(text)) {
        return state.trackers.has(params[1]) ? [{ "?column?": 1 }] : [];
      }
      if (/INSERT INTO project_member_limits/.test(text)) return [{ project_id: params[1], member_id: params[2] }];
      return [];
    },
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  },
});
mock.module("../src/lib/postgres/member-data-store.js", {
  namedExports: { getSingleByMemberId: async () => null },
});
mock.module("../src/lib/postgres/clients-postgres.service.js", {
  namedExports: { getClientBudgetPg: async () => null },
});
mock.module("../src/modules/realtime/change-bus.js", {
  namedExports: { publishChange: async () => {} },
});
mock.module("../src/modules/projects/management-rollup.service.js", {
  namedExports: {
    syncManagementParentsOfProject: async () => {},
    syncManagementProjectMembers: async () => {},
  },
});

const { isProjectTrackerPg, removeProjectMemberPg, upsertProjectMemberLimitPg } = await import(
  "../src/lib/postgres/projects-postgres.service.js"
);

const LIMIT = { type: "Hours based", basedOn: "", cost: 10 };

test.beforeEach(() => {
  calls.length = 0;
  state.trackers = new Set();
});

test("a member assigned to the project can have a limit", async () => {
  state.trackers.add(USER);
  const row = await upsertProjectMemberLimitPg(PROJECT, USER, LIMIT, USER);
  assert.equal(row.member_id, USER);
  assert.ok(calls.some((c) => /INSERT INTO project_member_limits/.test(c.sql)));
});

test("someone not assigned to the project is refused, and nothing is saved", async () => {
  await assert.rejects(upsertProjectMemberLimitPg(PROJECT, OUTSIDER, LIMIT, USER), {
    status: 400,
    code: "MEMBER_NOT_ON_PROJECT",
  });
  assert.equal(calls.filter((c) => /INSERT INTO project_member_limits/.test(c.sql)).length, 0);
});

// Viewers can't track, so a limit on them would mean nothing.
test("the membership check leaves viewers out", async () => {
  await isProjectTrackerPg(PROJECT, USER);
  const check = calls.find((c) => /FROM project_members/.test(c.sql));
  assert.match(check.sql, /COALESCE\(LOWER\(project_role\), ''\) <> 'viewer'/);
  assert.deepEqual(check.params, [PROJECT, USER]);
});

test("no project or no member is never a member", async () => {
  assert.equal(await isProjectTrackerPg("", USER), false);
  assert.equal(await isProjectTrackerPg(PROJECT, ""), false);
  assert.equal(calls.length, 0);
});

test("taking someone off a project removes their member limit on it", async () => {
  await removeProjectMemberPg(PROJECT, USER, USER);
  const limitDelete = calls.find((c) => /DELETE FROM project_member_limits/.test(c.sql));
  assert.ok(limitDelete, "the limit is deleted with the membership");
  assert.deepEqual(limitDelete.params, [PROJECT, USER]);
});
