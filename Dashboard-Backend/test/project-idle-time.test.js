// A project's idle time is where the agent decides someone has walked away:
// active until it, timer stopped past it. It used to accept anything above
// zero, so a project could hold 160 hours - its whole budget paid out to
// someone who wasn't there. Idle time is now held, for each member, to half
// the budget and half their own limit on the project, in that member's hours.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const saved = [];
const TODAY = new Date().toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const db = {};

function resetDb() {
  Object.assign(db, {
    budget: null,
    members: [],
    clients: [],
    memberLimits: {},
    payRates: {},
    clientRates: {},
    display: "USD",
    fxRows: [],
    budgetReads: 0,
  });
}
resetDb();

mock.module("../src/lib/postgres/activity-scoring-postgres.service.js", {
  namedExports: {
    getActivityScoringSettingsPg: async () => ({
      saturation_events: 10,
      window_ms: 1000,
      screenshot_min_delay_sec: 60,
      screenshot_max_delay_sec: 600,
      idle_threshold_sec: 576_450,
      idle_warn_sec: 60,
      idle_alert_sec: 120,
      idle_stop_sec: 300,
    }),
    setActivityScoringSettingsPg: async (input) => {
      saved.push(input);
      return null;
    },
  },
});
mock.module("../src/http/auth-context.js", {
  namedExports: { isManagementRole: () => true },
});
mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    getProjectBudgetPg: async () => {
      db.budgetReads += 1;
      return db.budget;
    },
    getProjectMemberLimitPg: async (_projectId, memberId) => db.memberLimits[memberId] ?? null,
    listProjectMembersPg: async () => db.members.map((member_id) => ({ member_id })),
    listClientIdsForProjectPg: async () => db.clients,
  },
});
mock.module("../src/lib/postgres/member-data-store.js", {
  namedExports: {
    getSingleByMemberId: async (_db, _collection, memberId) => {
      const entry = db.payRates[memberId];
      if (entry === undefined) return null;
      return typeof entry === "number" ? { rate: entry, currency: "USD" } : entry;
    },
  },
});
mock.module("../src/lib/postgres/clients-postgres.service.js", {
  namedExports: { getClientBudgetPg: async (clientId) => ({ cost: db.clientRates[clientId] ?? 0 }) },
});
mock.module("../src/lib/postgres/currency-rates.service.js", {
  namedExports: {
    getDisplayCurrencyPg: async () => db.display,
    getRatesForRangePg: async () => db.fxRows,
  },
});

const {
  clampIdleTimeSeconds,
  DEFAULT_IDLE_TIME_SEC,
  IDLE_TIME_FALLBACK_MAX_SEC,
  IDLE_TIME_MIN_SEC,
  idleTimeLimit,
  toStoredIdleTimeSeconds,
  validateIdleTimeSeconds,
} = await import("../src/modules/projects/idle-time.js");
const { __clearIdleTimeLimitCacheForTests, effectiveIdleTimeSeconds, resolveIdleTimeLimit } = await import(
  "../src/modules/projects/idle-time-limit.service.js"
);
const { getActivityScoringSettings, setActivityScoringSettings } = await import(
  "../src/modules/activity/scoring-settings.js"
);

