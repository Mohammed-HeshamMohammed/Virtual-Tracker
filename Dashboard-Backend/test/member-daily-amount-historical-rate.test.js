// Guards getMemberDailyAmountRowsPg's switch from "always the member's
// current rate" to "the rate actually in effect on that day" - the real
// logic lives in the SQL's LATERAL join against pay_rate_history (COALESCE
// falls back to pay_rates only when no history point qualifies), which a
// mocked query() can't exercise behaviorally. This is a structural check
// that the wiring is actually there, so an edit that accidentally drops the
// LATERAL join back to a plain `pr.rate` doesn't pass silently.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ sql: string, params: unknown[] } | null} */
let lastQuery = null;
/** @type {unknown[]} */
let nextRows = [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      lastQuery = { sql, params };
      return nextRows;
    },
  },
});

const { getMemberDailyAmountRowsPg } = await import("../src/lib/postgres/misc-reports-postgres.service.js");

test("unfiltered query resolves rate via pay_rate_history, falling back to pay_rates", async () => {
  lastQuery = null;
  nextRows = [];
  await getMemberDailyAmountRowsPg({ memberIds: ["m1"], fromDay: "2026-08-01", toDay: "2026-08-31" });
  assert.ok(lastQuery, "query() was called");
  assert.match(lastQuery.sql, /LEFT JOIN LATERAL[\s\S]*pay_rate_history/i);
  assert.match(lastQuery.sql, /effective_date <= d\.day/);
  assert.match(lastQuery.sql, /COALESCE\(h\.rate, pr\.rate\)/);
});

test("project-filtered query resolves rate the same way, aggregated with MIN across the group", async () => {
  lastQuery = null;
  nextRows = [];
  await getMemberDailyAmountRowsPg({
    memberIds: ["m1"],
    fromDay: "2026-08-01",
    toDay: "2026-08-31",
    projectIds: ["p1"],
  });
  assert.ok(lastQuery, "query() was called");
  assert.match(lastQuery.sql, /LEFT JOIN LATERAL[\s\S]*pay_rate_history/i);
  assert.match(lastQuery.sql, /effective_date <= dt\.day/);
  assert.match(lastQuery.sql, /MIN\(COALESCE\(h\.rate, pr\.rate\)\)/);
});

test("row mapping still produces the same output shape regardless of where the rate resolved from", async () => {
  nextRows = [
    {
      member_id: "m1",
      day: new Date("2026-08-15T00:00:00.000Z"),
      active_seconds: "3600",
      rate: "45",
      rate_type: "hourly",
      currency: "USD",
    },
  ];
  const rows = await getMemberDailyAmountRowsPg({ memberIds: ["m1"], fromDay: "2026-08-01", toDay: "2026-08-31" });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    memberId: "m1",
    day: "2026-08-15",
    activeSeconds: 3600,
    rate: 45,
    rateType: "hourly",
    currency: "USD",
  });
});
