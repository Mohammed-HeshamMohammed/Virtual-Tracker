// A Client login sees time only on its own projects and never sees money.
// The rules live at the choke points every consumer shares, so they are
// pinned there: stripReportMoney removes every monetary field from the
// payload itself (not just on screen), and the payload loader / screenshot
// routes apply the client project scope before anything is fetched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripReportMoney } from "../src/modules/reports/strip-report-money.js";
import { isClientRole } from "../src/http/role-hierarchy.js";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

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

test("the payload loader scopes clients to their projects and strips money before returning", () => {
  const src = read("src/modules/reports/routes.js");
  const start = src.indexOf("export async function loadTimeAndActivityReportPayloadForMemberIds(");
  const body = src.slice(start, src.indexOf("\n}", start));
  const scopeAt = body.indexOf("clientProjectScope(");
  const loadAt = body.indexOf("loadTimeAndActivityReportPayloadUnscoped(");
  const stripAt = body.indexOf("stripReportMoney(payload)");
  assert.ok(scopeAt > 0 && loadAt > scopeAt && stripAt > loadAt, "scope -> load -> strip, in that order");
});

test("a client with no projects matches no project instead of everything", () => {
  const src = read("src/modules/reports/routes.js");
  assert.match(src, /permitted\.length > 0 \? permitted : \[NO_PROJECT_ID\]/);
});

test("the activity feed gives clients screenshots only, filtered to their projects", () => {
  const src = read("src/modules/activity/routes.js");
  assert.match(src, /feedClientProjectIds && feedType !== "screenshots"/);
  assert.match(src, /feedClientProjectIds \? \{ projectIds: feedClientProjectIds \} : \{\}/);
});

test("a single screenshot can't be fetched by id outside the client's projects", () => {
  const src = read("src/modules/activity/routes.js");
  assert.match(src, /isClientRole\(scope\.roleName\)[\s\S]{0,300}isScreenshotInProjectsPg\(resolvedId, own \?\? \[\]\)/);
});