const ACTOR = { roleName: "owner", memberId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
const HOURS_160_MIN_7_5 = 160 * 3600 + 450;
const H = 3600;
const hoursBudget = (hours, scope = "per_project") => ({ type: "Hours based", scope, cost: hours });
const moneyBudget = (cost, basedOn = "Pay rate") => ({ type: "Cost based", scope: "per_project", based_on: basedOn, cost });
const hoursLimit = (hours, extra = {}) => ({ type: "Hours based", cost: hours, ...extra });
const moneyLimit = (cost, basedOn = "Pay rate") => ({ type: "Cost based", based_on: basedOn, cost });

test.beforeEach(() => {
  resetDb();
  __clearIdleTimeLimitCacheForTests();
});

// ---- storing ---------------------------------------------------------------

test("idle time is never under a minute; long values are the budget's call", () => {
  assert.equal(IDLE_TIME_MIN_SEC, 60);
  assert.ok(DEFAULT_IDLE_TIME_SEC >= IDLE_TIME_MIN_SEC);
  for (const value of [59, 30, 0, -5, Number.NaN, "abc", "", null, undefined]) {
    assert.notEqual(validateIdleTimeSeconds(value), null, `refused: ${String(value)}`);
  }
  for (const value of [60, 450, 3601, HOURS_160_MIN_7_5, "450"]) {
    assert.equal(validateIdleTimeSeconds(value), null, `stored: ${String(value)}`);
  }
  assert.equal(toStoredIdleTimeSeconds(HOURS_160_MIN_7_5), HOURS_160_MIN_7_5, "kept; the limit applies on read");
  assert.equal(toStoredIdleTimeSeconds(30), 60);
  for (const value of [0, -1, null, undefined, "junk"]) assert.equal(toStoredIdleTimeSeconds(value), DEFAULT_IDLE_TIME_SEC);
});

test("clamping keeps a value within [a minute, the limit]", () => {
  assert.equal(clampIdleTimeSeconds(HOURS_160_MIN_7_5, 19_800), 19_800);
  assert.equal(clampIdleTimeSeconds(30, 19_800), 60);
  assert.equal(clampIdleTimeSeconds(null, 19_800), DEFAULT_IDLE_TIME_SEC);
  assert.equal(clampIdleTimeSeconds(null, 300), 300, "even the default stays under the limit");
});

// ---- the project budget ------------------------------------------------------

test("an hours budget allows half its hours", () => {
  const limit = idleTimeLimit({ budget: hoursBudget(11) });
  assert.equal(limit.maxSeconds, 5.5 * H);
  assert.equal(limit.basis, "hours_budget");
  assert.equal(limit.source, "budget");
  assert.equal(limit.budgetHours, 11);
});

test("a per-person budget allows half of each person's hours, whatever its type", () => {
  const hours = idleTimeLimit({ budget: hoursBudget(20, "per_person") });
  assert.equal(hours.maxSeconds, 10 * H);
  assert.equal(hours.perPerson, true);
  // A per-person money budget is still entered as hours per person.
  const money = idleTimeLimit({ budget: { type: "Cost based", scope: "per_person", based_on: "Pay rate", cost: 8 } });
  assert.equal(money.maxSeconds, 4 * H);
});

test("a money budget becomes hours at its rate, then half", () => {
  const limit = idleTimeLimit({ budget: moneyBudget(5000), rate: 40 });
  assert.equal(limit.budgetHours, 125);
  assert.equal(limit.maxSeconds, 62.5 * H);
  assert.equal(limit.basis, "rate_estimate");
});

test("no budget, or no rate to convert a money budget with, falls back to an hour", () => {
  for (const budget of [null, { type: "", cost: 100 }, hoursBudget(0)]) {
    const limit = idleTimeLimit({ budget });
    assert.equal(limit.maxSeconds, IDLE_TIME_FALLBACK_MAX_SEC);
    assert.equal(limit.basis, "no_budget");
    assert.equal(limit.source, "fallback");
  }
  assert.equal(idleTimeLimit({ budget: moneyBudget(5000), rate: 0 }).basis, "no_rate");
});

test("a tiny budget still allows the one-minute minimum", () => {
  assert.equal(idleTimeLimit({ budget: hoursBudget(0.01) }).maxSeconds, IDLE_TIME_MIN_SEC);
});

// ---- a member's own limit on the project -----------------------------------------

test("a member's own hours limit applies when it is tighter than the budget", () => {
  const limit = idleTimeLimit({ budget: hoursBudget(11), memberLimit: hoursLimit(4) });
  assert.equal(limit.maxSeconds, 2 * H);
  assert.equal(limit.source, "member_limit");
  assert.equal(limit.basis, "member_limit_hours");
});

test("the budget still applies when it is tighter than the member's limit", () => {
  const limit = idleTimeLimit({ budget: hoursBudget(3), memberLimit: hoursLimit(40) });
  assert.equal(limit.maxSeconds, 1.5 * H);
  assert.equal(limit.source, "budget");
});

test("a money member limit becomes hours at the member's rate", () => {
  const limit = idleTimeLimit({ budget: moneyBudget(5000), rate: 40, memberLimit: moneyLimit(400), memberLimitRate: 40 });
  assert.equal(limit.memberLimitHours, 10);
  assert.equal(limit.maxSeconds, 5 * H);
  assert.equal(limit.basis, "member_limit_rate");
});

test("a member limit on its own, with no budget, still limits idle time", () => {
  assert.equal(idleTimeLimit({ memberLimit: hoursLimit(6) }).maxSeconds, 3 * H);
});

test("a member limit that can't be converted leaves the budget in charge", () => {
  const limit = idleTimeLimit({ budget: hoursBudget(11), memberLimit: moneyLimit(400), memberLimitRate: 0 });
  assert.equal(limit.maxSeconds, 5.5 * H);
  assert.equal(limit.source, "budget");
  const neither = idleTimeLimit({ budget: moneyBudget(5000), rate: 0, memberLimit: moneyLimit(400), memberLimitRate: 0 });
  assert.equal(neither.maxSeconds, IDLE_TIME_FALLBACK_MAX_SEC);
  assert.equal(neither.basis, "no_rate");
});

test("a member limit that hasn't started yet doesn't apply", () => {
  const limit = idleTimeLimit({ budget: hoursBudget(11), memberLimit: hoursLimit(4, { start_date: TOMORROW }), today: TODAY });
  assert.equal(limit.source, "budget");
  assert.equal(limit.maxSeconds, 5.5 * H);
});

// ---- rates, members and currencies -------------------------------------------------

test("the project figure uses the highest pay rate; each member gets their own", async () => {
  db.payRates = { m1: 20, m2: 40, m3: 0 };
  const limit = await resolveIdleTimeLimit({ budget: moneyBudget(5000), memberIds: ["m1", "m2", "m3"] });
  assert.equal(limit.maxSeconds, (5000 / 40 / 2) * H, "nobody's idle time may cost more than half");
  assert.equal(limit.rateBasis, "pay");
  const byId = Object.fromEntries(limit.members.map((m) => [m.memberId, m]));
  assert.equal(byId.m1.maxSeconds, (5000 / 20 / 2) * H, "a cheaper member can idle longer for the same money");
  assert.equal(byId.m2.maxSeconds, (5000 / 40 / 2) * H);
  assert.equal(byId.m3.maxSeconds, IDLE_TIME_FALLBACK_MAX_SEC, "no pay rate: the fallback hour");
  assert.equal(byId.m3.basis, "no_rate");
});

test("a bill-rate budget is converted at the client's rate", async () => {
  db.clientRates = { c1: 100 };
  const limit = await resolveIdleTimeLimit({ budget: moneyBudget(5000, "Bill rate"), clientIds: ["c1"], memberIds: ["m1"] });
  assert.equal(limit.maxSeconds, 25 * H);
  assert.equal(limit.rateBasis, "bill");
  assert.equal(limit.members[0].maxSeconds, 25 * H);
});

test("members' own limits come through per member", async () => {
  db.payRates = { m1: 40, m2: 40 };
  const limit = await resolveIdleTimeLimit({
    budget: moneyBudget(5000),
    memberIds: ["m1", "m2"],
    memberLimits: [{ member_id: "m2", type: "Cost based", based_on: "Pay rate", cost: 400 }],
  });
  const byId = Object.fromEntries(limit.members.map((m) => [m.memberId, m]));
  assert.equal(byId.m1.maxSeconds, 62.5 * H);
  assert.equal(byId.m2.maxSeconds, 5 * H);
  assert.equal(byId.m2.source, "member_limit");
});

test("a limit for someone not on the project is ignored", async () => {
  const limit = await resolveIdleTimeLimit({
    budget: hoursBudget(11),
    memberIds: ["m1"],
    memberLimits: [{ member_id: "m9", type: "Hours based", cost: 1 }],
  });
  assert.deepEqual(
    limit.members.map((m) => m.memberId),
    ["m1"],
  );
  assert.equal(limit.members[0].maxSeconds, 5.5 * H);
});

test("a member's explanation names the rate behind the limit that decided", async () => {
  db.payRates = { m1: 40 };
  db.clientRates = { c1: 100 };
  const limit = await resolveIdleTimeLimit({
    budget: moneyBudget(5000, "Bill rate"),
    memberIds: ["m1"],
    clientIds: ["c1"],
    memberLimits: [{ member_id: "m1", type: "Cost based", based_on: "Pay rate", cost: 400 }],
  });
  const [m1] = limit.members;
  // Budget: $5000 at the $100 bill rate is 50 h. Limit: $400 at the $40 pay rate is 10 h.
  assert.equal(m1.source, "member_limit");
  assert.equal(m1.maxSeconds, 5 * H);
  assert.equal(m1.rateBasis, "pay");
  assert.equal(limit.rateBasis, "bill", "the project's own figure is still the budget's");
});

test("a pay rate in another currency is converted into the org's currency first", async () => {
  db.display = "USD";
  db.payRates = { m4: { rate: 50, currency: "EGP" } };
  db.fxRows = [{ day: TODAY, quote: "EGP", rate: 50 }]; // 1 USD = 50 EGP
  const limit = await resolveIdleTimeLimit({ budget: moneyBudget(100), memberIds: ["m4"] });
  // EGP 50/h is $1/h, so a $100 budget is 100 hours - half of it is 50.
  assert.equal(limit.members[0].maxSeconds, 50 * H);
});

// ---- what tracking uses -------------------------------------------------------------

// The case from the report: 160 h 7.5 min on a project whose budget is 11 h.
test("160 hours on an 11-hour budget reaches the agent as 5 h 30 min", async () => {
  db.budget = hoursBudget(11);
  assert.equal(await effectiveIdleTimeSeconds({ id: "p1", idle_time_seconds: HOURS_160_MIN_7_5 }, "m1"), 5.5 * H);
});

test("tracking applies the member's own limit to that member only", async () => {
  db.budget = hoursBudget(11);
  db.memberLimits = { m2: hoursLimit(4) };
  const project = { id: "p1", idle_time_seconds: HOURS_160_MIN_7_5 };
  assert.equal(await effectiveIdleTimeSeconds(project, "m1"), 5.5 * H);
  assert.equal(await effectiveIdleTimeSeconds(project, "m2"), 2 * H);
});

test("a setting inside the limit is used as set", async () => {
  db.budget = hoursBudget(11);
  assert.equal(await effectiveIdleTimeSeconds({ id: "p1", idle_time_seconds: 20 * 60 }, "m1"), 20 * 60);
});

test("a project with no budget is held to an hour when tracking", async () => {
  assert.equal(await effectiveIdleTimeSeconds({ id: "p1", idle_time_seconds: HOURS_160_MIN_7_5 }, "m1"), IDLE_TIME_FALLBACK_MAX_SEC);
});

// The agent asks every ~15s; the budget and rates aren't re-read each time.
test("a member's limit is reused rather than re-read on every poll", async () => {
  db.budget = hoursBudget(11);
  const project = { id: "p1", idle_time_seconds: 600 };
  await effectiveIdleTimeSeconds(project, "m1");
  await effectiveIdleTimeSeconds(project, "m1");
  assert.equal(db.budgetReads, 1);
});

// ---- the org-wide fallback ----------------------------------------------------------

test("the org-wide idle threshold, which has no budget, is one minute to an hour", async () => {
  for (const idleThresholdSec of [HOURS_160_MIN_7_5, 30]) {
    await assert.rejects(setActivityScoringSettings({ idleThresholdSec }, ACTOR), { code: "INVALID_IDLE_THRESHOLD_SEC" });
  }
  assert.equal(saved.length, 0);
  await setActivityScoringSettings({ idleThresholdSec: 600 }, ACTOR);
  assert.equal(saved.at(-1).idleThresholdSec, 600);
  assert.equal((await getActivityScoringSettings()).idleThresholdSec, IDLE_TIME_FALLBACK_MAX_SEC);
});
