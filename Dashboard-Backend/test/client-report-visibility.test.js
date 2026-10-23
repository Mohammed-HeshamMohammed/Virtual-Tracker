// A Client login sees time only on its own projects and never sees money.
// stripReportMoney removes every monetary field from the payload itself (not
// just on screen). The project scope the report loader, the activity feed and
// the single-screenshot fetch apply is run end to end against Postgres in
// activity-feed-scope.pglite.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { stripReportMoney } from "../src/modules/reports/strip-report-money.js";
import { isClientRole } from "../src/http/role-hierarchy.js";

const payload = {
  currency: { displayCurrency: "EGP" },
  days: [
    {
      date: "2026-09-28",
      members: [
        { memberId: "m1", name: "Ann", activeSeconds: 3600, spentAmount: 12.5, currency: "USD", originalAmount: 12.5, originalCurrency: "USD", rateAsOf: "2026-09-01" },
      ],
    },
  ],
  entries: [{ date: "2026-09-28", memberId: "m1", projectName: "P", activeSeconds: 3600, spentAmount: 12.5, currency: "USD", originalAmount: 12.5, originalCurrency: "USD" }],
};

test("stripReportMoney removes every monetary field and flags the payload", () => {
  const out = stripReportMoney(payload);
  assert.equal(out.moneyHidden, true);
  assert.equal("currency" in out, false);
  const member = out.days[0].members[0];
  const entry = out.entries[0];
  for (const f of ["spentAmount", "currency", "originalAmount", "originalCurrency", "rateAsOf"]) {
    assert.equal(f in member, false, `member.${f}`);
    assert.equal(f in entry, false, `entry.${f}`);
  }
  assert.equal(member.activeSeconds, 3600, "time data is untouched");
  assert.equal(JSON.stringify(out).includes("12.5"), false, "the amount appears nowhere in the payload");
});

test("stripReportMoney does not mutate its input", () => {
  stripReportMoney(payload);
  assert.equal(payload.days[0].members[0].spentAmount, 12.5);
});

test("isClientRole matches only the Client role", () => {
  assert.equal(isClientRole("Client"), true);
  assert.equal(isClientRole(" client "), true);
  for (const r of ["Owner", "Admin", "Manager", "Employee", "Viewer", "", undefined]) assert.equal(isClientRole(r), false, String(r));
});

test("a client login is never handed pay rates or what clients are charged", () => {
  const out = stripReportMoney({
    billingIncluded: true,
    days: [],
    entries: [{ date: "2026-09-28", memberId: "m1", activeSeconds: 3600, payRate: 17.25, payRateCurrency: "USD", billRate: 41.5, billRateCurrency: "USD", billAmount: 41.5, billCurrency: "USD" }],
  });
  assert.equal("billingIncluded" in out, false);
  assert.deepEqual(out.entries[0], { date: "2026-09-28", memberId: "m1", activeSeconds: 3600 });
});
