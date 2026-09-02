// Guards the fix where a project budget's start_date had no effect on spend:
// editing the start date used to leave old, pre-start time still counted.
// getProjectTrackedSecondsPg/computeProjectSpentForAllPg must now bound
// tracked time to >= start_date whenever one is set, and leave everything
// unbounded when it isn't.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {Array<{ sql: string, params: any[] }>} */
const calls = [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("total_seconds")) return [{ total_seconds: 3600 }];
      return [];
    },
    withTransaction: async (fn) => fn({ query: async () => [] }),
    isPostgresConfigured: () => true,
    getPostgresPool: () => null,
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
  },
});

const { getProjectTrackedSecondsPg, computeProjectSpentForAllPg, toDayStrOrNull } = await import(
  "../src/lib/postgres/projects-postgres.service.js"
);

test("toDayStrOrNull normalizes Date and string, passes through null", () => {
  assert.equal(toDayStrOrNull(new Date("2026-03-01T12:00:00Z")), "2026-03-01");
  assert.equal(toDayStrOrNull("2026-03-01"), "2026-03-01");
  assert.equal(toDayStrOrNull(null), null);
  assert.equal(toDayStrOrNull(undefined), null);
});

test("getProjectTrackedSecondsPg applies fromDate as a >= bound when given", async () => {
  calls.length = 0;
  await getProjectTrackedSecondsPg("p1", { fromDate: "2026-03-01" });
  const { sql, params } = calls.at(-1);
  assert.match(sql, /started_at::date >=/);
  assert.match(sql, /date >=/);
  assert.ok(params.includes("2026-03-01"));
});

test("getProjectTrackedSecondsPg has no date bound when fromDate is absent", async () => {
  calls.length = 0;
  await getProjectTrackedSecondsPg("p1", {});
  const { sql } = calls.at(-1);
  assert.doesNotMatch(sql, /started_at::date >=/);
});

test("computeProjectSpentForAllPg passes each budget row's start_date through as the UNNEST bound", async () => {
  calls.length = 0;
  await computeProjectSpentForAllPg({}, [
    { id: "p1", type: "Hours based", start_date: "2026-03-01" },
    { id: "p2", type: "Hours based", start_date: null },
  ]);
  const { sql, params } = calls.at(-1);
  assert.match(sql, /\$3::date\[\]/);
  assert.match(sql, /f\.start_date IS NULL OR s\.started_at::date >= f\.start_date/);
  assert.deepEqual(params[2], ["2026-03-01", null]);
});

test("getProjectTrackedSecondsPg applies toDate as a <= bound when given (Anchor end_date)", async () => {
  calls.length = 0;
  await getProjectTrackedSecondsPg("p1", { toDate: "2026-03-31" });
  const { sql, params } = calls.at(-1);
  assert.match(sql, /started_at::date <=/);
  assert.ok(params.includes("2026-03-31"));
});

test("computeProjectSpentForAllPg passes each budget row's end_date through as the UNNEST bound", async () => {
  calls.length = 0;
  await computeProjectSpentForAllPg({}, [{ id: "p1", type: "Hours based", start_date: "2026-03-01", end_date: "2026-03-31" }]);
  const { sql, params } = calls.at(-1);
  assert.match(sql, /\$4::date\[\]/);
  assert.match(sql, /f\.end_date IS NULL OR s\.started_at::date <= f\.end_date/);
  assert.deepEqual(params[3], ["2026-03-31"]);
});
