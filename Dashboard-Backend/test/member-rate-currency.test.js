// Members are paid in their own currency; budgets, client bill rates and a
// project's "spent" figure are one number in the workspace's currency. Hours
// used to be multiplied by the raw pay rate, so an EGP rate was added to a USD
// total and the result called dollars. Every rate goes through the rate book
// first.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const PAY = new Map();
const state = { display: "USD", rates: [], rateCalls: 0, displayCalls: 0 };

mock.module("../src/lib/postgres/member-data-store.js", {
  namedExports: {
    getSingleByMemberId: async (_db, table, memberId) => {
      assert.equal(table, "pay_rates");
      return PAY.get(String(memberId)) ?? null;
    },
  },
});
mock.module("../src/lib/postgres/currency-rates.service.js", {
  namedExports: {
    getDisplayCurrencyPg: async () => {
      state.displayCalls += 1;
      return state.display;
    },
    getRatesForRangePg: async () => {
      state.rateCalls += 1;
      return state.rates;
    },
  },
});

const {
  __resetCurrencyContextForTests,
  memberHourlyRateInDisplayCurrency,
  memberHourlyRatesInDisplayCurrency,
  toDisplayCurrency,
} = await import("../src/lib/currency/member-rate.js");

const TODAY = new Date().toISOString().slice(0, 10);

test.beforeEach(() => {
  PAY.clear();
  state.display = "USD";
  state.rates = [{ day: TODAY, quote: "EGP", rate: 50 }];
  state.rateCalls = 0;
  state.displayCalls = 0;
  __resetCurrencyContextForTests();
});

test("a rate in another currency is converted into the workspace's", async () => {
  PAY.set("m1", { rate: 500, currency: "EGP" });
  assert.equal(await memberHourlyRateInDisplayCurrency("m1"), 10);
});

test("a rate already in the workspace currency is left alone", async () => {
  PAY.set("m1", { rate: 42.5, currency: "USD" });
  assert.equal(await memberHourlyRateInDisplayCurrency("m1"), 42.5);
});

test("a rate with no currency on it is taken to be the workspace's", async () => {
  PAY.set("m1", { rate: 30, currency: null });
  assert.equal(await memberHourlyRateInDisplayCurrency("m1"), 30);
});

// Better a figure that is off by the exchange rate than one that is zero:
// zero would quietly say the work cost nothing.
test("a currency with no rate on record keeps the rate as it stands", async () => {
  PAY.set("m1", { rate: 500, currency: "JPY" });
  assert.equal(await memberHourlyRateInDisplayCurrency("m1"), 500);
});

test("no member, no pay row and a zero rate are all nothing", async () => {
  PAY.set("zero", { rate: 0, currency: "EGP" });
  assert.equal(await memberHourlyRateInDisplayCurrency(""), 0);
  assert.equal(await memberHourlyRateInDisplayCurrency("missing"), 0);
  assert.equal(await memberHourlyRateInDisplayCurrency("zero"), 0);
});

test("the workspace currency decides the direction of the conversion", async () => {
  state.display = "EGP";
  PAY.set("m1", { rate: 10, currency: "USD" });
  assert.equal(await memberHourlyRateInDisplayCurrency("m1"), 500);
});

test("several members convert in one pass, and the rate book is loaded once", async () => {
  PAY.set("m1", { rate: 500, currency: "EGP" });
  PAY.set("m2", { rate: 20, currency: "USD" });
  const rates = await memberHourlyRatesInDisplayCurrency(["m1", "m2", "m1", "", null]);
  assert.deepEqual([...rates.entries()], [["m1", 10], ["m2", 20]]);
  assert.equal(state.rateCalls, 1, "one rate lookup for the whole batch");
  assert.equal(state.displayCalls, 1);
});

test("a broken rate lookup leaves the amount as it is rather than failing", async () => {
  __resetCurrencyContextForTests();
  state.rates = [];
  mock.timers?.reset?.();
  assert.equal(await toDisplayCurrency(123, "EGP"), 123);
});

test("zero and nonsense amounts convert to zero", async () => {
  assert.equal(await toDisplayCurrency(0, "EGP"), 0);
  assert.equal(await toDisplayCurrency("nope", "EGP"), 0);
});
