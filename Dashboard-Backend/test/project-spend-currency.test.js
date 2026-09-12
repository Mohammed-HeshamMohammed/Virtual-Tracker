// A project's spend is hours x rate. Members are paid in their own currency,
// so before conversion an EGP rate and a USD rate were added together and the
// total presented as one figure - the wrong number, in no currency at all.
// Spend now goes through the same rate book the reports use.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const PAY = new Map();
const state = { display: "USD", rates: [], trackedRows: [], clientCost: 0 };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (/FROM activity_sessions/.test(text) && /GROUP BY member_id/.test(text)) return state.trackedRows;
      if (/FROM client_projects/.test(text)) return [{ client_id: "c1" }];
      return [];
    },
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  },
});
mock.module("../src/lib/postgres/member-data-store.js", {
  namedExports: {
    getSingleByMemberId: async (_db, _table, memberId) => PAY.get(String(memberId)) ?? null,
  },
});
mock.module("../src/lib/postgres/currency-rates.service.js", {
  namedExports: {
    getDisplayCurrencyPg: async () => state.display,
    getRatesForRangePg: async () => state.rates,
  },
});
mock.module("../src/lib/postgres/clients-postgres.service.js", {
  namedExports: { getClientBudgetPg: async () => ({ cost: state.clientCost }) },
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

const { __resetCurrencyContextForTests } = await import("../src/lib/currency/member-rate.js");
const { computeProjectSpentCostPg, resolveMemberHourlyRatePg } = await import(
  "../src/lib/postgres/projects-postgres.service.js"
);

const TODAY = new Date().toISOString().slice(0, 10);

test.beforeEach(() => {
  PAY.clear();
  state.display = "USD";
  state.rates = [{ day: TODAY, quote: "EGP", rate: 50 }];
  state.trackedRows = [];
  state.clientCost = 0;
  __resetCurrencyContextForTests();
});

test("a pay-rate spend converts every member's rate before totalling", async () => {
  PAY.set("egp", { rate: 500, currency: "EGP" }); // 10/h
  PAY.set("usd", { rate: 20, currency: "USD" });
  state.trackedRows = [
    { member_id: "egp", secs: 3600 },
    { member_id: "usd", secs: 7200 },
  ];
  const spent = await computeProjectSpentCostPg(null, PROJECT, { basedOn: "pay rate" });
  assert.equal(spent, 50, "10 + 40, not 500 + 40");
});

test("the workspace currency is what the total ends up in", async () => {
  state.display = "EGP";
  PAY.set("usd", { rate: 20, currency: "USD" });
  state.trackedRows = [{ member_id: "usd", secs: 3600 }];
  assert.equal(await computeProjectSpentCostPg(null, PROJECT, { basedOn: "pay rate" }), 1000);
});

test("a member with no pay rate adds nothing rather than breaking the total", async () => {
  PAY.set("paid", { rate: 10, currency: "USD" });
  state.trackedRows = [
    { member_id: "paid", secs: 3600 },
    { member_id: "unpaid", secs: 36000 },
  ];
  assert.equal(await computeProjectSpentCostPg(null, PROJECT, { basedOn: "pay rate" }), 10);
});

test("one member's resolved rate is converted the same way", async () => {
  PAY.set("egp", { rate: 500, currency: "EGP" });
  assert.equal(await resolveMemberHourlyRatePg(null, PROJECT, "egp", "pay rate"), 10);
});

// A client's bill rate is already agreed in the workspace's currency - it is
// the budget's own number, not a member's, so it is not converted.
test("a bill-rate project charges the client rate as it stands", async () => {
  state.clientCost = 75;
  assert.equal(await resolveMemberHourlyRatePg(null, PROJECT, "egp", "bill rate"), 75);
});
